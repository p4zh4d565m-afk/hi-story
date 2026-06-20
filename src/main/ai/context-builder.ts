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

    // 7. 最近对话摘要（压缩长对话）
    if (sources.recentMessages && sources.recentMessages.length > 0) {
      parts.push(this.getConversationSummary(sources.recentMessages));
    }

    // 8. 行为约束
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
你的任务是提供建设性的建议、补充设定细节、分析角色和情节，但始终保持作者的主导权。
你不会替代作者写长篇正文，而是提供框架、思路和润色建议。
使用中文进行对话。`;
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

  private static getBehaviorRules(): string {
    return `## 行为准则
- 使用中文回复。
- 保持对作者的尊重，以建议而非命令的方式提供意见。
- 区分事实和建议：明确指出哪些是基于文学惯例的建议，哪些是必须遵守的规则。
- 如果作者要求你帮助写具体段落，你可以提供示例，但始终提醒作者这是可修改的建议。
- 避免过度"鸡汤式"的鼓励，专注于实质性的创作帮助。
- 对于中国历史、神话、文学相关内容，优先使用准确的考据。`;
  }
}
