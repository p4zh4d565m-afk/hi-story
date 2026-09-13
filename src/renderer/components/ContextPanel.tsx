import React, { useState, useEffect, useCallback } from 'react';
import type { Project, Chapter, OutlineNode, Character, WorldEntry } from '../types';
import type { SearchResult } from '../types/search';
import CharacterCard from './CharacterCard';
import WorldEntryCard from './WorldEntryCard';
import RelationshipGraph from './RelationshipGraph';
import { htmlToPlainText } from '../services/ai-prompts';
import { aiService } from '../services/ai.service';
import { snapshotAIRequestConfig } from '../services/ai/request-config';
import { decrypt } from '../services/crypto';

// ============================================================
// 创作罗盘存储
// ============================================================
interface CompassData {
  authorIntent: string;    // 长期作者意图
  currentFocus: string;    // 近期写作焦点
  avoid: string;           // 禁止方向
  updatedAt: string;
}

const COMPASS_KEY = 'hi-story-compass';

function loadCompass(projectId: string): CompassData {
  try {
    const raw = localStorage.getItem(`${COMPASS_KEY}-${projectId}`);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { authorIntent: '', currentFocus: '', avoid: '', updatedAt: '' };
}

function saveCompass(projectId: string, data: CompassData): void {
  try { localStorage.setItem(`${COMPASS_KEY}-${projectId}`, JSON.stringify(data)); } catch {}
}

// ============================================================
// 风格指纹存储
// ============================================================
export interface StyleFingerprint {
  sentenceStyle: string;
  rhetoricStyle: string;
  dialogueStyle: string;
  moodTone: string;
  vocabTraits: string;
  chapterStructure: string;
  rawAnalysis: string;
  updatedAt: string;
}

const STYLE_KEY = 'hi-story-style-fingerprint';

function loadStyleFingerprint(projectId: string): StyleFingerprint | null {
  try {
    const raw = localStorage.getItem(`${STYLE_KEY}-${projectId}`);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

function saveStyleFingerprint(projectId: string, data: StyleFingerprint): void {
  try { localStorage.setItem(`${STYLE_KEY}-${projectId}`, JSON.stringify(data)); } catch {}
}

// ============================================================
// AI 配置加载（与 AIReviewPanel 一致）
// ============================================================
interface SavedConfig {
  id: string;
  providerId: string;
  apiKey: string;
  model: string;
  label: string;
  baseUrl?: string;
}

const PROVIDERS: { id: string; name: string; baseUrl: string }[] = [
  { id: 'claude', name: 'claude', baseUrl: 'https://api.anthropic.com' },
  { id: 'openai', name: 'openai', baseUrl: 'https://api.openai.com/v1' },
  { id: 'deepseek', name: 'deepseek', baseUrl: 'https://api.deepseek.com/v1' },
  { id: 'doubao', name: 'doubao', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3' },
  { id: 'volcengine', name: 'volcengine', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3' },
  { id: 'qwen', name: 'qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { id: 'zhipu', name: 'zhipu', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  { id: 'moonshot', name: 'moonshot', baseUrl: 'https://api.moonshot.cn/v1' },
];

const AI_CONFIGS_KEY = 'hi-story-ai-configs';

function loadConfigs(): SavedConfig[] {
  try { const raw = localStorage.getItem(AI_CONFIGS_KEY); return raw ? JSON.parse(raw) : []; } catch { return []; }
}

async function loadConfigsDecrypted(): Promise<SavedConfig[]> {
  const configs = loadConfigs();
  const decrypted = [];
  for (const c of configs) {
    decrypted.push({ ...c, apiKey: await decrypt(c.apiKey) });
  }
  return decrypted;
}

const STYLE_ANALYSIS_PROMPT = `你是一位文学风格分析专家。请分析以下小说章节的写作风格，从以下维度返回 JSON：

{
  "sentenceStyle": "句式特点（长短句偏好、平均句长感受、是否多复句）",
  "rhetoricStyle": "修辞偏好（比喻/排比/反问/拟人等使用频率）",
  "dialogueStyle": "对话特点（长短、轮次、口语化程度、引号使用习惯）",
  "moodTone": "情绪基调（冷峻/温情/激昂/幽默/压抑等）",
  "vocabTraits": "用词特点（古风/现代/专业术语/方言/四字格偏好等）",
  "chapterStructure": "章节结构（开头习惯、结尾方式、场景切换节奏）"
}

每个字段用一句话精简描述，不要展开分析。严格返回纯 JSON。`;

interface ContextPanelProps {
  activeProject: Project | null;
  activeChapter?: Chapter | null;
  activeOutlineNode?: OutlineNode | null;
  characters?: Character[];
  worldEntries?: WorldEntry[];
  relationships?: { source: string; target: string; type: string }[];
  selectedCharacter?: Character | null;
  selectedWorldEntry?: WorldEntry | null;
  onSelectCharacter?: (ch: Character | null) => void;
  onSaveCharacter?: (data: Partial<Character>) => void;
  onCloseCharacter?: () => void;
  onSaveWorldEntry?: (data: Partial<WorldEntry>) => void;
  onDeleteWorldEntry?: (id: string) => void;
  onCloseWorldEntry?: () => void;
  /** 写作分析的样本章节内容 */
  chapterContent?: string | null;
}

const ContextPanel: React.FC<ContextPanelProps> = ({
  activeProject,
  activeChapter,
  activeOutlineNode,
  characters = [],
  worldEntries = [],
  relationships = [],
  selectedCharacter,
  selectedWorldEntry,
  onSelectCharacter,
  onSaveCharacter,
  onCloseCharacter,
  onSaveWorldEntry,
  onDeleteWorldEntry,
  onCloseWorldEntry,
  chapterContent,
}) => {
  // ===== 创作罗盘状态 =====
  const [compass, setCompass] = useState<CompassData>({ authorIntent: '', currentFocus: '', avoid: '', updatedAt: '' });
  const [compassOpen, setCompassOpen] = useState(false);
  const [compassSaved, setCompassSaved] = useState(false);

  useEffect(() => {
    if (activeProject?.id) {
      setCompass(loadCompass(activeProject.id));
      setCompassOpen(false);
    }
  }, [activeProject?.id]);

  const handleSaveCompass = useCallback(() => {
    if (!activeProject?.id) return;
    const data = { ...compass, updatedAt: new Date().toISOString() };
    saveCompass(activeProject.id, data);
    setCompass(data);
    setCompassSaved(true);
    setTimeout(() => setCompassSaved(false), 1500);
  }, [compass, activeProject?.id]);

  // ===== 风格指纹状态 =====
  const [styleFp, setStyleFp] = useState<StyleFingerprint | null>(null);
  const [styleAnalyzing, setStyleAnalyzing] = useState(false);
  const [styleError, setStyleError] = useState<string | null>(null);

  useEffect(() => {
    if (activeProject?.id) {
      setStyleFp(loadStyleFingerprint(activeProject.id));
      setStyleError(null);
    }
  }, [activeProject?.id]);

  const handleAnalyzeStyle = useCallback(async () => {
    if (!chapterContent || !activeProject?.id) return;
    setStyleAnalyzing(true);
    setStyleError(null);
    try {
      const configs = await loadConfigsDecrypted();
      if (configs.length === 0) { setStyleError('未配置 AI'); return; }
      const active = configs[0];
      const preset = PROVIDERS.find(p => p.id === active.providerId);
      const config = snapshotAIRequestConfig({
        name: preset?.name ?? active.providerId,
        apiKey: active.apiKey,
        model: active.model,
        baseUrl: active.baseUrl || preset?.baseUrl,
      });

      const plainText = htmlToPlainText(chapterContent).slice(0, 4000);
      const response = await aiService.chat(config, [
        { role: 'system', content: STYLE_ANALYSIS_PROMPT },
        { role: 'user', content: `请分析以下章节的写作风格：\n\n${plainText}` },
      ], { temperature: 0.3, maxTokens: 1024 });

      let jsonStr = response.trim();
      if (jsonStr.startsWith('```json')) jsonStr = jsonStr.slice(7);
      if (jsonStr.startsWith('```')) jsonStr = jsonStr.slice(3);
      if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3);
      jsonStr = jsonStr.trim();

      const parsed = JSON.parse(jsonStr);
      const fp: StyleFingerprint = {
        sentenceStyle: parsed.sentenceStyle || '',
        rhetoricStyle: parsed.rhetoricStyle || '',
        dialogueStyle: parsed.dialogueStyle || '',
        moodTone: parsed.moodTone || '',
        vocabTraits: parsed.vocabTraits || '',
        chapterStructure: parsed.chapterStructure || '',
        rawAnalysis: response,
        updatedAt: new Date().toISOString(),
      };
      saveStyleFingerprint(activeProject.id, fp);
      setStyleFp(fp);
    } catch (e) {
      setStyleError(`分析失败：${(e as Error).message}`);
    } finally {
      setStyleAnalyzing(false);
    }
  }, [chapterContent, activeProject?.id]);
  // Show world entry editor if selected
  if (selectedWorldEntry && onSaveWorldEntry && onDeleteWorldEntry && onCloseWorldEntry) {
    return (
      <WorldEntryCard
        entry={selectedWorldEntry}
        onSave={onSaveWorldEntry}
        onDelete={onDeleteWorldEntry}
        onClose={onCloseWorldEntry}
      />
    );
  }

  // Show character editor if a character is selected
  if (selectedCharacter) {
    return (
      <div className="h-full">
        <CharacterCard
          character={selectedCharacter}
          onSave={(data) => onSaveCharacter?.(data)}
          onClose={() => onCloseCharacter?.()}
        />
      </div>
    );
  }

  if (!activeProject) {
    return (
      <div className="h-full flex items-center justify-center text-gray-600 text-sm">
        <p>选择一个项目查看上下文</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      {/* Project Info */}
      <div className="p-4 border-b border-context-700/50">
        <h3 className="text-sm font-semibold text-gray-300 mb-3 uppercase tracking-wide">
          📖 {activeProject.name}
        </h3>
        <dl className="space-y-2 text-sm">
          {activeProject.typeTags.length > 0 && (
            <div>
              <dt className="text-gray-500 text-xs">类型</dt>
              <dd className="flex flex-wrap gap-1 mt-0.5">
                {activeProject.typeTags.map((tag) => (
                  <span key={tag} className="px-1.5 py-0.5 rounded text-[10px] bg-context-700 text-gray-300">
                    {tag}
                  </span>
                ))}
              </dd>
            </div>
          )}
          {activeProject.style && (
            <div>
              <dt className="text-gray-500 text-xs">风格</dt>
              <dd className="text-gray-300 text-xs">{activeProject.style}</dd>
            </div>
          )}
          {activeProject.summary && (
            <div>
              <dt className="text-gray-500 text-xs">简介</dt>
              <dd className="text-gray-400 text-xs leading-relaxed mt-0.5">{activeProject.summary}</dd>
            </div>
          )}
        </dl>
      </div>

      {/* Current Chapter Info */}
      {activeChapter && (
        <div className="p-4 border-b border-context-700/50">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">当前章节</h3>
          <p className="text-sm text-gray-300">{activeChapter.title}</p>
          <div className="flex items-center gap-3 mt-1 text-[10px] text-gray-600">
            <span>{activeChapter.wordCount.toLocaleString()} 字</span>
            <span>{activeChapter.status === 'final' ? '📌 定稿' : '📝 草稿'}</span>
          </div>
        </div>
      )}

      {/* Outline Node Detail */}
      {activeOutlineNode && (
        <div className="p-4 border-b border-context-700/50">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">大纲节点</h3>
          <p className="text-sm text-gray-300">{activeOutlineNode.title}</p>
          {activeOutlineNode.summary && (
            <p className="text-xs text-gray-500 mt-1">{activeOutlineNode.summary}</p>
          )}
        </div>
      )}

      {/* Characters */}
      {characters.length > 0 && (
        <div className="p-4 border-b border-context-700/50">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            角色 ({characters.length})
          </h3>
          <ul className="space-y-1">
            {characters.map((ch) => (
              <li
                key={ch.id}
                className="text-xs text-gray-400 hover:text-white cursor-pointer px-2 py-1 rounded hover:bg-context-800 transition-colors"
                onClick={() => onSelectCharacter?.(ch)}
              >
                👤 {ch.name}
                {ch.aliases && <span className="text-gray-600 ml-1">({ch.aliases})</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* World Entries */}
      {worldEntries.length > 0 && (
        <div className="p-4 border-b border-context-700/50">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            世界观 ({worldEntries.length})
          </h3>
          <ul className="space-y-1">
            {worldEntries.map((entry) => (
              <li
                key={entry.id}
                className="text-xs text-gray-400 hover:text-white cursor-pointer px-2 py-1 rounded hover:bg-context-800 transition-colors"
              >
                <span className="text-[10px]">
                  {entry.category === 'place' && '🌍'}
                  {entry.category === 'faction' && '🏛️'}
                  {entry.category === 'race' && '🧬'}
                  {entry.category === 'law' && '⚖️'}
                  {entry.category === 'history' && '📜'}
                  {entry.category === 'culture' && '🎭'}
                </span>{' '}
                {entry.name}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Relationship Graph */}
      {characters.length >= 2 && relationships.length > 0 && (
        <div className="p-4">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">角色关系</h3>
          <RelationshipGraph
            characters={characters.map(c => ({ id: c.id, name: c.name }))}
            relationships={relationships}
            width={288}
            height={300}
          />
        </div>
      )}

      {/* ── 创作罗盘 ── */}
      {activeProject && (
        <div className="p-4 border-b border-context-700/50">
          <div
            className="flex items-center justify-between cursor-pointer select-none"
            onClick={() => setCompassOpen(!compassOpen)}
          >
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">🧭 创作罗盘</h3>
            <span className="text-[10px] text-gray-600">{compassOpen ? '▾' : '▸'}</span>
          </div>
          {compassOpen && (
            <div className="mt-2 space-y-2">
              <div>
                <label className="text-[10px] text-gray-500 block mb-0.5">长期作者意图</label>
                <textarea
                  value={compass.authorIntent}
                  onChange={e => setCompass(p => ({ ...p, authorIntent: e.target.value }))}
                  placeholder="例如：要写一个关于师徒传承与背叛的修仙故事，核心主题是自由与责任…"
                  rows={3}
                  className="w-full px-2 py-1 bg-context-700 border border-context-600 rounded text-[11px] text-gray-200 resize-none focus:outline-none focus:border-accent placeholder-gray-600"
                />
              </div>
              <div>
                <label className="text-[10px] text-gray-500 block mb-0.5">
                  近期写作焦点 <span className="text-accent">（最高优先级）</span>
                </label>
                <textarea
                  value={compass.currentFocus}
                  onChange={e => setCompass(p => ({ ...p, currentFocus: e.target.value }))}
                  placeholder="例如：完成第一卷中段反转，让主角主动承担代价…"
                  rows={2}
                  className="w-full px-2 py-1 bg-context-700 border border-context-600 rounded text-[11px] text-gray-200 resize-none focus:outline-none focus:border-accent placeholder-gray-600"
                />
              </div>
              <div>
                <label className="text-[10px] text-gray-500 block mb-0.5">禁止方向</label>
                <textarea
                  value={compass.avoid}
                  onChange={e => setCompass(p => ({ ...p, avoid: e.target.value }))}
                  placeholder="例如：避免靠新能力强行解围、避免角色降智…"
                  rows={2}
                  className="w-full px-2 py-1 bg-context-700 border border-context-600 rounded text-[11px] text-gray-200 resize-none focus:outline-none focus:border-accent placeholder-gray-600"
                />
              </div>
              <button
                onClick={handleSaveCompass}
                className="px-3 py-1 bg-accent text-white text-[10px] rounded hover:bg-accent-hover transition-colors"
              >
                {compassSaved ? '✓ 已保存' : '保存罗盘'}
              </button>
              {compass.updatedAt && (
                <span className="text-[9px] text-gray-600 ml-2">
                  上次更新：{new Date(compass.updatedAt).toLocaleString('zh')}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── 风格指纹 ── */}
      {activeProject && (
        <div className="p-4">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">🎨 风格指纹</h3>
          {styleFp ? (
            <div className="space-y-1.5 text-[10px]">
              {[
                { label: '句式', val: styleFp.sentenceStyle },
                { label: '修辞', val: styleFp.rhetoricStyle },
                { label: '对话', val: styleFp.dialogueStyle },
                { label: '基调', val: styleFp.moodTone },
                { label: '用词', val: styleFp.vocabTraits },
                { label: '结构', val: styleFp.chapterStructure },
              ].map(item => (
                item.val ? (
                  <div key={item.label} className="flex gap-1">
                    <span className="text-gray-500 flex-shrink-0">{item.label}：</span>
                    <span className="text-gray-300">{item.val}</span>
                  </div>
                ) : null
              ))}
              <button
                onClick={handleAnalyzeStyle}
                disabled={styleAnalyzing || !chapterContent}
                className="mt-2 px-2 py-1 bg-context-700 text-gray-400 text-[10px] rounded hover:text-white disabled:opacity-40 transition-colors"
              >
                {styleAnalyzing ? '分析中...' : '🔄 重新分析'}
              </button>
            </div>
          ) : (
            <div className="text-center py-3">
              <p className="text-[10px] text-gray-600 mb-2">
                从你的样章中提取写作风格，AI 写章和对话时自动注入
              </p>
              <button
                onClick={handleAnalyzeStyle}
                disabled={styleAnalyzing || !chapterContent}
                className="px-3 py-1.5 bg-accent text-white text-[10px] rounded hover:bg-accent-hover disabled:opacity-40 transition-colors"
              >
                {styleAnalyzing ? '⏳ 分析中...' : '🎨 分析当前章节风格'}
              </button>
              {!chapterContent && (
                <p className="text-[9px] text-gray-700 mt-1">请先选定一个有内容的章节</p>
              )}
            </div>
          )}
          {styleError && (
            <p className="text-[10px] text-red-400 mt-1">{styleError}</p>
          )}
          {styleFp?.updatedAt && (
            <p className="text-[9px] text-gray-600 mt-1">
              上次分析：{new Date(styleFp.updatedAt).toLocaleString('zh')}
            </p>
          )}
        </div>
      )}

      {characters.length === 0 && worldEntries.length === 0 && !activeChapter && !activeOutlineNode && (
        <div className="p-4 text-center text-gray-600 text-xs">
          <p>暂无上下文</p>
          <p className="mt-1">创建角色、世界观后</p>
          <p>相关信息会自动显示在这里</p>
        </div>
      )}
    </div>
  );
};

export { type StyleFingerprint };
export default ContextPanel;
