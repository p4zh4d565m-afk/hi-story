import type { Chapter, ChapterOutline, MasterOutline, PlanningIdea, Project, StoryOption, VolumeOutline, VolumeStage, WritingSkill } from '../../types';

export function buildStoryOptionsPrompt(
  project: Project,
  idea: string,
  requirements: string,
  skills: WritingSkill[],
): Array<{ role: 'system' | 'user'; content: string }> {
  const methods = skills.map(skill => `\n## ${skill.id}\n${skill.content}`).join('\n');
  return [
    {
      role: 'system',
      content: `你是小说策划编辑。你的任务不是代写正文，而是把作者的原始想法发展成可供选择的故事方向。

必须尊重作者已有想法，不擅自替作者锁死题材。三个方案要有实质差异，不能只替换名字。
仅输出合法 JSON，不要使用 Markdown 代码块，不要附加解释。输出格式：
{"options":[{"title":"暂定书名","logline":"一句话故事","targetReader":"目标读者","corePromise":"持续提供给读者的核心体验","protagonist":"主角、欲望与短板","centralConflict":"主要对抗和失败代价","differentiator":"与同类作品的差异","endingDirection":"结局方向，不必写死细节"}]}
options 必须正好包含 3 项，每个字段都必须有内容。`,
    },
    {
      role: 'user',
      content: `# 当前项目
项目名：${project.name}
类型标签：${project.typeTags.join('、') || '尚未确定'}
已有简介：${project.summary || '无'}

# 作者的原始想法
${idea}

# 额外要求
${requirements || '无，优先保留创意空间'}

# 本次采用的写作方法
${methods}

请给出三个清楚、能继续发展成长篇大纲的候选方案。`,
    },
  ];
}

export function parseStoryOptions(raw: string): StoryOption[] {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI 没有返回可识别的方案数据');
  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as { options?: StoryOption[] };
  if (!Array.isArray(parsed.options) || parsed.options.length !== 3) {
    throw new Error('AI 返回的候选方案数量不正确，请重新生成');
  }
  const required: Array<keyof StoryOption> = [
    'title', 'logline', 'targetReader', 'corePromise', 'protagonist',
    'centralConflict', 'differentiator', 'endingDirection',
  ];
  for (const option of parsed.options) {
    if (required.some(key => typeof option[key] !== 'string' || !option[key].trim())) {
      throw new Error('AI 返回的候选方案字段不完整，请重新生成');
    }
  }
  return parsed.options;
}

export function buildMasterOutlinePrompt(
  project: Project,
  option: StoryOption,
  requirements: string,
  skills: WritingSkill[],
): Array<{ role: 'system' | 'user'; content: string }> {
  const methods = skills.map(skill => `\n## ${skill.id}\n${skill.content}`).join('\n');
  return [
    {
      role: 'system',
      content: `你是长篇小说总纲策划编辑。把作者已确认的故事方向发展成可继续拆分卷纲的全书骨架。
不要代写正文，不要擅自改变已确认的核心承诺。事件必须有因果递进，每一阶段都改变局面。结构模型应根据题材选择，不机械套三幕。
仅输出合法 JSON，不要 Markdown 代码块或解释。格式：
{"premise":"故事核心前提","ending":"明确但保留细节空间的结局","protagonistArc":"主角开头到结尾的变化","centralConflict":"贯穿全书的对抗","structureModel":"采用的结构及理由","phases":[{"title":"阶段名","purpose":"阶段功能","chapterRange":"建议章节范围","keyEvents":["关键事件1","关键事件2","关键事件3"],"turningPoint":"阶段末不可逆转折","emotionTrend":"读者情绪走势"}],"subplots":["副线及其与主线交汇方式"],"storyPromises":["必须在后文兑现的承诺"]}
phases 必须包含 4—6 个阶段；每阶段至少 3 个关键事件；subplots 和 storyPromises 各至少 2 项。`,
    },
    {
      role: 'user',
      content: `# 项目
项目名：${project.name}
类型：${project.typeTags.join('、') || '尚未确定'}

# 已确认故事方向
${JSON.stringify(option, null, 2)}

# 作者补充要求
${requirements || '无'}

# 本次采用的方法
${methods}

请生成能够继续拆成分卷纲的结构化全书总纲。`,
    },
  ];
}

