import { describe, expect, it } from 'vitest';
import { parseChapterOutlines, parseMasterOutline, parseStoryOptions, parseVolumeOutlines, formatStagesContext, buildChapterOutlinesPrompt, formatPlanningAuthorityContext } from '../../src/renderer/services/ai-prompts/planning';
import type { VolumeOutline, VolumeStage, MasterOutline, StoryOption, PlanningIdea, ChapterOutline } from '../../src/renderer/types';

const option = {
  title: '测试书名',
  logline: '一个完整的一句话故事。',
  targetReader: '喜欢成长故事的读者',
  corePromise: '持续成长与选择',
  protagonist: '有欲望也有短板的主角',
  centralConflict: '无法逃避的主要对抗',
  differentiator: '独有的限制条件',
  endingDirection: '完成核心选择',
};

describe('parseStoryOptions', () => {
  it('接受被代码块包裹的三个完整方案', () => {
    const result = parseStoryOptions(`\`\`\`json\n${JSON.stringify({ options: [option, option, option] })}\n\`\`\``);
    expect(result).toHaveLength(3);
  });

  it('拒绝数量或字段不完整的结果', () => {
    expect(() => parseStoryOptions(JSON.stringify({ options: [option] }))).toThrow();
    expect(() => parseStoryOptions(JSON.stringify({ options: [{ ...option, logline: '' }, option, option] }))).toThrow();
  });
});

describe('parseMasterOutline', () => {
  const phase = {
    title: '建立旧世界', purpose: '建立人物和问题', chapterRange: '1-20章',
    keyEvents: ['事件一', '事件二', '事件三'], turningPoint: '主角无法回头', emotionTrend: '平稳转紧张',
  };
  const outline = {
    premise: '核心前提', ending: '结局方向', protagonistArc: '人物变化', centralConflict: '主要对抗',
    structureModel: '五阶段结构', phases: [phase, phase, phase, phase],
    subplots: ['关系副线', '秘密副线'], storyPromises: ['兑现能力成长', '兑现核心谜团'],
  };

  it('接受包含四个阶段的完整总纲', () => {
    expect(parseMasterOutline(JSON.stringify(outline)).phases).toHaveLength(4);
  });

  it('拒绝阶段或故事承诺不足的总纲', () => {
    expect(() => parseMasterOutline(JSON.stringify({ ...outline, phases: [phase] }))).toThrow();
    expect(() => parseMasterOutline(JSON.stringify({ ...outline, storyPromises: [] }))).toThrow();
  });
});

describe('parseVolumeOutlines', () => {
  const volume = {
    title: '第一卷', chapterRange: '1-30章', volumeGoal: '完成阶段目标', openingState: '主角尚未入局',
    mainProgression: '主线推进一层', characterProgression: '主角建立第一段关系',
    keyEvents: ['事件一', '事件二', '事件三', '事件四'], climax: '付出代价后胜出', endingState: '进入新局面',
    promisesOpened: ['新的秘密'], promisesPaid: [],
  };

  it('接受至少两卷且字段完整的分卷纲', () => {
    expect(parseVolumeOutlines(JSON.stringify({ volumes: [volume, { ...volume, title: '第二卷' }] }))).toHaveLength(2);
  });

  it('拒绝卷数或关键事件不足的分卷纲', () => {
    expect(() => parseVolumeOutlines(JSON.stringify({ volumes: [volume] }))).toThrow();
    expect(() => parseVolumeOutlines(JSON.stringify({ volumes: [volume, { ...volume, keyEvents: [] }] }))).toThrow();
  });
});

describe('parseChapterOutlines', () => {
  const chapter = {
    volumeIndex: 0, chapterNumber: 1, title: '入局', pov: '主角', chapterGoal: '迫使主角作出选择',
    openingSituation: '主角试图维持日常', centralConflict: '对手逼迫且拒绝会失去家园',
    keyBeats: ['异常出现', '主角拒绝', '代价落下'], reveal: '敌人知道主角身份',
    characterChange: '主角从回避转为应对', emotionalBeat: '不安转紧迫', payoff: '主角第一次反击', endingHook: '家人突然失踪',
  };

  it('接受卷序一致、章节递增的完整章纲', () => {
    const chapters = [chapter, { ...chapter, chapterNumber: 2, title: '追踪' }];
    const parsed = parseChapterOutlines(JSON.stringify({ chapters }), 0);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]!.id).toBeTruthy();
    expect(parsed[1]!.id).toBeTruthy();
    expect(parsed[0]!.id).not.toBe(parsed[1]!.id);
  });

  it('保留来源已有的章纲 id', () => {
    const chapters = [
      { ...chapter, id: 'keep-a' },
      { ...chapter, chapterNumber: 2, title: '追踪', id: 'keep-b' },
    ];
    const parsed = parseChapterOutlines(JSON.stringify({ chapters }), 0);
    expect(parsed.map((c) => c.id)).toEqual(['keep-a', 'keep-b']);
  });

  it('拒绝卷序错误、章节倒序或关键节拍不足', () => {
    expect(() => parseChapterOutlines(JSON.stringify({ chapters: [chapter, { ...chapter, chapterNumber: 2, volumeIndex: 1 }] }), 0)).toThrow();
    expect(() => parseChapterOutlines(JSON.stringify({ chapters: [{ ...chapter, chapterNumber: 2 }, chapter] }), 0)).toThrow();
    expect(() => parseChapterOutlines(JSON.stringify({ chapters: [chapter, { ...chapter, chapterNumber: 3 }] }), 0)).toThrow();
    expect(() => parseChapterOutlines(JSON.stringify({ chapters: [chapter, { ...chapter, chapterNumber: 2, keyBeats: [] }] }), 0)).toThrow();
  });
});

