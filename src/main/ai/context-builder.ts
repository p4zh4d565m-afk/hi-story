import type { ChatMessage } from '../ai/provider';
import type { Project, Chapter, Character, WorldEntry, OutlineNode, StoryFact, CharacterKnowledge, ObsidianDocument } from '../../renderer/types';

export interface ContextSources {
  project?: Project;
  currentChapter?: Chapter;
  characters?: Character[];
  worldEntries?: WorldEntry[];
  outlineNodes?: OutlineNode[];
  recentMessages?: ChatMessage[];
  /** P0: 叙事事实层（从 story_facts 表加载） */
  storyFacts?: StoryFact[];
  characterKnowledge?: CharacterKnowledge[];
  /** Obsidian 人物、世界观和长期大纲（只读主资料） */
  obsidianDocuments?: ObsidianDocument[];
  /** A4a：策划结构上下文（已由渲染端 formatPlanningAuthorityContext 格式化的有界文本） */
  planningContext?: string | null;
  /** 叙事时间 as-of 截面（Main 已按 taskType 折叠） */
  narrativeAsOfText?: string | null;
}

// ============================================================
// Token 预算管理器 — 参考 OpenWrite context_builder.py
// 给每个上下文块分配明确 token 上限，超限时按优先级降级
// ============================================================

const TOKEN_BUDGET = {
  /** 总 system prompt token 上限（留余量给 user message + AI 回复） */
  total: 16000,
  allocation: {
    aiRole: 600,
    project: 400,
    currentChapter: 1500,
    outline: 3000,
    characters: 2500,
    world: 2500,
    obsidian: 3500,
    literatureKnowledge: 500,
    compass: 1000,
    styleFingerprint: 800,
    conversationSummary: 1000,
    behaviorRules: 500,
  },
};

/**
 * CJK 字符约 1.5 token/字，英文约 4 char/token
 * 参考 OpenWrite 的估算策略
 */
function estimateTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (
      (code >= 0x4E00 && code <= 0x9FFF) ||   // CJK 统一汉字
      (code >= 0x3400 && code <= 0x4DBF) ||   // CJK 扩展 A
      (code >= 0x20000 && code <= 0x2A6DF) || // CJK 扩展 B
      (code >= 0xF900 && code <= 0xFAFF) ||   // CJK 兼容汉字
      (code >= 0x3040 && code <= 0x309F) ||   // 平假名
      (code >= 0x30A0 && code <= 0x30FF)      // 片假名
    ) {
      cjk++;
    } else {
      other++;
    }
  }
  return Math.ceil(cjk / 1.5 + other / 4);
}

/**
 * 按 token 预算截断文本
 * @returns [截断后文本, 是否被截断]
 */
function truncateByBudget(
  text: string,
  budget: number,
  options?: { takeEnd?: boolean; preserveSentence?: boolean }
): [string, boolean] {
  if (!text) return [text, false];

  // 快速路径：小文本不截断（~2x token 估算）
  if (text.length < budget * 1.5) return [text, false];

  let truncated: string;
  if (options?.takeEnd) {
    // 取末尾（如章节最近内容）
    truncated = text.slice(-Math.floor(budget * 1.2));
  } else {
    truncated = text.slice(0, Math.floor(budget * 1.2));
  }

  if (options?.preserveSentence && truncated.length > 50) {
    // 尝试在句号/换行处截断
    const lastBreak = Math.max(
      truncated.lastIndexOf('。'),
      truncated.lastIndexOf('！'),
      truncated.lastIndexOf('？'),
      truncated.lastIndexOf('\n'),
    );
    if (lastBreak > truncated.length * 0.6) {
      truncated = truncated.slice(0, lastBreak + 1);
    }
  }

  return [truncated + (options?.takeEnd ? '…' : '…'), true];
}

/**
 * 检查总 token 是否超限，超限时从低优先级块逐步降级
 */
