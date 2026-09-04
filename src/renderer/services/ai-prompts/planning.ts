import type { ChapterOutline, MasterOutline, Project, StoryOption, VolumeOutline, WritingSkill } from '../../types';

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

export function buildChapterOutlinesPrompt(
  project: Project, option: StoryOption, outline: MasterOutline, volumes: VolumeOutline[],
  volumeIndex: number, requirements: string, skills: WritingSkill[],
): Array<{ role: 'system' | 'user'; content: string }> {
  const methods = skills.map(skill => `\n## ${skill.id}\n${skill.content}`).join('\n');
  const volume = volumes[volumeIndex];
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

# 全部分卷（用于前后衔接）\n${JSON.stringify(volumes, null, 2)}

# 本次只拆第 ${volumeIndex + 1} 卷\n${JSON.stringify(volume, null, 2)}

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