export function parseMasterOutline(raw: string): MasterOutline {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI 没有返回可识别的总纲数据');
  const data = JSON.parse(cleaned.slice(start, end + 1)) as MasterOutline;
  const topFields: Array<keyof Pick<MasterOutline, 'premise' | 'ending' | 'protagonistArc' | 'centralConflict' | 'structureModel'>> =
    ['premise', 'ending', 'protagonistArc', 'centralConflict', 'structureModel'];
  if (topFields.some(key => typeof data[key] !== 'string' || !data[key].trim())) throw new Error('AI 返回的总纲核心字段不完整');
  if (!Array.isArray(data.phases) || data.phases.length < 4 || data.phases.length > 6) throw new Error('总纲必须包含 4—6 个阶段');
  for (const phase of data.phases) {
    if (!phase.title || !phase.purpose || !phase.chapterRange || !phase.turningPoint || !phase.emotionTrend || !Array.isArray(phase.keyEvents) || phase.keyEvents.length < 3) {
      throw new Error('AI 返回的阶段字段或关键事件不完整');
    }
  }
  if (!Array.isArray(data.subplots) || data.subplots.length < 2 || !Array.isArray(data.storyPromises) || data.storyPromises.length < 2) {
    throw new Error('总纲的副线或故事承诺不完整');
  }
  return data;
}

export function buildVolumeOutlinesPrompt(
  project: Project,
  option: StoryOption,
  outline: MasterOutline,
  requirements: string,
  skills: WritingSkill[],
): Array<{ role: 'system' | 'user'; content: string }> {
  const methods = skills.map(skill => `\n## ${skill.id}\n${skill.content}`).join('\n');
  return [
    {
      role: 'system',
      content: `你是长篇小说分卷策划编辑。根据已经锁定的全书总纲生成分卷纲，为下一步拆章节表提供稳定边界。
每卷必须有独立目标、阶段性高潮和状态变化，同时推进全书主线。不能把全书阶段机械改名，也不能提前代写章节正文。
仅输出合法 JSON，不要 Markdown 或解释。格式：
{"volumes":[{"title":"卷名","chapterRange":"建议章节范围","volumeGoal":"本卷必须解决的阶段目标","openingState":"开卷时人物和局面","mainProgression":"主线如何推进","characterProgression":"人物或关系如何变化","keyEvents":["事件1","事件2","事件3","事件4"],"climax":"本卷高潮及不可逆代价","endingState":"卷末形成的新局面","promisesOpened":["本卷新建承诺"],"promisesPaid":["本卷兑现的旧承诺"]}]}
卷数依据总纲决定，通常 3—8 卷；每卷至少 4 个关键事件，承诺数组可以为空但字段必须存在。章节范围应连续且不重叠。`,
    },
    {
      role: 'user',
      content: `# 项目与已确认方向
${project.name} / ${project.typeTags.join('、') || '类型未定'}
${JSON.stringify(option, null, 2)}

# 已锁定全书总纲
${JSON.stringify(outline, null, 2)}

# 作者要求
${requirements || '无'}

# 本次采用的方法
${methods}

请拆出能直接用于生成章节清单的分卷纲。`,
    },
  ];
}

export function parseVolumeOutlines(raw: string): VolumeOutline[] {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI 没有返回可识别的分卷纲数据');
  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as { volumes?: VolumeOutline[] };
  if (!Array.isArray(parsed.volumes) || parsed.volumes.length < 2 || parsed.volumes.length > 10) {
    throw new Error('分卷纲应包含 2—10 卷');
  }
  for (const volume of parsed.volumes) {
    if (!volume.title || !volume.chapterRange || !volume.volumeGoal || !volume.openingState ||
      !volume.mainProgression || !volume.characterProgression || !volume.climax || !volume.endingState ||
      !Array.isArray(volume.keyEvents) || volume.keyEvents.length < 4 ||
      !Array.isArray(volume.promisesOpened) || !Array.isArray(volume.promisesPaid)) {
      throw new Error('AI 返回的分卷字段或关键事件不完整');
    }
  }
  return parsed.volumes;
}

/** 每项必须携带该卷在全书分卷列表中的绝对下标，函数内不得用数组位置推断卷号 */
export interface StageContextEntry { index: number; volume: VolumeOutline }

const sliceMax = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s);

/**
 * 把卷内阶段格式化为有界上下文文本。
 * - full（当前卷）：含 keyProgressions 与非空 endingHook，用于约束拆出的 keyBeats。
 * - brief（相邻卷）：每阶段一行「标题（章范围）：目标 → 出口」，只要边界感。
 * - 卷号取 entry.index + 1，不用数组位置；逐项跳过无 stages 的卷；全部空则返回 null。
 * - 永不取 characters / worldRefs。
 */