function enforceTotalBudget(parts: { text: string; priority: number }[], maxTokens: number): string[] {
  const totalTokens = parts.reduce((sum, p) => sum + estimateTokens(p.text), 0);
  if (totalTokens <= maxTokens) {
    return parts.map(p => p.text);
  }

  // 从最低优先级（高数字）开始压缩
  const sorted = parts.map((p, i) => ({ ...p, idx: i }));
  sorted.sort((a, b) => b.priority - a.priority); // 高优先级在前

  let budget = maxTokens;
  const results: (string | null)[] = new Array(parts.length).fill(null);

  // 先分配高优先级
  for (const item of sorted) {
    if (budget <= 0) break;
    const tokens = estimateTokens(item.text);
    if (tokens <= budget) {
      results[item.idx] = item.text;
      budget -= tokens;
    } else {
      // 超限：压缩策略
      if (item.priority >= 8) {
        // 高优先级：尽力保留，截断
        const [compressed] = truncateByBudget(item.text, budget, { preserveSentence: true });
        results[item.idx] = compressed;
        budget = 0;
      } else if (item.priority >= 5) {
        // 中优先级：去掉内容只保留标题行
        const firstLine = item.text.split('\n')[0];
        const t = estimateTokens(firstLine);
        if (t <= budget) {
          results[item.idx] = firstLine + '\n（内容已压缩）';
          budget -= t;
        }
      }
      // 低优先级：跳过
    }
  }

  return results.filter((r): r is string => r !== null);
}

// ============================================================
// ContextBuilder
// ============================================================

/**
 * Builds the system context for AI conversations.
 * 带 token 预算管理：每个上下文块有明确上限，超限按优先级降级
 */
export class ContextBuilder {
  /**
   * Build a full context as chat-ready messages.
   */
  static build(sources: ContextSources): ChatMessage[] {
    // 收集所有上下文块（带优先级，数字越大越优先保留）
    const blocks: { text: string; priority: number }[] = [];

    // 1. AI 角色定位 [priority=10 — 最高，绝对不能丢]
    blocks.push({ text: getAIRole(), priority: 10 });

    // 2. 小说项目信息 [priority=9]
    if (sources.project) {
      blocks.push({ text: getProjectContext(sources.project), priority: 9 });
    }

    // 3. 当前章节 [priority=9]
    if (sources.currentChapter) {
      const text = getChapterContext(sources.currentChapter);
      blocks.push({ text, priority: 9 });
    }

    // 4. 关联大纲节点 [priority=8]
    // A4a：有策划结构上下文时，对话以策划为权威，不再注入 outlineNodes（避免双份真相）；
    // 无策划数据则回退现有大纲树。
    if (sources.outlineNodes && sources.outlineNodes.length > 0 && !sources.planningContext) {
      const text = getOutlineContext(sources.outlineNodes);
      blocks.push({ text, priority: 8 });
    }

    // 4b. 策划结构（A4a）[priority=8，占用 outline 预算]
    if (sources.planningContext) {
      blocks.push({ text: sources.planningContext, priority: 8 });
    }

    // 5. 关联角色 [priority=8]
    if (sources.characters && sources.characters.length > 0) {
      const text = getCharactersContext(sources.characters);
      blocks.push({ text, priority: 8 });
    }

    // 6. 关联世界观 [priority=8]
    if (sources.worldEntries && sources.worldEntries.length > 0) {
      const text = getWorldContext(sources.worldEntries);
      blocks.push({ text, priority: 8 });
    }

    // Obsidian 是人物、世界观和长期大纲的主要编辑来源，但只注入有界摘录。
    if (sources.obsidianDocuments && sources.obsidianDocuments.length > 0) {
      const text = this.getObsidianContext(sources.obsidianDocuments);
      if (text) blocks.push({ text, priority: 9 });
    }

    // 7. 创作罗盘 [priority=9 — 作者的直接指令，高优先级]
    if (sources.project) {
      const compass = this.getCompassContext(sources.project.id);
      if (compass) blocks.push({ text: compass, priority: 9 });
    }

    // 8. 风格指纹 [priority=7]
    if (sources.project) {
      const styleFp = this.getStyleFingerprintContext(sources.project.id);
      if (styleFp) blocks.push({ text: styleFp, priority: 7 });
    }

    // 9. 叙事事实层（角色当前状态、已知信息）[priority=8]
    if (sources.narrativeAsOfText) {
      blocks.push({ text: sources.narrativeAsOfText, priority: 8 });
    } else if (sources.storyFacts && sources.storyFacts.length > 0) {
      const text = getStoryFactsContext(sources.storyFacts);
      if (text) blocks.push({ text, priority: 8 });
    }

    // 10. 角色信息边界 [priority=8]
    if (sources.characterKnowledge && sources.characterKnowledge.length > 0) {
      const text = getCharacterKnowledgeContext(sources.characterKnowledge);
      if (text) blocks.push({ text, priority: 8 });
    }

    // 11. 最近对话摘要 [priority=6]
    if (sources.recentMessages && sources.recentMessages.length > 0) {
      const text = getConversationSummary(sources.recentMessages);
      blocks.push({ text, priority: 6 });
    }

    // 12. 文学知识库 [priority=4 — 静态数据，可被压缩]
    blocks.push({ text: getLiteratureKnowledge(), priority: 4 });

    // 13. 行为约束 [priority=10 — 必须保留]
    blocks.push({ text: getBehaviorRules(), priority: 10 });

    // Token 预算检查 & 降级
    const finalParts = enforceTotalBudget(blocks, TOKEN_BUDGET.total);
    const systemContent = finalParts.join('\n\n---\n\n');

    return [{
      role: 'system',
      content: systemContent,
    }];
  }

