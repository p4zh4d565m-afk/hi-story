// ============================================================
// AI 审稿 Prompt 模板
// ============================================================

/** 二期审稿 prompt 版本（改 prompt 必须改此常量 + 改 Spec/单测） */
export const REVIEW_PROMPT_VERSION = 'review-v2-2026-09-15';

export const REVIEW_DIMENSIONS = [
  { id: 1, name: '角色OOC', desc: '角色行为是否符合性格设定，是否出现前后矛盾或不符合人设的行为' },
  { id: 2, name: '时间线', desc: '事件顺序是否合理，时间标记是否一致，是否存在时间跳跃错误' },
  { id: 3, name: '设定冲突', desc: '是否违反已建立的世界观规则，包括修炼体系、魔法系统、社会制度等' },
  { id: 4, name: '战力崩坏', desc: '角色能力是否忽强忽弱，力量体系是否自洽，升级逻辑是否合理' },
  { id: 5, name: '节奏', desc: '叙事节奏是否有拖沓或过快的问题，高潮与过渡段落比例是否恰当' },
  { id: 6, name: '文风一致', desc: '写作风格是否统一，是否有突变或前后不连贯的问题' },
  { id: 7, name: '视角一致', desc: '叙事视角是否保持一致，有无突然切换视角或打破叙事规则' },
  { id: 8, name: '配角降智', desc: '配角是否被强行降低智力来推动剧情，是否有正常的行为逻辑' },
  { id: 9, name: '台词失真', desc: '对话是否符合角色性格和时代背景，有无现代用语穿越或千人一面' },
  { id: 10, name: '大纲偏离', desc: '是否偏离已确认的大纲方向，核心情节和关键节点是否到位' },
  { id: 11, name: '段落AI痕', desc: '段落长度是否过于均匀（AI 写作特征），是否有机械化的排比或列表式结构' },
  { id: 12, name: '套话密度', desc: '是否频繁使用"似乎、可能、或许、大概、某种程度上"等模糊表达' },
  { id: 13, name: '转折复用', desc: '转折词是否重复使用（"然而、不过、与此同时、另一方面"等高频转折）' },
  { id: 14, name: '流水账', desc: '叙述是否过于平淡，缺少细节和张力，像在记流水账' },
  { id: 15, name: '信息越界', desc: '角色是否知道不该知道的信息，是否存在作者视角泄露' },
];

export const REVIEW_SYSTEM_PROMPT = `你是一位专业的文学编辑，擅长从多个维度审查小说章节质量。

## 审查维度说明
${REVIEW_DIMENSIONS.map(d => `${d.id}. ${d.name}：${d.desc}`).join('\n')}

## 输出格式
严格返回纯 JSON 对象（不要包裹在 markdown 代码块中），字段如下：
{
  "summary": "整体评价，一两句话概括",
  "dimensions": [
    { "id": 1, "name": "角色OOC", "status": "pass", "score": 90, "comment": "判断说明", "evidence": [] },
    ...
  ],
  "issues": [
    { "severity": "critical", "dimensionId": 1, "location": "原文片段", "description": "问题描述", "suggestion": "改进建议" },
    ...
  ]
}

## 三态判断规则（必须遵守）
- 每个维度必须给出 status 三选一：
  - "pass"：该维度表现良好，无问题
  - "issue"：该维度存在需要修改的问题
  - "inconclusive"：上下文不足以做出判断（例如缺少角色设定、无法判断 OOC）
- 15 个维度一个都不能缺、不能重复、不能用未知 id。
- 只有 status 为 "pass" 或 "issue" 时才给 score（0-100）；status 为 "inconclusive" 时 score 必须为 null，并在 comment 说明缺什么信息。
- status 为 "issue" 时，evidence 必须列出原文片段作为举证（至少 1 条）；"pass" 和 "inconclusive" 时 evidence 可为空数组。
- 禁止为了凑数硬给 pass 或高分；判断不了就如实写 "inconclusive"。

## 评分标准（仅用于 pass/issue 的 score）
- 90-100：优秀；75-89：良好；60-74：合格；40-59：不佳；0-39：差

## issues 注意事项
- severity 取值为 "critical"（严重问题）、"warning"（警告）、"info"（建议）
- location 字段填入原文片段，方便定位
- 问题要具体，给出可操作的改进建议

## AI 味质感层检查（用于「段落AI痕」维度，必须引用原文举证）

词表只能抓表面，以下质感问题需要你通读原文后凭审美判断，发现时必须引用原文片段作为 location：

- **情绪贴标签**：直接写「他很紧张/愤怒/悲伤」，而不是用身体反应呈现
- **明喻套句**：「如同……一般」「宛如……似的」「仿佛……一样」反复出现
- **四字成语堆砌**：一段挤进多个成语充当描写
- **对话同质化**：去掉说话人标记后分不清谁在说
- **解释动机**：叙述者写「他这么说是因为……」替读者总结
- **强行升华**：章末拔高到人生感悟或主题金句

以上问题归入「段落AI痕」或「文风一致」维度，问题必须具体、可定位、给出改法，不接受「文笔还需提升」这类空泛结论。`;

