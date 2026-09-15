// ============================================================
// 正文世代纯函数（二期审稿版本账本）
// 主进程与测试共用同一份实现，禁止渲染端/主进程各写一套。
//
// 世代判据：规范化纯文本比较。等价 HTML（标签顺序/空段落不同但汉字相同）
// 不递增；改一个汉字或标点递增；只改标题/摘要/状态不递增。
// ============================================================

/**
 * 规范化正文：去 HTML 标签、连续空白（含换行）收成单个空格、trim。
 * 不解码成另一种文档模型，不做中英文分词。
 * 注意：与 renderer 的 htmlToPlainText（保留换行）不同，此处合并全部空白，
 * 避免 TipTap 换行/段落序列化噪声导致「等价内容」被误判为变化。
 */
export function normalizeChapterText(html: string): string {
  if (!html) return '';
  return html
    .replace(/<[^>]+>/g, ' ')   // 标签一律当空白，避免 <p>a</p><p>b</p> 与 a<br>b 的分段差异
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')        // 连续空白（含换行）收成单空格
    .trim();
}

/**
 * 正文是否真的变了（需要递增 content_generation）。
 * 仅当规范化纯文本不同才为真。
 */
export function shouldBumpContentGeneration(oldHtml: string, newHtml: string): boolean {
  return normalizeChapterText(oldHtml) !== normalizeChapterText(newHtml);
}