  /**
   * Estimate token count for a given text (≈1 token per 1.5 CJK chars)
   */
  static estimateTokens(text: string): number {
    return estimateTokens(text);
  }

  static getObsidianContext(documents: ObsidianDocument[]): string | null {
    return getObsidianContext(documents);
  }

  // ── 创作罗盘（来自 OpenWrite 移植，不改动） ──

  public static getCompassContext(projectId: string): string | null {
    try {
      const raw = (globalThis as any).localStorage?.getItem(`hi-story-compass-${projectId}`);
      if (!raw) return null;
      const compass = JSON.parse(raw);
      if (!compass.authorIntent && !compass.currentFocus && !compass.avoid) return null;
      const lines: string[] = ['## 🧭 创作罗盘（作者的最高优先级指导）'];
      if (compass.authorIntent) lines.push(`### 长期作者意图\n${compass.authorIntent}`);
      if (compass.currentFocus) lines.push(`### 近期写作焦点（本次最高优先级）\n${compass.currentFocus}`);
      if (compass.avoid) lines.push(`### 禁止方向（请避免以下内容）\n${compass.avoid}`);
      return lines.join('\n');
    } catch {
      return null;
    }
  }

  // ── 风格指纹（来自 OpenWrite 移植，不改动） ──

  public static getStyleFingerprintContext(projectId: string): string | null {
    try {
      const raw = (globalThis as any).localStorage?.getItem(`hi-story-style-fingerprint-${projectId}`);
      if (!raw) return null;
      const fp = JSON.parse(raw);
      if (!fp.sentenceStyle && !fp.moodTone && !fp.vocabTraits) return null;
      const lines: string[] = ['## 🎨 写作风格指纹（来自作者样章分析）'];
      if (fp.sentenceStyle) lines.push(`- 句式：${fp.sentenceStyle}`);
      if (fp.rhetoricStyle) lines.push(`- 修辞：${fp.rhetoricStyle}`);
      if (fp.dialogueStyle) lines.push(`- 对话：${fp.dialogueStyle}`);
      if (fp.moodTone) lines.push(`- 基调：${fp.moodTone}`);
      if (fp.vocabTraits) lines.push(`- 用词：${fp.vocabTraits}`);
      if (fp.chapterStructure) lines.push(`- 结构：${fp.chapterStructure}`);
      return lines.join('\n');
    } catch {
      return null;
    }
  }
}

// ============================================================
// 各上下文块的构建函数（从类方法提取为模块级函数）
// ============================================================