describe('formatStagesContext', () => {
  const mkStage = (over: Partial<VolumeStage> = {}): VolumeStage => ({
    title: '阶段1', chapterRange: '第 1-15 章', goal: '目标', keyProgressions: [], characters: [], worldRefs: [], exit: '出口', endingHook: '', ...over,
  });
  const mkVol = (title: string, stages?: VolumeStage[]): VolumeOutline => ({
    title, chapterRange: '第 1-50 章', volumeGoal: '', openingState: '', mainProgression: '',
    characterProgression: '', keyEvents: [], climax: '', endingState: '', promisesOpened: [], promisesPaid: [],
    stages,
  });

  it('卷号取自 entry.index 而非数组位置（full 与 brief 都要）', () => {
    const full = formatStagesContext([{ index: 2, volume: mkVol('卷三', [mkStage()]) }], 'full');
    expect(full).toContain('第3卷');
    expect(full).not.toContain('第1卷');
    const brief = formatStagesContext([{ index: 3, volume: mkVol('卷四', [mkStage()]) }], 'brief');
    expect(brief).toContain('第4卷');
  });

  it('full 模式输出标题/章范围/目标/关键推进/出口', () => {
    const vol = mkVol('卷三', [mkStage({ goal: '达成目标', keyProgressions: ['推进1', '推进2'], exit: '离开' })]);
    const out = formatStagesContext([{ index: 2, volume: vol }], 'full')!;
    expect(out).toContain('阶段1');
    expect(out).toContain('第 1-15 章');
    expect(out).toContain('达成目标');
    expect(out).toContain('推进1');
    expect(out).toContain('推进2');
    expect(out).toContain('离开');
  });

  it('brief 模式不含 keyProgressions 与 endingHook', () => {
    const vol = mkVol('卷四', [mkStage({ goal: '目标A', keyProgressions: ['不该出现'], exit: '出口A', endingHook: '不该出现钩子' })]);
    const out = formatStagesContext([{ index: 3, volume: vol }], 'brief')!;
    expect(out).toContain('目标A');
    expect(out).toContain('出口A');
    expect(out).not.toContain('不该出现');
    expect(out).not.toContain('不该出现钩子');
  });

  it('endingHook 为空则 full 模式整行省略，非空则输出', () => {
    const empty = formatStagesContext([{ index: 0, volume: mkVol('卷一', [mkStage({ endingHook: '' })]) }], 'full')!;
    expect(empty).not.toContain('卷末钩子');
    const withHook = formatStagesContext([{ index: 0, volume: mkVol('卷一', [mkStage({ endingHook: '钩子内容' })]) }], 'full')!;
    expect(withHook).toContain('卷末钩子');
    expect(withHook).toContain('钩子内容');
  });

  it('goal 或 exit 为空时省略对应位置', () => {
    const out = formatStagesContext([{ index: 0, volume: mkVol('卷一', [mkStage({ goal: '', exit: '' })]) }], 'full')!;
    expect(out).not.toContain('目标：');
    expect(out).not.toContain('→');
  });

  it('全部 entries 无 stages 或 entries 为空 → 返回 null', () => {
    expect(formatStagesContext([], 'full')).toBeNull();
    expect(formatStagesContext([{ index: 0, volume: mkVol('卷一') }], 'full')).toBeNull();
    expect(formatStagesContext([{ index: 0, volume: mkVol('卷一', []) }], 'brief')).toBeNull();
  });

  it('部分有部分无：只输出有阶段的卷，不为空卷留标题行', () => {
    const out = formatStagesContext([
      { index: 0, volume: mkVol('卷一', [mkStage()]) },
      { index: 1, volume: mkVol('卷二') },        // stages 缺省
      { index: 2, volume: mkVol('卷三', []) },     // stages 空数组
    ], 'full')!;
    expect(out).toContain('卷一');
    expect(out).not.toContain('卷二');
    expect(out).not.toContain('卷三');
  });

  it('截断 goal/exit/keyProgressions/endingHook', () => {
    const longGoal = '目'.repeat(200);
    const longExit = '出'.repeat(200);
    const longKp = '推'.repeat(100);
    const kps = Array.from({ length: 10 }, (_, i) => `推进${i}`).concat([longKp]);
    const out = formatStagesContext([{ index: 0, volume: mkVol('卷一', [mkStage({ goal: longGoal, exit: longExit, keyProgressions: kps, endingHook: '钩'.repeat(100) })]) }], 'full')!;
    expect(out).not.toContain(longGoal);
    expect(out).not.toContain(longExit);
    expect(out).not.toContain(longKp);
    expect(out).toContain('…'); // 截断标记
    // keyProgressions 最多 8 条
    expect(out).not.toContain('推进8');
  });

  it('不泄漏 characters / worldRefs（两种模式）', () => {
    const vol = mkVol('卷一', [mkStage({ characters: ['米尘'], worldRefs: ['ABO规则'] })]);
    const full = formatStagesContext([{ index: 0, volume: vol }], 'full')!;
    const brief = formatStagesContext([{ index: 0, volume: vol }], 'brief')!;
    expect(full).not.toContain('米尘');
    expect(full).not.toContain('ABO规则');
    expect(brief).not.toContain('米尘');
    expect(brief).not.toContain('ABO规则');
  });
});

