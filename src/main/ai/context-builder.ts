import type { ChatMessage } from '../ai/provider';
import type { Project, Chapter, Character, WorldEntry, OutlineNode } from '../../renderer/types';

export interface ContextSources {
  project?: Project;
  currentChapter?: Chapter;
  characters?: Character[];
  worldEntries?: WorldEntry[];
  outlineNodes?: OutlineNode[];
  recentMessages?: ChatMessage[];
}

/**
 * Builds the system context for AI conversations.
 * Automatically injects project info, current chapter,
 * linked characters/world entries, outline nodes,
 * and recent conversation summary.
 */
export class ContextBuilder {
  /**
   * Build a full context as chat-ready messages.
   * Returns system messages to prepend to the conversation.
   */
  static build(sources: ContextSources): ChatMessage[] {
    const parts: string[] = [];

    // 1. AI 角色定位
    parts.push(this.getAIRole());

    // 2. 小说项目信息
    if (sources.project) {
      parts.push(this.getProjectContext(sources.project));
    }

    // 3. 当前正在写的章节
    if (sources.currentChapter) {
      parts.push(this.getChapterContext(sources.currentChapter));
    }

    // 4. 关联大纲节点
    if (sources.outlineNodes && sources.outlineNodes.length > 0) {
      parts.push(this.getOutlineContext(sources.outlineNodes));
    }

    // 5. 关联角色
    if (sources.characters && sources.characters.length > 0) {
      parts.push(this.getCharactersContext(sources.characters));
    }

    // 6. 关联世界观
    if (sources.worldEntries && sources.worldEntries.length > 0) {
      parts.push(this.getWorldContext(sources.worldEntries));
    }

    // 7. 文学知识库（本地已导入的数据）
    parts.push(this.getLiteratureKnowledge());

    // 8. 创作罗盘（author_intent + current_focus）
    if (sources.project) {
      const compass = this.getCompassContext(sources.project.id);
      if (compass) parts.push(compass);
    }

    // 9. 风格指纹
    if (sources.project) {
      const styleFp = this.getStyleFingerprintContext(sources.project.id);
      if (styleFp) parts.push(styleFp);
    }

    // 10. 最近对话摘要（压缩长对话）
    if (sources.recentMessages && sources.recentMessages.length > 0) {
      parts.push(this.getConversationSummary(sources.recentMessages));
    }

    // 11. 行为约束
    parts.push(this.getBehaviorRules());

    const systemContent = parts.filter(Boolean).join('\n\n---\n\n');

    return [{
      role: 'system',
      content: systemContent,
    }];
  }

  /**
   * Estimate token count for messaging (approx 1 token ≈ 3 chars for CJK, 4 chars for EN)
   */
  static estimateTokens(text: string): number {
    const cjkChars = (text.match(/[一-鿿一-鿿㐀-䶿]/g) || []).length;
    const otherChars = text.length - cjkChars;
    return Math.ceil(cjkChars / 1.5 + otherChars / 4);
  }

  private static getAIRole(): string {
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

  private static getProjectContext(project: Project): string {
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

  private static getChapterContext(chapter: Chapter): string {
    const lines: string[] = ['## 当前章节'];
    lines.push(`- 标题: ${chapter.title}`);
    lines.push(`- 状态: ${chapter.status === 'final' ? '定稿' : '草稿'}`);
    lines.push(`- 字数: ${chapter.wordCount.toLocaleString()}`);

    if (chapter.content) {
      // Strip HTML tags and truncate to ~500 chars for context
      const plainText = chapter.content
        .replace(/<[^>]*>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      const excerpt = plainText.length > 500
        ? plainText.slice(-500) + '...'  // Take the end (most recent writing)
        : plainText;

      lines.push(`\n最近内容:\n\`\`\`\n${excerpt}\n\`\`\``);
    }
    return lines.join('\n');
  }

  private static getOutlineContext(nodes: OutlineNode[]): string {
    const lines: string[] = ['## 相关大纲'];
    const buildTree = (parentId: string | null, depth: number = 0): string[] => {
      const children = nodes.filter(n => n.parentId === parentId);
      return children.map(n => {
        const indent = '  '.repeat(depth);
        const line = `${indent}- ${n.title}${n.summary ? `: ${n.summary}` : ''}`;
        return [line, ...buildTree(n.id, depth + 1)];
      }).flat();
    };
    lines.push(...buildTree(null));
    return lines.join('\n');
  }

  private static getCharactersContext(characters: Character[]): string {
    const lines: string[] = ['## 关联角色'];
    for (const ch of characters.slice(0, 5)) {  // Max 5 characters for context
      lines.push(`### ${ch.name}`);
      if (ch.aliases) lines.push(`- 别名: ${ch.aliases}`);
      if (ch.appearance) lines.push(`- 外貌: ${ch.appearance}`);
      if (ch.personality) lines.push(`- 性格: ${ch.personality}`);
      if (ch.background) lines.push(`- 背景: ${ch.background}`);
      if (ch.arc) lines.push(`- 角色弧线: ${ch.arc}`);
      lines.push('');
    }
    return lines.join('\n');
  }

  private static getWorldContext(entries: WorldEntry[]): string {
    const lines: string[] = ['## 关联世界观'];
    for (const entry of entries.slice(0, 5)) {
      lines.push(`### ${entry.name} [${entry.category}]`);
      if (entry.description) {
        const desc = entry.description.length > 200
          ? entry.description.slice(0, 200) + '...'
          : entry.description;
        lines.push(desc);
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  private static getConversationSummary(messages: ChatMessage[]): string {
    const recentMsgs = messages.slice(-10);  // Last 10 messages
    const summary = recentMsgs
      .filter(m => m.role !== 'system')
      .map(m => {
        const prefix = m.role === 'user' ? '作者' : '助手';
        const text = m.content.length > 100
          ? m.content.slice(0, 100) + '...'
          : m.content;
        return `${prefix}: ${text}`;
      })
      .join('\n');
    return `## 最近对话\n${summary}`;
  }

  private static getLiteratureKnowledge(): string {
    return `## 本地文学知识库
你的训练数据中已包含大量文学知识。此外，用户已导入以下本地数据可供参考：

- 📖 成语词典 (103条) — 含出处、释义、例句
- ⚔️ 孙子兵法 + 三十六计 (42篇) — 完整原文
- 🦊 希腊神话 + 北欧神话 (12篇) — 体系化介绍
- 📚 唐诗宋词精选 (20首) — 名家名篇原文
- 🎭 修辞手法大全 (11条) — 含例句

如果用户询问关于这些主题的问题，请尽量给出详细的解答，并引用原文或出处。不要仅仅因为'本地数据库可能没有'就回避回答——你是 AI 模型，本身就掌握这些知识。`;
  }

  private static getBehaviorRules(): string {
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

  private static getCompassContext(projectId: string): string | null {
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

  private static getStyleFingerprintContext(projectId: string): string | null {
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
