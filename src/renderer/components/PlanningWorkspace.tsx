import React, { useEffect, useState } from 'react';
import type { PlanningIdea, Project, StoryOption, WritingSkill, WritingSkillSummary } from '../types';
import { decrypt } from '../services/crypto';
import { aiService } from '../services/ai.service';
import { buildStoryOptionsPrompt, parseStoryOptions } from '../services/ai-prompts/planning';

interface PlanningWorkspaceProps {
  project: Project | null;
}

interface SavedConfig {
  providerId: string;
  apiKey: string;
  model: string;
  baseUrl?: string;
}

const BASE_URLS: Record<string, string> = {
  claude: 'https://api.anthropic.com',
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  doubao: 'https://ark.cn-beijing.volces.com/api/v3',
  volcengine: 'https://ark.cn-beijing.volces.com/api/v3',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
  moonshot: 'https://api.moonshot.cn/v1',
};

async function configureFirstAi(): Promise<SavedConfig> {
  const raw = localStorage.getItem('hi-story-ai-configs');
  const configs: SavedConfig[] = raw ? JSON.parse(raw) : [];
  if (!configs.length) throw new Error('请先在 AI 设置中添加一个可用模型');
  const selected = configs[0];
  const apiKey = await decrypt(selected.apiKey);
  if (!apiKey) throw new Error('AI 配置解密失败，请重新保存 API Key');
  aiService.configure(
    selected.providerId,
    apiKey,
    selected.model,
    selected.baseUrl || BASE_URLS[selected.providerId] || '',
  );
  return { ...selected, apiKey };
}

