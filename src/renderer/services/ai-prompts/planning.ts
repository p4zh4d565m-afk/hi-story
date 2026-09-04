import type { Project, StoryOption, WritingSkill } from '../../types';

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
