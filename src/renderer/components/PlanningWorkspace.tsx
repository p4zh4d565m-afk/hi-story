import React, { useEffect, useState } from 'react';
import type { MasterOutline, PlanningIdea, Project, StoryOption, VolumeOutline, WritingSkill, WritingSkillSummary } from '../types';
import { decrypt } from '../services/crypto';
import { aiService } from '../services/ai.service';
import { buildMasterOutlinePrompt, buildStoryOptionsPrompt, buildVolumeOutlinesPrompt, parseMasterOutline, parseStoryOptions, parseVolumeOutlines } from '../services/ai-prompts/planning';

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
  const [masterOutline, setMasterOutline] = useState<MasterOutline | null>(null);
  const [outlineStatus, setOutlineStatus] = useState<PlanningIdea['outlineStatus']>('empty');
  const [outlineLoading, setOutlineLoading] = useState(false);
  const [volumeOutlines, setVolumeOutlines] = useState<VolumeOutline[]>([]);
  const [volumeStatus, setVolumeStatus] = useState<PlanningIdea['volumeStatus']>('empty');
  const [volumeLoading, setVolumeLoading] = useState(false);

  useEffect(() => {
    setIdea(''); setRequirements(''); setOptions([]); setSelectedOption(null); setStatus('draft');
    setMasterOutline(null); setOutlineStatus('empty'); setError('');
    setVolumeOutlines([]); setVolumeStatus('empty');
    if (!project) return;
    window.electronAPI.invoke('db:planning:findByProject', project.id).then((res: any) => {
      if (res?.success && res.data) {
        const data = res.data as PlanningIdea;
        setIdea(data.idea);
        setRequirements(data.requirements);
        setOptions(data.generatedOptions);
        setSelectedOption(data.selectedOption);
        setStatus(data.status);
        setMasterOutline(data.masterOutline);
        setOutlineStatus(data.outlineStatus);
        setVolumeOutlines(data.volumeOutlines);
        setVolumeStatus(data.volumeStatus);
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

  const save = async (
    nextStatus = status,
    nextSelected = selectedOption,
    nextOptions = options,
    nextOutline = masterOutline,
    nextOutlineStatus = outlineStatus,
    nextVolumes = volumeOutlines,
    nextVolumeStatus = volumeStatus,
  ) => {
    if (!project) return false;
    setSaving(true);
    try {
      const res = await window.electronAPI.invoke('db:planning:save', {
        projectId: project.id, idea, requirements, generatedOptions: nextOptions,
        selectedOption: nextSelected, status: nextStatus,
        masterOutline: nextOutline, outlineStatus: nextOutlineStatus,
        volumeOutlines: nextVolumes, volumeStatus: nextVolumeStatus,
      }) as any;
      if (!res?.success) throw new Error(res?.error || '保存策划内容失败');
      setStatus(nextStatus);
      setOutlineStatus(nextOutlineStatus);
      setVolumeStatus(nextVolumeStatus);
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
      setMasterOutline(null); setOutlineStatus('empty');
      setVolumeOutlines([]); setVolumeStatus('empty');
      await save('generated', null, generated, null, 'empty', [], 'empty');
    } catch (err) {
      setError((err as Error).message);
    } finally { setLoading(false); }
  };

  const confirm = async (index: number) => {
    setSelectedOption(index);
    setMasterOutline(null); setOutlineStatus('empty');
    setVolumeOutlines([]); setVolumeStatus('empty');
    setError('');
    await save('confirmed', index, options, null, 'empty', [], 'empty');
  };

  const generateMasterOutline = async () => {
    if (!project || selectedOption === null || !options[selectedOption]) return;
    setOutlineLoading(true); setError('');
    try {
      const aiConfig = await configureFirstAi();
      const routed = await window.electronAPI.invoke(
        'skills:route',
        '生成长篇小说全书总纲、主线结构、人物成长和整体情绪节奏',
        4,
      ) as any;
      if (!routed?.success || !routed.data?.length) throw new Error('没有匹配到总纲写作方法');
      const fullSkills: WritingSkill[] = [];
      for (const summary of routed.data as WritingSkillSummary[]) {
        const detail = await window.electronAPI.invoke('skills:get', summary.id) as any;
        if (detail?.success) fullSkills.push(detail.data);
      }
      setMatchedSkills(routed.data);
      const raw = await aiService.chat(
        buildMasterOutlinePrompt(project, options[selectedOption], requirements, fullSkills),
        { model: aiConfig.model, maxTokens: 8192, temperature: 0.65 },
      );
      const outline = parseMasterOutline(raw);
      setMasterOutline(outline);
      setVolumeOutlines([]); setVolumeStatus('empty');
      await save('confirmed', selectedOption, options, outline, 'generated', [], 'empty');
    } catch (err) { setError((err as Error).message); }
    finally { setOutlineLoading(false); }
  };

  const updateOutlineField = (field: keyof MasterOutline, value: string | string[]) => {
    if (!masterOutline) return;
    setMasterOutline({ ...masterOutline, [field]: value });
    if (outlineStatus === 'locked') setOutlineStatus('generated');
    if (volumeOutlines.length) { setVolumeOutlines([]); setVolumeStatus('empty'); }
  };

  const updatePhase = (index: number, field: string, value: string | string[]) => {
    if (!masterOutline) return;
    const phases = masterOutline.phases.map((phase, i) => i === index ? { ...phase, [field]: value } : phase);
    setMasterOutline({ ...masterOutline, phases });
    if (outlineStatus === 'locked') setOutlineStatus('generated');
    if (volumeOutlines.length) { setVolumeOutlines([]); setVolumeStatus('empty'); }
  };

  const saveOutline = async (lock = false) => {
    if (!masterOutline) return;
    await save('confirmed', selectedOption, options, masterOutline, lock ? 'locked' : 'generated');
  };

  const generateVolumes = async () => {
    if (!project || selectedOption === null || !masterOutline || outlineStatus !== 'locked') return;
    setVolumeLoading(true); setError('');
    try {
      const aiConfig = await configureFirstAi();
      const routed = await window.electronAPI.invoke(
        'skills:route', '把锁定的全书总纲拆成分卷纲，安排每卷主线、人物成长和情绪节奏', 4,
      ) as any;
      if (!routed?.success || !routed.data?.length) throw new Error('没有匹配到分卷策划方法');
      const fullSkills: WritingSkill[] = [];
      for (const summary of routed.data as WritingSkillSummary[]) {
        const detail = await window.electronAPI.invoke('skills:get', summary.id) as any;
        if (detail?.success) fullSkills.push(detail.data);
      }
      setMatchedSkills(routed.data);
      const raw = await aiService.chat(
        buildVolumeOutlinesPrompt(project, options[selectedOption], masterOutline, requirements, fullSkills),
        { model: aiConfig.model, maxTokens: 8192, temperature: 0.6 },
      );
      const volumes = parseVolumeOutlines(raw);
      setVolumeOutlines(volumes);
      await save('confirmed', selectedOption, options, masterOutline, 'locked', volumes, 'generated');
    } catch (err) { setError((err as Error).message); }
    finally { setVolumeLoading(false); }
  };

  const updateVolume = (index: number, field: keyof VolumeOutline, value: string | string[]) => {
    const next = volumeOutlines.map((volume, i) => i === index ? { ...volume, [field]: value } : volume);
    setVolumeOutlines(next);
    if (volumeStatus === 'locked') setVolumeStatus('generated');
  };

  const saveVolumes = async (lock = false) => {
    await save('confirmed', selectedOption, options, masterOutline, 'locked', volumeOutlines, lock ? 'locked' : 'generated');
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

            {status === 'confirmed' && selectedOption !== null && (
              <div className="bg-editor-800 border border-editor-700 rounded-lg p-4">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                  <div><p className="text-xs text-accent">策划工作台 · 第二步</p><h2 className="text-lg text-gray-100 mt-1">全书总纲</h2></div>
                  <div className="flex gap-2">
                    <button onClick={generateMasterOutline} disabled={outlineLoading}
                      className="px-4 py-2 rounded bg-editor-700 text-xs text-gray-200 hover:bg-editor-600 disabled:opacity-40">
                      {outlineLoading ? '正在生成全书总纲…' : masterOutline ? '重新生成' : '生成全书总纲'}
                    </button>
                    {masterOutline && <button onClick={() => saveOutline(false)} disabled={saving} className="px-4 py-2 rounded bg-editor-700 text-xs text-gray-200 hover:bg-editor-600">保存修改</button>}
                    {masterOutline && <button onClick={() => saveOutline(true)} disabled={saving} className="px-4 py-2 rounded bg-accent text-xs text-white hover:bg-accent-hover">锁定总纲</button>}
                  </div>
                </div>
                {!masterOutline && <p className="text-sm text-gray-500">将根据已确认的“{options[selectedOption].title}”生成 4—6 个全书阶段。</p>}
                {masterOutline && <div className="space-y-4">
                  {([
                    ['premise', '故事核心前提'], ['centralConflict', '贯穿全书的冲突'], ['protagonistArc', '主角变化'],
                    ['ending', '结局方向'], ['structureModel', '结构选择与理由'],
                  ] as const).map(([field, label]) => <label key={field} className="block"><span className="block text-xs text-gray-500 mb-1">{label}</span><textarea rows={2} value={masterOutline[field]} onChange={e => updateOutlineField(field, e.target.value)} className="w-full resize-y rounded bg-editor-900 border border-editor-700 p-2 text-sm text-gray-200 focus:outline-none focus:border-accent" /></label>)}

                  <div className="space-y-3"><p className="text-sm text-gray-300">全书阶段</p>{masterOutline.phases.map((phase, index) => <div key={index} className="rounded border border-editor-700 bg-editor-900 p-3">
                    <div className="grid grid-cols-[1fr_180px] gap-2"><input value={phase.title} onChange={e => updatePhase(index, 'title', e.target.value)} className="bg-editor-800 border border-editor-700 rounded px-2 py-1 text-sm text-gray-100" /><input value={phase.chapterRange} onChange={e => updatePhase(index, 'chapterRange', e.target.value)} className="bg-editor-800 border border-editor-700 rounded px-2 py-1 text-xs text-gray-300" /></div>
                    <textarea rows={2} value={phase.purpose} onChange={e => updatePhase(index, 'purpose', e.target.value)} className="w-full mt-2 bg-editor-800 border border-editor-700 rounded p-2 text-xs text-gray-300" />
                    <label className="block text-[11px] text-gray-500 mt-2">关键事件（每行一项）</label><textarea rows={4} value={phase.keyEvents.join('\n')} onChange={e => updatePhase(index, 'keyEvents', e.target.value.split('\n').filter(Boolean))} className="w-full mt-1 bg-editor-800 border border-editor-700 rounded p-2 text-xs text-gray-300" />
                    <div className="grid grid-cols-2 gap-2 mt-2"><textarea rows={2} value={phase.turningPoint} onChange={e => updatePhase(index, 'turningPoint', e.target.value)} className="bg-editor-800 border border-editor-700 rounded p-2 text-xs text-gray-300" /><textarea rows={2} value={phase.emotionTrend} onChange={e => updatePhase(index, 'emotionTrend', e.target.value)} className="bg-editor-800 border border-editor-700 rounded p-2 text-xs text-gray-300" /></div>
                  </div>)}</div>

                  {(['subplots', 'storyPromises'] as const).map(field => <label key={field} className="block"><span className="block text-xs text-gray-500 mb-1">{field === 'subplots' ? '副线及交汇方式（每行一项）' : '必须兑现的故事承诺（每行一项）'}</span><textarea rows={4} value={masterOutline[field].join('\n')} onChange={e => updateOutlineField(field, e.target.value.split('\n').filter(Boolean))} className="w-full bg-editor-900 border border-editor-700 rounded p-2 text-sm text-gray-300" /></label>)}
                  <p className={`text-xs ${outlineStatus === 'locked' ? 'text-green-400' : 'text-yellow-500'}`}>{outlineStatus === 'locked' ? '✓ 总纲已锁定，可以继续拆分卷纲' : '总纲尚未锁定，你可以直接修改所有字段'}</p>
                </div>}
              </div>
            )}

            {outlineStatus === 'locked' && masterOutline && (
              <div className="bg-editor-800 border border-editor-700 rounded-lg p-4">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                  <div><p className="text-xs text-accent">策划工作台 · 第三步</p><h2 className="text-lg text-gray-100 mt-1">分卷纲</h2></div>
                  <div className="flex gap-2">
                    <button onClick={generateVolumes} disabled={volumeLoading} className="px-4 py-2 rounded bg-editor-700 text-xs text-gray-200 hover:bg-editor-600 disabled:opacity-40">{volumeLoading ? '正在拆分卷纲…' : volumeOutlines.length ? '重新生成' : '生成分卷纲'}</button>
                    {!!volumeOutlines.length && <button onClick={() => saveVolumes(false)} disabled={saving} className="px-4 py-2 rounded bg-editor-700 text-xs text-gray-200 hover:bg-editor-600">保存修改</button>}
                    {!!volumeOutlines.length && <button onClick={() => saveVolumes(true)} disabled={saving} className="px-4 py-2 rounded bg-accent text-xs text-white hover:bg-accent-hover">锁定分卷纲</button>}
                  </div>
                </div>
                {!volumeOutlines.length && <p className="text-sm text-gray-500">总纲已锁定，可以按阶段目标拆成分卷。</p>}
                <div className="space-y-4">{volumeOutlines.map((volume, index) => <article key={index} className="rounded border border-editor-700 bg-editor-900 p-4">
                  <div className="grid grid-cols-[1fr_180px] gap-2"><input value={volume.title} onChange={e => updateVolume(index, 'title', e.target.value)} className="bg-editor-800 border border-editor-700 rounded px-2 py-1 text-sm text-gray-100" /><input value={volume.chapterRange} onChange={e => updateVolume(index, 'chapterRange', e.target.value)} className="bg-editor-800 border border-editor-700 rounded px-2 py-1 text-xs text-gray-300" /></div>
                  {([['volumeGoal','本卷目标'],['openingState','开卷状态'],['mainProgression','主线推进'],['characterProgression','人物/关系推进'],['climax','本卷高潮与代价'],['endingState','卷末新局面']] as const).map(([field,label]) => <label key={field} className="block mt-2"><span className="text-[11px] text-gray-500">{label}</span><textarea rows={2} value={volume[field]} onChange={e => updateVolume(index, field, e.target.value)} className="w-full mt-1 bg-editor-800 border border-editor-700 rounded p-2 text-xs text-gray-300" /></label>)}
                  {([['keyEvents','关键事件（每行一项）'],['promisesOpened','本卷新建承诺'],['promisesPaid','本卷兑现承诺']] as const).map(([field,label]) => <label key={field} className="block mt-2"><span className="text-[11px] text-gray-500">{label}</span><textarea rows={field === 'keyEvents' ? 5 : 3} value={volume[field].join('\n')} onChange={e => updateVolume(index, field, e.target.value.split('\n').filter(Boolean))} className="w-full mt-1 bg-editor-800 border border-editor-700 rounded p-2 text-xs text-gray-300" /></label>)}
                </article>)}</div>
                {!!volumeOutlines.length && <p className={`mt-4 text-xs ${volumeStatus === 'locked' ? 'text-green-400' : 'text-yellow-500'}`}>{volumeStatus === 'locked' ? '✓ 分卷纲已锁定，可以继续生成章节清单' : '分卷纲尚未锁定，可以直接修改'}</p>}
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