describe('buildChapterOutlinesPrompt 拆章注入 stages', () => {
  const option: StoryOption = {
    title: '书名', logline: '一句话', targetReader: '读者', corePromise: '承诺',
    protagonist: '主角', centralConflict: '冲突', differentiator: '差异', endingDirection: '结局',
  };
  const outline: MasterOutline = {
    premise: '前提', ending: '结局', protagonistArc: '弧', centralConflict: '冲突',
    structureModel: '模型', phases: [], subplots: [], storyPromises: [],
  };
  const mkStage = (title: string, over: Partial<VolumeStage> = {}): VolumeStage => ({
    title, chapterRange: '', goal: '', keyProgressions: [], characters: [], worldRefs: [], exit: '', endingHook: '', ...over,
  });
  const mkVol = (title: string, stages?: VolumeStage[]): VolumeOutline => ({
    title, chapterRange: '', volumeGoal: '', openingState: '', mainProgression: '',
    characterProgression: '', keyEvents: [], climax: '', endingState: '', promisesOpened: [], promisesPaid: [],
    stages,
  });
  const userContent = (volumes: VolumeOutline[], idx: number) =>
    buildChapterOutlinesPrompt({ name: '书', typeTags: [], style: '', summary: '', obsidianPath: '', createdAt: '', updatedAt: '' }, option, outline, volumes, idx, '要求', [])[1].content;

  it('当前卷带 stages → 完整形块含关键推进；相邻卷带 stages → 精简形块', () => {
    const volumes = [
      mkVol('卷一', [mkStage('一阶段1', { goal: 'g1', keyProgressions: ['推进1'] })]),
      mkVol('卷二', [mkStage('二阶段1', { goal: 'g2', keyProgressions: ['推进2'] })]),
      mkVol('卷三', [mkStage('三阶段1', { goal: 'g3', keyProgressions: ['推进3'] })]),
    ];
    const c = userContent(volumes, 1);
    expect(c).toContain('卷内阶段');
    expect(c).toContain('第2卷');       // 当前卷完整形
    expect(c).toContain('推进2');       // 当前卷 keyProgressions
    expect(c).toContain('相邻卷阶段');
    expect(c).toContain('第1卷');       // 相邻卷 brief
    expect(c).toContain('第3卷');
    expect(c).not.toContain('推进1');   // 相邻卷 brief 不含 keyProgressions
    expect(c).not.toContain('推进3');
  });

  it('当前卷带 stages、相邻卷无 → 只有完整形块，无相邻卷阶段块', () => {
    const volumes = [mkVol('卷一'), mkVol('卷二', [mkStage('二阶段1')]), mkVol('卷三')];
    const c = userContent(volumes, 1);
    expect(c).toContain('卷内阶段');
    expect(c).not.toContain('相邻卷阶段');
  });

  it('当前卷无 stages、相邻卷有 → 整个阶段区段都不出现', () => {
    const volumes = [mkVol('卷一', [mkStage('一阶段1')]), mkVol('卷二'), mkVol('卷三', [mkStage('三阶段1')])];
    const c = userContent(volumes, 1);
    expect(c).not.toContain('卷内阶段');
    expect(c).not.toContain('相邻卷阶段');
  });

  it('首末卷只取存在的一侧，不越界', () => {
    const volumes = [mkVol('卷一', [mkStage('一阶段1')]), mkVol('卷二', [mkStage('二阶段1')])];
    const first = userContent(volumes, 0);
    expect(first).toContain('相邻卷阶段');
    expect(first).toContain('第2卷');
    expect(first).not.toContain('第0卷');
    const last = userContent(volumes, 1);
    expect(last).toContain('第1卷');
    expect(last).not.toContain('第3卷');
  });

  it('卷号端到端保真：拆第 3 卷标第3卷、相邻标第2/4卷', () => {
    const volumes = [
      mkVol('卷一', [mkStage('a')]), mkVol('卷二', [mkStage('b')]),
      mkVol('卷三', [mkStage('c')]), mkVol('卷四', [mkStage('d')]),
    ];
    const c = userContent(volumes, 2);
    expect(c).toContain('第3卷「卷三」');
    expect(c).toContain('第2卷「卷二」');
    expect(c).toContain('第4卷「卷四」');
    expect(c).not.toContain('第1卷「卷三」'); // 不得错标成切片下标
  });

  it('输入不带 stages → 不含任何阶段块（回归不破）', () => {
    const volumes = [mkVol('卷一'), mkVol('卷二')];
    const c = userContent(volumes, 0);
    expect(c).not.toContain('卷内阶段');
    expect(c).not.toContain('相邻卷阶段');
  });

  it('卷 JSON 中仍无 stages 键（不重复输出）', () => {
    const volumes = [mkVol('卷一', [mkStage('a', { goal: 'g' })]), mkVol('卷二', [mkStage('b')])];
    const c = userContent(volumes, 0);
    // 卷 JSON 剥掉 stages 后，content 里不应出现 JSON 键形式 `"stages"`（formatStagesContext 输出的是中文「阶段」，不含该字面量）
    expect(c).toContain('卷内阶段');      // 阶段文本块在
    expect(c).not.toContain('"stages"');   // 但卷 JSON 里无 stages 键
  });
});