function getAIRole(): string {
  return `你是一位资深的文学创作助手，正在帮助作者进行小说创作。

你的核心能力：
1. 【作品讨论】你可以讨论用户的小说设定、角色、情节走向，提供建议和分析。
2. 【知识查询】你拥有丰富的文学、历史、神话知识。用户问你成语典故、历史事件、神话传说、名著片段时，请直接回答。例如用户问"'破釜沉舟'出自哪里？"你应该直接告诉他出自《史记·项羽本纪》并讲述完整故事。
3. 【灵感搜索】如果用户想要查找某个典故、某段名言、某个文学描述，而你记忆中确实有相关内容，请直接引用并提供出处。

行为准则：
- 你的任务是提供建设性的建议、补充设定细节、分析角色和情节，但始终保持作者的主导权。
- 你不会替代作者写长篇正文，而是提供框架、思路和润色建议。
- 区分事实和建议：明确指出哪些是基于文学惯例的建议，哪些是必须遵守的规则。
- 对于中国历史、神话、文学相关内容，优先使用准确的考据和原文引用。
- 避免过度"鸡汤式"的鼓励，专注于实质性的创作帮助。
- 使用中文进行对话。`;
}

function getProjectContext(project: Project): string {
  const lines: string[] = ['## 当前小说项目'];
  lines.push(`- 书名: 《${project.name}》`);
  if (project.typeTags.length > 0) {
    lines.push(`- 类型: ${project.typeTags.join(' · ')}`);
  }
  if (project.style) {
    lines.push(`- 风格: ${project.style}`);
  }
  if (project.summary) {
    lines.push(`- 简介: ${project.summary}`);
  }
  return lines.join('\n');
}

function getChapterContext(chapter: Chapter): string {
  const lines: string[] = ['## 当前章节'];
  lines.push(`- 标题: ${chapter.title}`);
  lines.push(`- 状态: ${chapter.status === 'final' ? '定稿' : '草稿'}`);
  lines.push(`- 字数: ${chapter.wordCount.toLocaleString()}`);

  if (chapter.content) {
    // Strip HTML tags
    const plainText = chapter.content
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    // 不再硬截断 500 字 — 用 token 预算动态控制
    const [excerpt, wasTruncated] = truncateByBudget(
      plainText,
      TOKEN_BUDGET.allocation.currentChapter - 200, // 留出标题行的 token
      { takeEnd: true, preserveSentence: true }
    );

    if (wasTruncated || plainText.length > 0) {
      lines.push(`\n最近内容:\n\`\`\`\n${excerpt}\n\`\`\``);
    }
  }
  return lines.join('\n');
}

function getOutlineContext(nodes: OutlineNode[]): string {
  const lines: string[] = ['## 相关大纲'];
  const buildTree = (parentId: string | null, depth: number = 0): string[] => {
    const children = nodes.filter(n => n.parentId === parentId);
    return children.map(n => {
      const indent = '  '.repeat(depth);
      const line = `${indent}- ${n.title}${n.summary ? `: ${n.summary}` : ''}`;
      return [line, ...buildTree(n.id, depth + 1)];
    }).flat();
  };

  const treeLines = buildTree(null);
  // 大纲超限时截断（保留前面部分，即高层级节点）
  const treeText = treeLines.join('\n');
  const [result] = truncateByBudget(
    treeText,
    TOKEN_BUDGET.allocation.outline,
    { preserveSentence: false }
  );
  lines.push(result);
  return lines.join('\n');
}

function getCharactersContext(characters: Character[]): string {
  const lines: string[] = ['## 关联角色'];
  // 不再硬截断 slice(0,5) — 用 token 预算动态计算
  let charBudget = TOKEN_BUDGET.allocation.characters;
  const charsPerItem: { name: string; text: string; tokens: number }[] = [];

  for (const ch of characters) {
    const parts: string[] = [];
    parts.push(`### ${ch.name}`);
    let fieldCount = 0;
    const FIELDS = ['aliases', 'appearance', 'personality', 'background', 'arc'] as const;
    const FIELD_KEYS: Record<string, string> = {
      aliases: '别名', appearance: '外貌', personality: '性格',
      background: '背景', arc: '角色弧线',
    };
    const FIELD_VALUES: Record<string, string> = {
      aliases: ch.aliases, appearance: ch.appearance, personality: ch.personality,
      background: ch.background, arc: ch.arc,
    };

    for (const field of FIELDS) {
      const value = FIELD_VALUES[field];
      if (value) {
        parts.push(`- ${FIELD_KEYS[field]}: ${value}`);
        fieldCount++;
      }
    }

    // 如果没有有效字段（空卷标角色），跳过
    if (fieldCount === 0) continue;

    const text = parts.join('\n');
    const tokens = estimateTokens(text);
    charsPerItem.push({ name: ch.name, text, tokens });
  }

  // 按预算填充角色：先放完整信息，放不下的只保留名称
  for (const item of charsPerItem) {
    if (charBudget >= item.tokens) {
      lines.push(item.text);
      charBudget -= item.tokens;
    } else if (charBudget > 50) {
      // 预算不够完整字段，但可以放精简版
      lines.push(`### ${item.name}（信息已压缩）`);
      charBudget -= 30;
    }
    // 预算耗尽则跳过剩余角色
  }

  return lines.join('\n');
}