const PlanningWorkspace: React.FC<PlanningWorkspaceProps> = ({ project }) => {
  const [idea, setIdea] = useState('');
  const [requirements, setRequirements] = useState('');
  const [options, setOptions] = useState<StoryOption[]>([]);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [matchedSkills, setMatchedSkills] = useState<WritingSkillSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<PlanningIdea['status']>('draft');

  useEffect(() => {
    setIdea(''); setRequirements(''); setOptions([]); setSelectedOption(null); setStatus('draft'); setError('');
    if (!project) return;
    window.electronAPI.invoke('db:planning:findByProject', project.id).then((res: any) => {
      if (res?.success && res.data) {
        const data = res.data as PlanningIdea;
        setIdea(data.idea);
        setRequirements(data.requirements);
        setOptions(data.generatedOptions);
        setSelectedOption(data.selectedOption);
        setStatus(data.status);
      }
    });
  }, [project?.id]);

  useEffect(() => {
    if (!idea.trim()) { setMatchedSkills([]); return; }
    const timer = setTimeout(() => {
      window.electronAPI.invoke('skills:route', `小说创意选题和故事方案：${idea}`, 3)
        .then((res: any) => { if (res?.success) setMatchedSkills(res.data || []); });
    }, 300);
    return () => clearTimeout(timer);
  }, [idea]);

  const save = async (nextStatus = status, nextSelected = selectedOption, nextOptions = options) => {
    if (!project) return false;
    setSaving(true);
    try {
      const res = await window.electronAPI.invoke('db:planning:save', {
        projectId: project.id, idea, requirements, generatedOptions: nextOptions,
        selectedOption: nextSelected, status: nextStatus,
      }) as any;
      if (!res?.success) throw new Error(res?.error || '保存策划内容失败');
      setStatus(nextStatus);
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally { setSaving(false); }
  };

  const generate = async () => {
    if (!project || idea.trim().length < 10) {
      setError('请先写下至少 10 个字的故事想法');
      return;
    }
    setLoading(true); setError('');
    try {
      const aiConfig = await configureFirstAi();
      const routed = await window.electronAPI.invoke('skills:route', `小说创意选题、卖点、人物：${idea}`, 3) as any;
      if (!routed?.success || !routed.data?.length) throw new Error('没有匹配到可用的写作 Skill');
      const fullSkills: WritingSkill[] = [];
      for (const summary of routed.data as WritingSkillSummary[]) {
        const detail = await window.electronAPI.invoke('skills:get', summary.id) as any;
        if (detail?.success) fullSkills.push(detail.data);
      }
      setMatchedSkills(routed.data);
      const raw = await aiService.chat(buildStoryOptionsPrompt(project, idea, requirements, fullSkills), {
        model: aiConfig.model,
        maxTokens: 4096,
        temperature: 0.8,
      });
      const generated = parseStoryOptions(raw);
      setOptions(generated);
      setSelectedOption(null);
      await save('generated', null, generated);
    } catch (err) {
      setError((err as Error).message);
    } finally { setLoading(false); }
  };

  const confirm = async (index: number) => {
    setSelectedOption(index);
    setError('');
    await save('confirmed', index, options);
  };

  if (!project) return <div className="h-full flex items-center justify-center text-gray-500">请先选择或创建一本小说</div>;

  return (
    <div className="h-full overflow-y-auto bg-editor-900 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="mb-6">
          <p className="text-xs text-accent mb-1">策划工作台 · 第一步</p>
          <h1 className="text-xl font-semibold text-gray-100">把一个想法发展成可写的故事方向</h1>
          <p className="text-sm text-gray-500 mt-2">先比较三个方向，确认后再生成总纲。这里不会代写正文。</p>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_280px] gap-5">
          <section className="space-y-4">
            <div className="bg-editor-800 border border-editor-700 rounded-lg p-4">
              <label className="block text-sm text-gray-300 mb-2">你的故事想法</label>
              <textarea value={idea} onChange={e => setIdea(e.target.value)} rows={7}
                placeholder="想到什么就写什么：主角、处境、金手指、某个画面，哪怕还很模糊……"
                className="w-full resize-y rounded bg-editor-900 border border-editor-600 p-3 text-sm text-gray-100 focus:outline-none focus:border-accent" />
              <label className="block text-sm text-gray-300 mt-4 mb-2">额外要求（可选）</label>
              <textarea value={requirements} onChange={e => setRequirements(e.target.value)} rows={3}
                placeholder="例如：男频玄幻、预计100万字、不要系统流、希望前期节奏快……"
                className="w-full resize-y rounded bg-editor-900 border border-editor-600 p-3 text-sm text-gray-100 focus:outline-none focus:border-accent" />
              {error && <p className="mt-3 text-xs text-red-400">⚠️ {error}</p>}
              <div className="flex gap-2 mt-4">
                <button onClick={() => save('draft')} disabled={saving || !idea.trim()}
                  className="px-4 py-2 rounded bg-editor-700 text-sm text-gray-300 hover:bg-editor-600 disabled:opacity-40">
                  {saving ? '保存中…' : '保存想法'}
                </button>
                <button onClick={generate} disabled={loading || saving || idea.trim().length < 10}
                  className="px-4 py-2 rounded bg-accent text-sm text-white hover:bg-accent-hover disabled:opacity-40">
                  {loading ? '正在生成三个方向…' : options.length ? '重新生成故事方案' : '生成三个故事方案'}
                </button>
              </div>
            </div>

            {options.length > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {options.map((option, index) => {
                  const selected = selectedOption === index;
                  return <article key={`${option.title}-${index}`} className={`rounded-lg border p-4 ${selected ? 'border-accent bg-accent/10' : 'border-editor-700 bg-editor-800'}`}>
                    <div className="flex justify-between gap-2 mb-3"><span className="text-xs text-gray-500">方案 {index + 1}</span>{selected && <span className="text-xs text-accent">已确认</span>}</div>
                    <h2 className="font-semibold text-gray-100 mb-2">{option.title}</h2>
                    <p className="text-sm text-gray-300 leading-6 mb-3">{option.logline}</p>
                    {([
                      ['目标读者', option.targetReader], ['核心体验', option.corePromise], ['主角', option.protagonist],
                      ['主要冲突', option.centralConflict], ['差异点', option.differentiator], ['结局方向', option.endingDirection],
                    ] as const).map(([label, value]) => <div key={label} className="mb-2"><p className="text-[11px] text-gray-500">{label}</p><p className="text-xs text-gray-300 leading-5">{value}</p></div>)}
                    <button onClick={() => confirm(index)} className={`w-full mt-3 px-3 py-2 rounded text-xs ${selected ? 'bg-accent text-white' : 'bg-editor-700 text-gray-300 hover:bg-editor-600'}`}>
                      {selected ? '这个方向已确认' : '选择这个方向'}
                    </button>
                  </article>;
                })}
              </div>
            )}
          </section>

          <aside className="bg-editor-800 border border-editor-700 rounded-lg p-4 h-fit">
            <h2 className="text-sm text-gray-200 mb-3">本步采用的方法</h2>
            {matchedSkills.length ? matchedSkills.map(skill => <div key={skill.id} className="mb-3 p-3 rounded bg-editor-900 border border-editor-700"><p className="text-xs text-accent">{skill.id}</p><p className="text-[11px] text-gray-500 mt-1 line-clamp-4">{skill.description}</p></div>) : <p className="text-xs text-gray-600">输入想法后自动匹配，不会一次加载全部 Skill。</p>}
            <div className="border-t border-editor-700 mt-4 pt-3 text-[11px] text-gray-500">状态：{status === 'confirmed' ? '故事方向已确认' : status === 'generated' ? '等待选择方案' : '创意草稿'}</div>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default PlanningWorkspace;