export interface ReviewContext {
  projectName: string;
  typeTags: string[];
  characters: Array<{ name: string; aliases: string; personality: string; background: string; arc: string }>;
  worldEntries: Array<{ name: string; description: string }>;
  outlineNodes: Array<{ title: string; summary: string }>;
  /** 叙事事实层 — 当前世界状态 */
  storyFactsSummary?: string;
  /** 角色信息边界 — 谁知道了什么 */
  knowledgeSummary?: string;
  /** 待回收的钩子 — 哪些悬念/伏笔还未解决 */
  hooksSummary?: string;
}

export function buildReviewUserPrompt(
  chapterTitle: string,
  chapterContent: string,
  context: ReviewContext,
): string {
  const parts: string[] = [];

  parts.push(`请审查以下小说章节：\n`);

  // 项目信息
  parts.push(`## 项目信息`);
  parts.push(`书名：${context.projectName}`);
  if (context.typeTags.length > 0) parts.push(`类型：${context.typeTags.join(' / ')}`);

  // 角色设定
  if (context.characters.length > 0) {
    parts.push(`\n## 角色设定（用于判断 OOC 和台词）`);
    for (const ch of context.characters) {
      const info: string[] = [];
      if (ch.personality) info.push(`性格：${ch.personality}`);
      if (ch.background) info.push(`背景：${ch.background.slice(0, 200)}`);
      if (ch.arc) info.push(`弧线：${ch.arc.slice(0, 200)}`);
      if (info.length > 0) parts.push(`- ${ch.name}${ch.aliases ? `（${ch.aliases}）` : ''}：${info.join('；')}`);
      else parts.push(`- ${ch.name}`);
    }
  }

  // 世界观
  if (context.worldEntries.length > 0) {
    parts.push(`\n## 世界观设定（用于判断设定冲突）`);
    for (const w of context.worldEntries) {
      parts.push(`- ${w.name}：${w.description.slice(0, 300)}`);
    }
  }

  // 大纲
  if (context.outlineNodes.length > 0) {
    parts.push(`\n## 相关大纲（用于判断大纲偏离）`);
    for (const n of context.outlineNodes) {
      parts.push(`- ${n.title}${n.summary ? `：${n.summary.slice(0, 200)}` : ''}`);
    }
  }

  // 叙事事实层 — 当前世界状态（用于判断设定冲突、信息越界）
  if (context.storyFactsSummary) {
    parts.push(`\n## 📊 当前世界状态（截至本章前的活跃事实）`);
    parts.push(context.storyFactsSummary);
    parts.push(`\n请对照以上事实检查：本章是否有冲突？角色是否"知道"了不该知道的事？`);
  }

  // 角色信息边界
  if (context.knowledgeSummary) {
    parts.push(`\n## 🧠 角色信息边界（谁知道了什么）`);
    parts.push(context.knowledgeSummary);
  }

  // 待回收钩子
  if (context.hooksSummary) {
    parts.push(`\n## 🪝 待回收的叙事钩子/债务`);
    parts.push(context.hooksSummary);
    parts.push(`\n请检查：本章是否遗漏了应该推进或回收的钩子？`);
  }

  // 要审查的章节正文
  parts.push(`\n## 章节正文（审查对象）`);
  parts.push(`章节标题：${chapterTitle}`);
  // 限制 8000 字避免 token 爆表
  const trimmedContent = chapterContent.length > 8000
    ? chapterContent.slice(0, 8000) + `\n\n（正文过长，已截断至前 ${8000} 字...）`
    : chapterContent;
  parts.push(`\n${trimmedContent}`);

  return parts.join('\n');
}