function getWorldContext(entries: WorldEntry[]): string {
  const lines: string[] = ['## 关联世界观'];
  let worldBudget = TOKEN_BUDGET.allocation.world;

  for (const entry of entries) {
    if (worldBudget <= 50) break;

    const entryText = buildWorldEntryText(entry);
    const tokens = estimateTokens(entryText);

    if (worldBudget >= tokens) {
      lines.push(entryText);
      worldBudget -= tokens;
    } else if (worldBudget > 50) {
      // 精简版：只放名称+category，描述截断
      const compact = `### ${entry.name} [${entry.category}]\n（信息已压缩）`;
      lines.push(compact);
      worldBudget -= 30;
    }
  }
  return lines.join('\n');
}

function getObsidianContext(documents: ObsidianDocument[]): string | null {
  if (documents.length === 0) return null;

  const kindLabels: Record<ObsidianDocument['kind'], string> = {
    character: '人物',
    world: '世界观',
    outline: '长期大纲',
  };
  const lines = [
    '## Obsidian 只读主资料',
    '以下内容来自作者配置的 Obsidian 目录。人物、世界观或长期大纲冲突时优先参考 Obsidian；正文进度、运行期事实和伏笔仍以 hi-story 为准。',
  ];
  let remaining = TOKEN_BUDGET.allocation.obsidian - estimateTokens(lines.join('\n'));
  const documentsByKind = {
    character: documents.filter(document => document.kind === 'character'),
    world: documents.filter(document => document.kind === 'world'),
    outline: documents.filter(document => document.kind === 'outline'),
  };
  const orderedDocuments: ObsidianDocument[] = [];
  const kindOrder: ObsidianDocument['kind'][] = ['outline', 'character', 'world'];
  const maxKindLength = Math.max(...kindOrder.map(kind => documentsByKind[kind].length));
  for (let index = 0; index < maxKindLength; index++) {
    for (const kind of kindOrder) {
      const document = documentsByKind[kind][index];
      if (document) orderedDocuments.push(document);
    }
  }

  for (const document of orderedDocuments) {
    if (remaining <= 40) break;
    const heading = `### [${kindLabels[document.kind]}] ${document.name}\n来源：${document.relativePath}`;
    const headingTokens = estimateTokens(heading);
    if (headingTokens >= remaining) break;
    const contentBudget = Math.min(650, remaining - headingTokens);
    const [content] = truncateByBudget(document.content, contentBudget, { preserveSentence: true });
    let block = `${heading}\n${content}`;
    while (block.length > 0 && estimateTokens(block) > remaining) {
      block = block.slice(0, -20);
    }
    if (!block) break;
    lines.push(block);
    remaining -= estimateTokens(block);
  }

  const result = lines.join('\n\n');
  return estimateTokens(result) <= TOKEN_BUDGET.allocation.obsidian ? result : null;
}

function buildWorldEntryText(entry: WorldEntry): string {
  const parts = [`### ${entry.name} [${entry.category}]`];
  if (entry.description) {
    const [desc] = truncateByBudget(entry.description, 1500);
    parts.push(desc);
  }
  return parts.join('\n');
}

