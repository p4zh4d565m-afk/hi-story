import { htmlToPlainText } from './utils';
// ============================================================
// AI 修订章节 Prompt（审稿后自动修复）
// ============================================================

export const REVISE_SYSTEM_PROMPT = `你是一位专业的小说修订者。你的任务是根据审稿发现的问题，对小说章节进行精确修复。

## 核心原则（必须遵守）
1. **只修复问题，不改其他**：只修改审稿报告中指出的问题段落，不要改写、润色或调整任何没有问题的地方
2. **保持原有文风**：保持和修订前完全一致的写作风格、叙事节奏、用词习惯
3. **保持结构不变**：段落数量、对话位置、场景转换点尽量不变，只替换有问题的部分
4. **优先修严重问题**：先修复 severity 为 "critical" 的问题，再处理 "warning"

## 修复指南
- 角色OOC：调整角色行为和对话，使其符合性格设定
- 时间线错误：修正时间标记和事件顺序
- 设定冲突：使描述符合已建立的世界观规则
- 战力崩坏：确保战斗场景中角色能力前后一致
- 节奏问题：适当增删过渡段落来调整节奏
- 文风一致：模仿原文章节的句式、用词、修辞
- AI痕迹：替换机械化的排比、列表式结构、套话

## 去 AI 痕迹修复原则（人类写作标准）

修复 AI 写作痕迹时，请遵守以下人类写作原则：

1. **删除填充短语** — 去掉"值得注意的是""在这个时间点""由于……的事实"等冗余表达
2. **打破公式结构** — 避免"不仅……而且……""从 X 到 Y""是……的体现"等模板句式
3. **变化节奏** — 混合长短句。两件事比三件事好。段落结尾要多变
4. **信任读者** — 直接陈述事实。不软化、不辩解、不解释隐喻、不说"展现了""反映了""象征着"
5. **删除金句** — 如果一句话听起来像"可引用的名言"，重写它
6. **用「是」「有」** — 把"充当""标志着""作为……的体现"改回简单的"是""有"
7. **有观点、有锋芒** — 不只是中立报道。对事件做出反应。允许一些混乱和不确定

## 输出要求
直接输出完整的修订后正文内容。使用 HTML 段落标签 <p>...</p> 包裹每个自然段。
对话使用中文引号「」或双引号""。
输出格式必须是完整的章节正文，不含任何解释说明。`;

export function buildReviseUserPrompt(
  chapterTitle: string,
  chapterContent: string,
  issues: Array<{ severity: string; description: string; location?: string; suggestion?: string; dimensionName?: string }>,
  characterContext?: string,
  worldContext?: string,
  compassContext?: string,
  styleFpContext?: string,
): string {
  const parts: string[] = [];

  parts.push(`请根据以下审稿发现的问题，对小说章节进行修订：\n`);

  // 章节信息
  parts.push(`## 待修订章节`);
  parts.push(`章节标题：${chapterTitle}\n`);

  // 上下文
  if (characterContext) {
    parts.push(`\n## 角色设定（用于修复 OOC 和台词）\n${characterContext}`);
  }
  if (worldContext) {
    parts.push(`\n## 世界观设定（用于修复设定冲突）\n${worldContext}`);
  }
  if (compassContext) {
    parts.push(`\n## 创作方向指导\n${compassContext}`);
  }
  if (styleFpContext) {
    parts.push(`\n## 目标写作风格\n${styleFpContext}`);
  }

  // 问题列表
  parts.push(`\n## 需要修复的问题`);
  // 严重问题先排
  const sorted = [...issues].sort((a, b) => {
    const order = { critical: 0, warning: 1, info: 2 };
    return (order[a.severity as keyof typeof order] ?? 2) - (order[b.severity as keyof typeof order] ?? 2);
  });
  for (const issue of sorted) {
    const sevLabel = issue.severity === 'critical' ? '🔴严重' : issue.severity === 'warning' ? '🟡警告' : '🔵建议';
    parts.push(`### ${sevLabel}${issue.dimensionName ? ` — ${issue.dimensionName}` : ''}`);
    parts.push(`问题：${issue.description}`);
    if (issue.location) parts.push(`位置：${issue.location}`);
    if (issue.suggestion) parts.push(`建议：${issue.suggestion}`);
    parts.push('');
  }

  // 章节正文
  const plainText = htmlToPlainText(chapterContent);
  parts.push(`## 章节原文（请对以下内容应用上述修复）`);
  parts.push(plainText);

  return parts.join('\n');
}