describe('formatPlanningAuthorityContext（A4a）', () => {
  const mkMaster = (over: Partial<MasterOutline> = {}): MasterOutline => ({
    premise: '核心前提', ending: '结局', protagonistArc: '人物弧', centralConflict: '冲突',
    structureModel: '结构', phases: [{ title: '阶段1', purpose: '', chapterRange: '', keyEvents: [], turningPoint: '', emotionTrend: '' }],
    subplots: [], storyPromises: [], ...over,
  });
  const mkChapter = (over: Partial<ChapterOutline> = {}): ChapterOutline => ({
    volumeIndex: 0, chapterNumber: 1, title: '第一章', pov: '', chapterGoal: '本章任务',
    openingSituation: '', centralConflict: '', keyBeats: [], reveal: '', characterChange: '',
    emotionalBeat: '', payoff: '', endingHook: '', ...over,
  });
  const mkPlanning = (over: Partial<PlanningIdea> = {}): PlanningIdea => ({
    id: 'p1', projectId: 'p1', idea: '', requirements: '', generatedOptions: [], selectedOption: null,
    status: 'confirmed', masterOutline: null, outlineStatus: 'empty', volumeOutlines: [], volumeStatus: 'empty',
    chapterOutlines: [], chapterOutlineStatus: 'empty', createdAt: '', updatedAt: '', ...over,
  });

  it('null/undefined planning 返回 null', () => {
    expect(formatPlanningAuthorityContext(null)).toBeNull();
    expect(formatPlanningAuthorityContext(undefined)).toBeNull();
  });

  it('有总纲时注入前提/冲突/结局/阶段标题', () => {
    const out = formatPlanningAuthorityContext(mkPlanning({ masterOutline: mkMaster() }));
    expect(out).toContain('全书结构');
    expect(out).toContain('核心前提');
    expect(out).toContain('冲突');
    expect(out).toContain('阶段1');
  });

  it('当前章有施工卡时用施工卡字段（chapterGoal/pov/endingHook）', () => {
    const card = mkChapter({ chapterGoal: '本章目标X', pov: '主角', endingHook: '钩子Y' });
    const out = formatPlanningAuthorityContext(mkPlanning(), { planningOutline: card } as any);
    expect(out).toContain('当前章施工卡');
    expect(out).toContain('本章目标X');
    expect(out).toContain('主角');
    expect(out).toContain('钩子Y');
  });

  it('无施工卡但章纲存在时注入章标题+一句任务', () => {
    const out = formatPlanningAuthorityContext(mkPlanning({ chapterOutlines: [mkChapter({ title: '第一章', chapterGoal: '目标A' })] }), { planningOutline: null } as any);
    expect(out).toContain('第1章 第一章：目标A');
  });

  it('完全无内容返回 null', () => {
    expect(formatPlanningAuthorityContext(mkPlanning())).toBeNull();
  });
});