export function formatStagesContext(entries: StageContextEntry[], mode: 'full' | 'brief'): string | null {
  const sections: string[] = [];
  for (const entry of entries) {
    const stages = entry.volume.stages ?? [];
    if (stages.length === 0) continue;
    const title = `第${entry.index + 1}卷「${entry.volume.title || '未命名'}」：`;
    if (mode === 'brief') {
      const lines = stages.map(s => {
        const range = s.chapterRange ? `（${s.chapterRange}）` : '';
        const parts = [`- ${s.title}${range}`];
        const goal = s.goal ? sliceMax(s.goal, 120) : '';
        const exit = s.exit ? sliceMax(s.exit, 120) : '';
        if (goal || exit) parts.push(`：${[goal, exit].filter(Boolean).join(' → ')}`);
        return parts.join('');
      });
      sections.push(`${title}\n${lines.join('\n')}`);
    } else {
      const blocks = stages.map(s => {
        const lines: string[] = [];
        const range = s.chapterRange ? `（${s.chapterRange}）` : '';
        lines.push(`### ${s.title}${range}`);
        if (s.goal) lines.push(`目标：${sliceMax(s.goal, 120)}`);
        if (s.keyProgressions.length) {
          const shown = s.keyProgressions.slice(0, 8).map(k => sliceMax(k, 60));
          const more = s.keyProgressions.length > 8 ? '…' : '';
          lines.push(`关键推进：${shown.join(' / ')}${more}`);
        }
        if (s.exit) lines.push(`出口：${sliceMax(s.exit, 120)}`);
        if (s.endingHook) lines.push(`卷末钩子：${sliceMax(s.endingHook, 80)}`);
        return lines.join('\n');
      });
      sections.push(`${title}\n${blocks.join('\n')}`);
    }
  }
  if (sections.length === 0) return null;
  return sections.join('\n');
}

/**
 * 把策划总纲/章纲格式化为普通对话用的有界结构上下文（A4a）。
 *
 * - 有 masterOutline：注入前提/结局/主线冲突/阶段标题（有界）。
 * - 当前章对得上施工卡（activeChapter.planningOutline）则用施工卡字段；
 *   否则若 chapterOutlines 非空，注入当前卷章标题 + 一句任务。
 * - 只读 planning 侧结构；调用方在 planning 存在时不再把 outlineNodes 放入同一 system。
 * - 全部无内容返回 null。
 */
export function formatPlanningAuthorityContext(
  planning: PlanningIdea | null | undefined,
  activeChapter?: { planningOutline?: ChapterOutline | null; chapterNumber?: number } | null,
): string | null {
  if (!planning) return null;
  const parts: string[] = [];

  if (planning.masterOutline) {
    const m = planning.masterOutline;
    const lines: string[] = ['## 全书结构（策划工作台）'];
    if (m.premise) lines.push(`核心前提：${sliceMax(m.premise, 160)}`);
    if (m.centralConflict) lines.push(`贯穿冲突：${sliceMax(m.centralConflict, 160)}`);
    if (m.ending) lines.push(`结局方向：${sliceMax(m.ending, 160)}`);
    const phases = m.phases ?? [];
    if (phases.length) {
      lines.push(`全书阶段：${phases.slice(0, 8).map(p => p.title).filter(Boolean).join(' → ')}`);
    }
    parts.push(lines.join('\n'));
  }

  // 当前章施工卡优先
  const card = activeChapter?.planningOutline;
  if (card) {
    const lines: string[] = ['## 当前章施工卡'];
    if (card.chapterGoal) lines.push(`本章任务：${sliceMax(card.chapterGoal, 120)}`);
    if (card.pov) lines.push(`视角：${sliceMax(card.pov, 40)}`);
    if (card.centralConflict) lines.push(`核心冲突：${sliceMax(card.centralConflict, 120)}`);
    if (card.keyBeats?.length) lines.push(`关键节拍：${card.keyBeats.slice(0, 8).map(k => sliceMax(k, 40)).join(' → ')}`);
    if (card.endingHook) lines.push(`章末钩子：${sliceMax(card.endingHook, 80)}`);
    parts.push(lines.join('\n'));
  } else if (planning.chapterOutlines?.length) {
    const chapters = planning.chapterOutlines;
    const list = chapters.slice(0, 30).map(c => {
      const task = c.chapterGoal ? `：${sliceMax(c.chapterGoal, 40)}` : '';
      return `第${c.chapterNumber}章 ${c.title}${task}`;
    });
    parts.push(`## 当前卷章纲\n${list.join('\n')}`);
  }

  if (parts.length === 0) return null;
  return parts.join('\n\n');
}

