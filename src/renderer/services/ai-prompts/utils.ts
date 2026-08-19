// ============================================================
// 工具函数
// ============================================================

function getCategoryLabel(cat: string): string {
  const map: Record<string, string> = {
    place: '📍 地点',
    faction: '⚔️ 势力',
    race: '🧬 种族',
    law: '⚖️ 规则',
    history: '📜 历史',
    culture: '🎭 文化',
  };
  return map[cat] || `📋 ${cat}`;
}

export { getCategoryLabel };

/**
 * 从 HTML 章节内容提取纯文本（用于审稿）
 */
export function htmlToPlainText(html: string): string {
  if (!html) return '';
  return html
    .replace(/<p[^>]*>/gi, '\n')
    .replace(/<\/p>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 从纯文本提取摘要（取前 N 个字符，不含 HTML）
 */
export function extractSummary(content: string, maxChars: number = 300): string {
  const text = htmlToPlainText(content);
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '...';
}
