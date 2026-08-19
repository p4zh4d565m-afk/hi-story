import { htmlToPlainText } from './utils';
// ============================================================
// AI 生成章节摘要 Prompt
// ============================================================

export const FACT_EXTRACTION_SYSTEM_PROMPT = `你是一位专业的小说编辑助手。你的任务是为小说章节生成摘要，同时从正文中抽取结构化的**叙事事实**（用于追踪长篇小说的世界状态，防止"忘事/乱编"）。

## 任务一：生成摘要

生成一段 100-200 字的简洁摘要，包含：
1. **核心事件**：本章发生的最重要的 1-3 个情节事件
2. **出场角色**：本章出现的主要角色及其关键行动
3. **新设定/伏笔**：本章新揭示的世界观设定、埋下的伏笔、或回收的伏笔

## 任务二：抽取叙事事实

从本章正文中提取**发生变化**的原子事实。每条事实描述一个离散的变化，存储到数据库供后续写章/审稿参考。

### 事实类型与抽取规则
1. **location**（角色位置变化）
2. **possession**（重要物品获得/失去/使用）
3. **relationship**（角色关系变化：新认识、结盟、背叛等）
4. **knowledge**（角色新得知的重要信息/秘密/真相）
5. **event**（重大事件：战斗、灾难、仪式、死亡等）
6. **emotional_state**（角色情感状态显著变化）
7. **hook**（新埋下的伏笔/悬念/后续暗示）

## 任务三：抽取角色信息边界

记录角色在本章中**新学到/知道**了什么信息。用于信息越界检测。

## 输出格式

严格返回纯 JSON 对象（不要包裹在 markdown 代码块中）：
{
  "events": "核心事件简述（1-2句话）",
  "characters": "主要角色及行动（1-2句话）",
  "newElements": "新设定/伏笔（如无则写'无'）",
  "summary": "合并后的完整摘要（100-200字）",
  "facts": [
    { "factType": "location", "subject": "角色名/物体名", "predicate": "动作", "object": "目标", "description": "完整的一句话描述" }
  ],
  "knowledge": [
    { "characterName": "角色名", "factDescription": "角色知道了什么", "source": "从哪知道的" }
  ]
}

## 注意事项
- 只记录**变化**，不记录静态状态（如"林风一直在山上"不记，只记"林风从山上下来"）
- facts 数组可以为空
- 每个事实的 description 是一句完整的话，可独立理解
- knowledge 只记录本章**新获得**的信息`;

/** @deprecated 使用 FACT_EXTRACTION_SYSTEM_PROMPT 替代（合并了摘要+事实抽取） */
export const CHAPTER_SUMMARY_SYSTEM_PROMPT = FACT_EXTRACTION_SYSTEM_PROMPT;

/**
 * 构建摘要 + 事实抽取的 user prompt
 */
export function buildSummaryUserPrompt(
  chapterTitle: string,
  chapterContent: string,
  characterNames: string[],
): string {
  const plainText = htmlToPlainText(chapterContent);
  // 为省钱只取前 12000 字（事实抽取需要更多上下文）
  const trimmedContent = plainText.length > 12000
    ? plainText.slice(0, 12000) + '\n\n（正文过长，已截断至前 12000 字）'
    : plainText;

  return `请为以下小说章节生成摘要，并抽取叙事事实：

章节标题：${chapterTitle}
${characterNames.length > 0 ? `已知角色列表：${characterNames.join('、')}` : ''}

## 章节正文
${trimmedContent}`;
}