export function buildChapterOutlinesPrompt(
  project: Project, option: StoryOption, outline: MasterOutline, volumes: VolumeOutline[],
  volumeIndex: number, requirements: string, skills: WritingSkill[],
): Array<{ role: 'system' | 'user'; content: string }> {
  const methods = skills.map(skill => `\n## ${skill.id}\n${skill.content}`).join('\n');
  const volume = volumes[volumeIndex];
  // 卷 JSON 里剥掉 stages（避免整份 JSON 重复输出阶段），另由 formatStagesContext 有界注入
  const volumeForPrompt = (({ stages, ...rest }: VolumeOutline) => rest)(volume);
  const volumesForPrompt = volumes.map(({ stages, ...rest }: VolumeOutline) => rest);

  // 当前卷无 stages 则整段不注入（先算 full，为 null 则跳过，不再算 brief）
  const fullBlock = formatStagesContext([{ index: volumeIndex, volume }], 'full');
  let stagesBlock = '';
  if (fullBlock) {
    const adjacent: StageContextEntry[] = [];
    if (volumeIndex - 1 >= 0) adjacent.push({ index: volumeIndex - 1, volume: volumes[volumeIndex - 1] });
    if (volumeIndex + 1 < volumes.length) adjacent.push({ index: volumeIndex + 1, volume: volumes[volumeIndex + 1] });
    const briefBlock = formatStagesContext(adjacent, 'brief');
    stagesBlock = `\n\n# 卷内阶段（施工依据）\n以下为作者手写的卷内阶段，是本卷的施工依据；关键节拍必须与阶段的关键推进一致，不得另起炉灶。\n${fullBlock}${briefBlock ? `\n\n## 相邻卷阶段\n${briefBlock}` : ''}\n`;
  }

  return [
    {
      role: 'system',
      content: `你是长篇小说章纲策划编辑。把指定分卷拆成作者可以直接填充正文的逐章施工表，不代写正文。
每章必须推进局面，关键节拍要有因果关系；相邻章节避免重复功能。章末钩子必须具体，不能只写“留下悬念”。
仅输出合法 JSON，不要 Markdown 或解释。格式：
{"chapters":[{"volumeIndex":0,"chapterNumber":1,"title":"章名","pov":"本章视角人物","chapterGoal":"本章要完成的叙事任务","openingSituation":"开场人物处境","centralConflict":"具体阻力与失败代价","keyBeats":["节拍1","节拍2","节拍3"],"reveal":"本章新增或揭示的信息","characterChange":"人物/关系状态变化","emotionalBeat":"读者主要情绪体验","payoff":"本章兑现的爽点、承诺或小回报；没有则写无","endingHook":"迫使读者翻页的具体问题或变化"}]}
chapterNumber 必须覆盖指定章节范围且连续；volumeIndex 固定为给定值；每章至少 3 个关键节拍，所有字段必须存在。`,
    },
    {
      role: 'user',
      content: `# 项目与已确认方向\n${project.name} / ${project.typeTags.join('、') || '类型未定'}\n${JSON.stringify(option, null, 2)}

# 全书总纲\n${JSON.stringify(outline, null, 2)}

# 全部分卷（用于前后衔接）\n${JSON.stringify(volumesForPrompt, null, 2)}

# 本次只拆第 ${volumeIndex + 1} 卷\n${JSON.stringify(volumeForPrompt, null, 2)}
${stagesBlock}
# 作者要求\n${requirements || '无'}

# 本次采用的方法\n${methods}

请生成本卷逐章章纲。`,
    },
  ];
}

export function parseChapterOutlines(raw: string, expectedVolumeIndex?: number): ChapterOutline[] {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI 没有返回可识别的章纲数据');
  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as { chapters?: ChapterOutline[] };
  if (!Array.isArray(parsed.chapters) || parsed.chapters.length < 2) throw new Error('本卷章纲至少应包含 2 章');
  let previous = 0;
  for (let index = 0; index < parsed.chapters.length; index += 1) {
    const chapter = parsed.chapters[index];
    const fields: Array<keyof Pick<ChapterOutline, 'title' | 'pov' | 'chapterGoal' | 'openingSituation' | 'centralConflict' | 'reveal' | 'characterChange' | 'emotionalBeat' | 'payoff' | 'endingHook'>> =
      ['title', 'pov', 'chapterGoal', 'openingSituation', 'centralConflict', 'reveal', 'characterChange', 'emotionalBeat', 'payoff', 'endingHook'];
    if (!Number.isInteger(chapter.chapterNumber) || chapter.chapterNumber <= previous ||
      (index > 0 && chapter.chapterNumber !== previous + 1) ||
      !Number.isInteger(chapter.volumeIndex) ||
      (expectedVolumeIndex !== undefined && chapter.volumeIndex !== expectedVolumeIndex) ||
      fields.some(field => typeof chapter[field] !== 'string' || !chapter[field].trim()) ||
      !Array.isArray(chapter.keyBeats) || chapter.keyBeats.length < 3) {
      throw new Error('AI 返回的章纲字段、卷序或章节顺序不正确');
    }
    previous = chapter.chapterNumber;
  }
  return parsed.chapters;
}