function getConversationSummary(messages: ChatMessage[]): string {
  const recentMsgs = messages.slice(-10);
  const summary = recentMsgs
    .filter(m => m.role !== 'system')
    .map(m => {
      const prefix = m.role === 'user' ? '作者' : '助手';
      const [text] = truncateByBudget(m.content, 200);
      return `${prefix}: ${text}`;
    })
    .join('\n');
  return `## 最近对话\n${summary}`;
}

function getLiteratureKnowledge(): string {
  return `## 本地文学知识库
你的训练数据中已包含大量文学知识。此外，用户已导入以下本地数据可供参考：

- 📖 成语词典 — 含出处、释义、例句
- ⚔️ 孙子兵法 + 三十六计 — 完整原文
- 🦊 希腊神话 + 北欧神话 — 体系化介绍
- 📚 唐诗宋词精选 — 名家名篇原文
- 🎭 修辞手法大全 — 含例句

如果用户询问关于这些主题的问题，请尽量给出详细的解答，并引用原文或出处。不要仅仅因为'本地数据库可能没有'就回避回答——你是 AI 模型，本身就掌握这些知识。`;
}

function getBehaviorRules(): string {
  return `## 知识能力
你可以直接回答文学、历史、神话、成语典故相关的问题，无需依赖外部数据库。如果用户问的是你熟悉的知识点（如成语出处、历史事件、神话传说、名著内容），请引用原文并提供出处。

## 行为准则
- 使用中文回复。
- 保持对作者的尊重，以建议而非命令的方式提供意见。
- 区分事实和建议：明确指出哪些是基于文学惯例的建议，哪些是必须遵守的规则。
- 如果作者要求你帮助写具体段落，你可以提供示例，但始终提醒作者这是可修改的建议。
- 避免过度"鸡汤式"的鼓励，专注于实质性的创作帮助。
- 对于中国历史、神话、文学相关内容，优先使用准确的考据。`;
}

// ============================================================
// 叙事事实层上下文构建（P0）
// ============================================================

const FACT_TYPE_LABELS: Record<string, string> = {
  location: '📍 位置',
  possession: '🎒 持有',
  relationship: '🤝 关系',
  knowledge: '🧠 认知',
  event: '⚡ 事件',
  emotional_state: '💭 情感',
  hook: '🪝 伏笔',
};

function getStoryFactsContext(facts: StoryFact[]): string {
  if (facts.length === 0) return '';

  const lines: string[] = ['## 📊 当前世界状态（叙事事实层）'];
  lines.push('以下是截至本章为止的**活跃事实**，写章/审稿时请确保与这些事实一致。\n');

  // 按类型分组
  const byType: Record<string, StoryFact[]> = {};
  for (const f of facts) {
    if (!byType[f.factType]) byType[f.factType] = [];
    byType[f.factType].push(f);
  }

  // 每类型最多展示 8 条，优先最新
  for (const [type, items] of Object.entries(byType)) {
    const label = FACT_TYPE_LABELS[type] || type;
    lines.push(`### ${label}`);
    const shown = items.slice(0, 8);
    for (const item of shown) {
      lines.push(`- ${item.description}`);
    }
    if (items.length > 8) {
      lines.push(`  *(还有 ${items.length - 8} 条，已省略)*`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function getCharacterKnowledgeContext(knowledge: CharacterKnowledge[]): string {
  if (knowledge.length === 0) return '';

  // 按角色分组
  const byChar: Record<string, CharacterKnowledge[]> = {};
  for (const k of knowledge) {
    const name = k.characterName || '未知角色';
    if (!byChar[name]) byChar[name] = [];
    byChar[name].push(k);
  }

  const lines: string[] = ['## 🧠 角色信息边界（谁知道什么）'];
  lines.push('用于判断信息越界：如果角色知道某信息，而当前场景中角色不应知道，则为越界。\n');

  for (const [name, items] of Object.entries(byChar)) {
    lines.push(`### ${name}`);
    const shown = items.slice(0, 5);
    for (const item of shown) {
      lines.push(`- 知道「${item.factDescription}」—— 来源：${item.source}`);
    }
    if (items.length > 5) {
      lines.push(`  *(还有 ${items.length - 5} 条，已省略)*`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
