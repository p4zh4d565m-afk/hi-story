/**
 * 写章预览分段：把模型输出的 HTML 切成 React 文本节点安全渲染，零 innerHTML。
 *
 * 写章 prompt 强制模型输出 <p>...</p>，保存路径仍存 HTML 原文（TipTap 吃 HTML）。
 * 预览不得 dangerouslySetInnerHTML，也不得只 htmlToPlainText 预览却 HTML 保存。
 */
export type GeneratedPreviewBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'fallback'; text: string };

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function stripTags(html: string): string {
  return decodeEntities(
    html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''),
  );
}

export function splitGeneratedPreviewBlocks(html: string): GeneratedPreviewBlock[] {
  if (!html) return [];
  const blocks: GeneratedPreviewBlock[] = [];
  const re = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const gap = html.slice(cursor, match.index);
    if (gap.trim()) blocks.push({ kind: 'fallback', text: decodeEntities(gap) });
    blocks.push({ kind: 'paragraph', text: stripTags(match[1]) });
    cursor = re.lastIndex;
  }
  const tail = html.slice(cursor);
  const openParagraph = tail.match(/^\s*<p\b[^>]*>([\s\S]*)$/i);
  if (openParagraph) {
    blocks.push({ kind: 'paragraph', text: stripTags(openParagraph[1]) });
  } else if (tail.trim()) {
    blocks.push({ kind: 'fallback', text: decodeEntities(tail) });
  }
  return blocks;
}
