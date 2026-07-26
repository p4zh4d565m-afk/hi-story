/**
 * 文本相似度匹配引擎
 * 策略: FTS5 候选召回 → N-gram Jaccard 重排序
 * 完全离线，不依赖外部 API
 */

/**
 * 生成字符级 N-gram 集合
 * 中文文本不需要分词，直接用字符滑动窗口
 */
export function generateNgrams(text: string, n: number = 2): Set<string> {
  // 清洗标点符号，保留中文汉字、英文字母、数字
  const cleaned = text.replace(/[^一-鿿㐀-䶿a-zA-Z0-9]/g, '');
  const ngrams = new Set<string>();
  for (let i = 0; i <= cleaned.length - n; i++) {
    ngrams.add(cleaned.slice(i, i + n));
  }
  return ngrams;
}

/**
 * Jaccard 相似度系数
 * score = |A ∩ B| / |A ∪ B|
 * 范围: 0.0 ~ 1.0
 */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;

  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }

  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * 混合相似度: 2-gram Jaccard (权重 0.6) + 3-gram Jaccard (权重 0.4)
 * 2-gram 对短文本友好，3-gram 对长文本更精确
 */
export function hybridSimilarity(textA: string, textB: string): number {
  const bigramsA = generateNgrams(textA, 2);
  const bigramsB = generateNgrams(textB, 2);
  const trigramsA = generateNgrams(textA, 3);
  const trigramsB = generateNgrams(textB, 3);

  const biScore = jaccardSimilarity(bigramsA, bigramsB);
  const triScore = jaccardSimilarity(trigramsA, trigramsB);

  return biScore * 0.6 + triScore * 0.4;
}

/**
 * 为 FTS5 构建搜索查询
 * 从文本中提取关键词序列（每 2-3 字作为一个搜索词）
 * 限制词数量以避免 FTS5 查询过于复杂
 */
export function buildFtsQuery(text: string, maxTerms: number = 30): string {
  const cleaned = text.replace(/[\s\n\r\t]+/g, '').replace(/[^一-鿿㐀-䶿]/g, '');

  if (cleaned.length === 0) return '';

  const terms: string[] = [];
  const step = Math.max(1, Math.floor(cleaned.length / maxTerms));

  for (let i = 0; i < cleaned.length - 1; i += step) {
    // 提取 2-3 字的片段作为搜索词
    const len = i + 3 <= cleaned.length ? 3 : 2;
    const term = cleaned.slice(i, i + len);
    // FTS5 语法：用引号包裹包含特殊字符的词
    terms.push(`"${term}"`);
    if (terms.length >= maxTerms) break;
  }

  // 用 OR 连接所有搜索词
  return terms.join(' OR ');
}

/**
 * 从文本中提取核心段落（用于匹配）
 * 取文本中最具代表性的一段（约 300 字）
 */
export function extractCoreText(text: string, maxLength: number = 300): string {
  const cleaned = text.replace(/<[^>]*>/g, '').replace(/\s+/g, '');
  if (cleaned.length <= maxLength) return cleaned;

  // 取文本后半部分（通常是最近写的内容）
  const start = Math.max(0, cleaned.length - maxLength);
  return cleaned.slice(start, start + maxLength);
}

/**
 * 相似度匹配结果
 */
export interface SimilarityResult {
  chunkId: string;
  docId: string;
  docTitle: string;
  docAuthor?: string;
  content: string;
  chunkIndex: number;
  score: number;          // 0.0 ~ 1.0
  matchPercentage: number; // 显示用的百分比
  source: 'user_imported' | 'open_library'; // 来源标识
  matchSource: 'keyword' | 'semantic' | 'ai_ranked';      // 匹配方式：关键词字面匹配 / 语义向量匹配 / AI精排
  // AI 精排附加字段
  matchedSentence?: string;  // AI 截取的关键句（30-60字）
  highlights?: string[];     // AI 标出的意境对应词（用于紫色高亮）
  rankReason?: string;       // AI 精排理由
}

/**
 * 跨库搜索结果（分组）
 */
export interface SearchAllResult {
  userResults: SimilarityResult[];   // 用户导入
  openResults: SimilarityResult[];   // 系统开放
  debugLog?: string[];               // AI 精排诊断日志
}
