/**
 * AI 语义精排模块
 * 在 LIKE 短语匹配候选池基础上，调用 AI API 对候选结果进行意境级别的精排
 *
 * 核心理念：text2vec 小模型只能理解"话题相似"，AI API 能理解"意境相似"
 *
 * 降级策略：
 *   - AI 未配置 → 返回原候选（保持 LIKE 排序）
 *   - AI 调用异常/超时 → 返回原候选
 *   - AI 返回格式异常 → 尝试正则提取，否则降级
 */
import type { SimilarityResult } from './similarity';
import type { ProviderConfig } from './provider';
import { ProviderFactory } from './provider-factory';

/** AI 精排返回的数组元素 */
interface RankedItem {
  index: number;          // 候选列表中的编号
  score: number;          // 0.0 ~ 1.0
  reason: string;         // 意境匹配理由（说明 highlights 对应关系）
  matchedSentence: string; // AI 从原文中截取的关键句（30-60字）
  highlights: string[];   // 原文中与用户输入意境对应的关键词
}

/** AI 精排选项 */
export interface AiSemanticRankOptions {
  /** 最多送入 AI 的候选数 */
  maxCandidates?: number;
  /** 每条候选截断到多少字 */
  snippetLength?: number;
  /** 超时时间（ms） */
  timeoutMs?: number;
}

/** 默认选项 */
const DEFAULT_OPTIONS: Required<AiSemanticRankOptions> = {
  maxCandidates: 40,
  snippetLength: 150,
  timeoutMs: 15000,
};

// ═══════════════════════════════════════════════════════
// AI 同义词扩展 — System Prompt & 核心函数
// ═══════════════════════════════════════════════════════

const EXPAND_SYSTEM_PROMPT = `你是一位精通中国古典文学和现代文学的学者。
你的任务是将用户的查询词，扩展为文学语境中的同义表达。

要求：
- 列出在古诗词、散文中常见的同义词、近义词、相关意象表达
- 优先返回意境相同而非字面相同的词
- 至少返回 3 个，最多返回 10 个

请严格返回 JSON 字符串数组，格式：["词1", "词2", "词3"]
不要返回任何非 JSON 内容，不要用 markdown 代码块包裹。`;

/**
 * AI 同义词扩展：将查询词送到 AI 生成文学语境中的同义表达
 *
 * 用途：扩展 LIKE 搜索的覆盖面——比如搜"相见"找不到"邂逅"命中的句子，
 *       通过 AI 同义词扩展，LIKE 阶段也能命中。
 *
 * @param query - 用户原始查询词
 * @param aiConfig - AI provider 配置
 * @param timeoutMs - 超时（默认 5 秒，这一步应很快）
 * @returns 去重后的同义词数组（总是包含原词），失败时返回 [query]
 */
export async function aiExpandQueryWords(
  query: string,
  aiConfig: ProviderConfig | null,
  timeoutMs: number = 5000,
): Promise<string[]> {
  // ── 无 AI 配置 → 降级 ──
  if (!aiConfig || !aiConfig.apiKey) {
    console.log('[AI同义扩展] 未配置 AI，跳过');
    return query.length <= 3 ? [query] : [];  // 短词至少返回自身
  }

  const cleaned = query.replace(/[^一-鿿㐀-䶿a-zA-Z0-9]/g, '').trim();
  if (!cleaned) return [];

  try {
    const provider = ProviderFactory.create(aiConfig);
    const userPrompt = `查询词：「${query}」\n\n请列出它在文学语境中的同义表达。`;

    console.log(`[AI同义扩展] 开始: query="${query.slice(0, 30)}", provider=${aiConfig.name}`);

    const rawResponse = await Promise.race([
      provider.chat(
        [
          { role: 'system', content: EXPAND_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        {
          model: aiConfig.model,
          maxTokens: 200,    // 极短响应，只要一个 JSON 数组
          temperature: 0.3,  // 稍微高点，鼓励多样性
        },
      ),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('AI 同义扩展超时（5s）')), timeoutMs),
      ),
    ]);

    console.log('[AI同义扩展] AI 响应:', rawResponse.slice(0, 150));

    const words = parseWordArray(rawResponse);
    if (!words || words.length === 0) {
      console.warn('[AI同义扩展] 无法解析 AI 响应，使用原词');
      return [query];
    }

    // 合并原词并去重
    const merged = new Set<string>();
    merged.add(query);
    for (const w of words) {
      const cw = w.replace(/[^一-鿿㐀-䶿a-zA-Z0-9]/g, '').trim();
      if (cw.length >= 1 && cw.length <= 10) merged.add(cw);
    }

    const result = [...merged].slice(0, 12); // 最多 12 个（含原词）
    console.log(`[AI同义扩展] 完成: ${result.length} 个词 →`, result.join(', '));
    return result;

  } catch (err) {
    console.warn('[AI同义扩展] 调用失败，使用原词:', (err as Error).message);
    return [query];
  }
}

/**
 * 解析 AI 返回的字符串数组
 */
function parseWordArray(raw: string): string[] | null {
  let jsonStr = raw.trim();

  // 去除 markdown 代码块包裹
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();

  // 找到 JSON 数组
  const arrayStart = jsonStr.indexOf('[');
  const arrayEnd = jsonStr.lastIndexOf(']');
  if (arrayStart === -1 || arrayEnd === -1) return null;

  jsonStr = jsonStr.slice(arrayStart, arrayEnd + 1);

  try {
    const parsed = JSON.parse(jsonStr);
    if (Array.isArray(parsed)) {
      return parsed.filter((w): w is string => typeof w === 'string' && w.trim().length > 0);
    }
    return null;
  } catch {
    // 修复尾部逗号
    try {
      const fixed = jsonStr.replace(/,\s*]/g, ']');
      const parsed = JSON.parse(fixed);
      if (Array.isArray(parsed)) {
        return parsed.filter((w): w is string => typeof w === 'string' && w.trim().length > 0);
      }
    } catch {}
    return null;
  }
}

const SYSTEM_PROMPT = `你是一位文学鉴赏专家，精通中文古典文学和现代文学。
你的任务是根据用户查询的【意境、情感、主题】，从候选文本中选出最相似的条目，并精确截取最相关的句子。

🔴 核心原则：你要找的是「同一幅画」，而不是「同一道证明题」。

当你判断两个句子是否意境相似时，请严格区分「直接描写」和「间接推理」：

━━━━━━━━━━━━━━━━━━━━━━━━
1. 描写层次必须一致
━━━━━━━━━━━━━━━━━━━━━━━━

- 如果用户查询是直接描绘人物/场景的【外在状态】（如：脸色苍白、满头冷汗、蜷缩着发抖），
  请只匹配同样在【直接描绘外在状态】的句子。
- 绝对不要用"需要仙丹"、"必须去求医"、"环境很恶劣"等【需要读者反向推理出主角痛苦】的句子来匹配。
- 用户提供的是画面，你要匹配的是画面，不是逻辑推理题。

━━━━━━━━━━━━━━━━━━━━━━━━
2. 拒绝「因果倒推」
━━━━━━━━━━━━━━━━━━━━━━━━

- 用户问的是"他痛苦的样子"，候选句是"他吃了止痛药"——虽然都可以推导出"他痛苦"，
  但后者完全没有描写痛苦的样子。这种情况下，相似度应为 0。
- 用户问的是"她冷得发抖"，候选句是"他给她披上外套"——虽然推导出"冷"，
  但描写的是另一个人的动作，而非她本人的状态。相似度应为 0。
- 因果链上的两个端点，不是同一个画面。不要用逻辑推理替代画面匹配。

━━━━━━━━━━━━━━━━━━━━━━━━
3. 评分指导（按描写直接性分层）
━━━━━━━━━━━━━━━━━━━━━━━━

同样是虚弱/痛苦：
  • 候选句直接写"脸色惨白、呼吸急促、蜷缩着" → 高分 (0.8-1.0)
  • 候选句写"他不得不躺下休息" → 中等 (0.4-0.6)，有动作但非直接描写痛苦
  • 候选句写"他需要寻找一颗丹药" → 低分 (0.1-0.3) 或 0，完全不同的文学手法

同样是孤独/失落：
  • 候选句直接写"独坐窗前、泪流满面、望着远方发呆" → 高分
  • 候选句写"朋友们都走了" → 中等，推导得出但非直接描写
  • 候选句写"他决定换个城市生活" → 低分或 0

同样是愤怒：
  • 候选句直接写"面红耳赤、青筋暴起、摔门而去" → 高分
  • 候选句写"他默默地握紧了拳头" → 中等
  • 候选句写"别人都觉得他今天不对劲" → 低分或 0（侧面烘托，非直接描写）

━━━━━━━━━━━━━━━━━━━━━━━━
4. 原有维度仍然适用
━━━━━━━━━━━━━━━━━━━━━━━━

在满足「描写层次一致」的前提下，继续用以下维度精确评分：

- 核心场景是否一致？
  例如："在人群中/被注视" vs "独自一人/私下" → 完全不同，不要匹配
  "主动面对/硬撑" vs "被动卷入/抱怨" → 完全不同，不要匹配
  "社交场合的紧张" vs "内心孤独的忧郁" → 完全不同，不要匹配

- 情感走向是否一致？
  例如："紧张但硬撑" vs "紧张但逃避" → 走向不同，降低匹配度
  "尴尬无奈" vs "孤独悲伤" → 情绪不同，降低匹配度

- 动作/行为的性质是否一致？
  例如："走出人群" vs "独自喝酒" → 动作性质不同，降低匹配度

━━━━━━━━━━━━━━━━━━━━━━━━
5. 空结果规则
━━━━━━━━━━━━━━━━━━━━━━━━

如果候选池中只有「反向证明」「因果倒推」「侧面烘托」类的句子，
没有一条是真正的「直接描写」，请返回空数组 []。
宁可返回空，也不要强行匹配不同描写层次的句子。

━━━━━━━━━━━━━━━━━━━━━━━━
输出格式
━━━━━━━━━━━━━━━━━━━━━━━━

对每条选中结果，你需要：
- 从候选文本的 content 中精确截取与查询意境最相关的 1-2 个完整句子作为 matchedSentence（必须到句号/感叹号/问号结束，不能断在半句）
- 从 matchedSentence 中挑出 2-3 个 highlights 词（与用户查询意境对应的关键词）
- 写一句 reason，说明意境相似之处

请严格返回 JSON 数组，格式：
[
  {
    "index": 编号,
    "score": 0.0~1.0的相似度分数,
    "matchedSentence": "从原文截取的完整句子",
    "highlights": ["意境对应词1", "意境对应词2"],
    "reason": "意境相似理由"
  }
]
按 score 从高到低排列，最多返回 5 条。不要返回任何非 JSON 内容，不要用 markdown 代码块包裹。`;

// ═══════════════════════════════════════════════════════
// 核心函数
// ═══════════════════════════════════════════════════════

/**
 * 对 LIKE 搜索候选池进行 AI 语义精排
 *
 * @param query - 用户原始搜索词（保留标点符号，AI 能理解语境）
 * @param candidates - LIKE 搜索得到的候选结果（已排序，去重）
 * @param aiConfig - AI provider 配置（从 ai_configs 表读取）
 * @param options - 可选参数
 * @returns 精排后的 SimilarityResult[]，失败时返回原 candidates
 */
export async function aiSemanticRank(
  query: string,
  candidates: SimilarityResult[],
  aiConfig: ProviderConfig | null,
  options: AiSemanticRankOptions = {},
): Promise<SimilarityResult[]> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // ── 无 AI 配置 → 降级 ──
  if (!aiConfig || !aiConfig.apiKey) {
    console.log('[AI精排] 未配置 AI，使用 LIKE 排序结果');
    return candidates;
  }

  // ── 候选太少 → 不需要精排 ──
  if (candidates.length <= 5) {
    console.log('[AI精排] 候选数 ≤5，跳过高系统开销的精排');
    return candidates;
  }

  // ── 截断候选池 ──
  const pool = candidates.slice(0, opts.maxCandidates);

  try {
    // 1. 构建 user prompt
    const userPrompt = buildUserPrompt(query, pool, opts.snippetLength);

    // 2. 创建 provider 并调用
    const provider = ProviderFactory.create(aiConfig);

    const t0 = Date.now();
    console.log(`[AI精排] 开始: query="${query.slice(0, 50)}", 候选=${pool.length}, provider=${aiConfig.name}, model=${aiConfig.model}`);

    const rawResponse = await Promise.race([
      provider.chat(
        [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        {
          model: aiConfig.model,
          maxTokens: 1500,    // 需要输出 matchedSentence + highlights + reason
          temperature: 0.1,
        },
      ),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('AI 精排超时（' + opts.timeoutMs/1000 + 's）')), opts.timeoutMs),
      ),
    ]);

    const elapsed = Date.now() - t0;
    console.log('[AI精排] ' + aiConfig.name + ' 响应: ' + elapsed + 'ms, ' + rawResponse.length + ' 字符, 前300字=' + rawResponse.slice(0, 300));

    // 3. 解析 JSON
    const ranked = parseAIResponse(rawResponse, pool.length);

    if (!ranked || ranked.length === 0) {
      const errDetail = 'AI 返回了 ' + rawResponse.length + ' 字符但不是有效 JSON 数组。原始响应前300字: ' + rawResponse.slice(0, 300);
      console.warn('[AI精排] ✗ ' + aiConfig.name + ' ' + errDetail);
      // 抛出异常让 fallbackSearch 能看到原始响应内容
      throw new Error('[AI精排] ' + aiConfig.name + ' JSON解析失败: ' + errDetail);
    }

    // 4. 将分数合并回 SimilarityResult
    const merged = mergeRankResults(pool, ranked, candidates.slice(opts.maxCandidates));

    console.log('[AI精排] ✓ ' + aiConfig.name + ' 完成: 精排=' + ranked.length + '条, 最终=' + merged.length + '条, 耗时=' + elapsed + 'ms');
    return merged;

  } catch (err) {
    const errMsg = (err as Error).message || String(err);
    console.warn('[AI精排] ✗ ' + aiConfig.name + ' 调用异常: ' + errMsg);
    // 返回原候选（降级到 LIKE 排序），不抛异常
    return candidates;
  }
}

// ═══════════════════════════════════════════════════════
// 辅助函数
// ═══════════════════════════════════════════════════════

/**
 * 构建用户提示词
 */
function buildUserPrompt(
  query: string,
  candidates: SimilarityResult[],
  snippetLength: number,
): string {
  const lines: string[] = [];

  lines.push(`用户查询：「${query}」`);
  lines.push('');
  lines.push('候选文本：');

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    // 清洗内容中的换行，让每条候选占一行
    const snippet = c.content
      .replace(/\s+/g, ' ')
      .slice(0, snippetLength)
      .trim();
    const title = c.docTitle.slice(0, 30);
    lines.push(`[${i}] ${title} — ${snippet}`);
  }

  lines.push('');
  lines.push(`请从以上 ${candidates.length} 条候选中，选出与「${query}」意境最相似的 5 条。每条需要截取 matchedSentence、标出 highlights、写出 reason。`);
  lines.push('返回 JSON 数组，格式：[{"index": 编号, "score": 0.0~1.0, "matchedSentence": "原文关键句", "highlights": ["词1","词2"], "reason": "理由"}]');

  return lines.join('\n');
}

/**
 * 解析 AI 返回的 JSON 数组
 * 处理可能出现的 markdown 代码块包裹、尾部逗号等异常格式
 */
function parseAIResponse(raw: string, maxIndex: number): RankedItem[] | null {
  let jsonStr = raw.trim();

  // 去除 markdown 代码块包裹
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  // 尝试找到 JSON 数组的起始和结束位置
  const arrayStart = jsonStr.indexOf('[');
  let arrayEnd = jsonStr.lastIndexOf(']');

  // 如果找不到结尾 ]，说明 JSON 被截断了，尝试用逗号处裁剪
  if (arrayEnd === -1 || arrayEnd <= arrayStart) {
    const lastComma = jsonStr.lastIndexOf(',"');
    if (lastComma > arrayStart) {
      // 尝试在最后一个完整对象之后结束
      const lastCompleteObjectEnd = jsonStr.lastIndexOf('}', lastComma);
      if (lastCompleteObjectEnd > arrayStart) {
        jsonStr = jsonStr.slice(arrayStart, lastCompleteObjectEnd + 1) + ']';
        arrayEnd = jsonStr.lastIndexOf(']');
      }
    }
  }

  if (arrayStart === -1) {
    return null;
  }

  // 确保从 [ 到 ] 的切片
  if (arrayEnd === -1 || arrayEnd <= arrayStart) {
    return null;
  }

  jsonStr = jsonStr.slice(arrayStart, arrayEnd + 1);

  // 尝试解析
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    // JSON 解析失败，尝试修复常见问题（尾部逗号、截断等）
    try {
      let fixed = jsonStr
        .replace(/,\s*]/g, ']')   // 移除尾部逗号
        .replace(/,\s*}/g, '}');  // 移除对象尾部逗号
      parsed = JSON.parse(fixed);
    } catch {
      // 最后一次尝试：找到最后一个完整对象，重新组装数组
      const match = jsonStr.match(/^\[([\s\S]*?(?:\{[^}]*\}))([\s\S]*)$/);
      if (match) {
        try {
          // 只保留完整对象，丢弃截断部分
          const completePart = match[1];
          const cleanEnd = completePart.replace(/,\s*$/, '');
          parsed = JSON.parse('[' + cleanEnd + ']');
        } catch {
          return null;
        }
      } else {
        return null;
      }
    }
  }

  if (!Array.isArray(parsed)) return null;

  const valid: RankedItem[] = [];
  const skipped: { index: unknown; reason: string }[] = [];
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) {
      skipped.push({ index: item, reason: '非对象类型: ' + typeof item });
      continue;
    }
    if (typeof (item as any).index !== 'number' || typeof (item as any).score !== 'number') {
      skipped.push({ index: (item as any).index, reason: '缺少 index/score 字段, keys=' + Object.keys(item as any).join(',') });
      continue;
    }
    if ((item as any).index < 0 || (item as any).index >= maxIndex) {
      skipped.push({ index: (item as any).index, reason: 'index ' + (item as any).index + ' 超出范围 0-' + (maxIndex-1) });
      continue;
    }

    // 解析 highlights：如果是数组就用，否则降级为空数组
    let highlights: string[] = [];
    if (Array.isArray((item as any).highlights)) {
      highlights = ((item as any).highlights as any[])
        .filter((h: any) => typeof h === 'string' && h.trim().length > 0)
        .map((h: string) => h.trim());
    }

    // 解析 matchedSentence：优先用 AI 返回的，否则降级
    const matchedSentence = typeof (item as any).matchedSentence === 'string'
      ? (item as any).matchedSentence.trim()
      : '';

    // 解析 reason
    const reason = typeof (item as any).reason === 'string'
      ? (item as any).reason.trim()
      : '';

    valid.push({
      index: (item as any).index,
      score: Math.max(0, Math.min(1, (item as any).score)), // clamp 0~1
      matchedSentence,
      highlights,
      reason,
    });
  }

  if (skipped.length > 0) {
    console.warn('[AI精排] JSON 解析：跳过 ' + skipped.length + ' 个无效条目, 原因: ' + JSON.stringify(skipped.slice(0, 3)));
  }

  // 按分数降序排列
  valid.sort((a, b) => b.score - a.score);

  return valid.length > 0 ? valid : null;
}

/**
 * 将 AI 精排结果合并回 SimilarityResult 列表
 *
 * 策略：
 *   - AI 选中的条目：使用 AI 分数，标记 matchSource='ai_ranked'
 *   - AI 未选中的条目：排在后面，保留原 LIKE 评分
 *   - 超出 AI 精排范围的条目：保留原排序，追加在最后
 */
function mergeRankResults(
  pool: SimilarityResult[],
  rankedItems: RankedItem[],
  overflow: SimilarityResult[],
): SimilarityResult[] {
  const rankedSet = new Set(rankedItems.map(r => r.index));
  const scoreMap = new Map(rankedItems.map(r => [r.index, r.score]));

  const result: SimilarityResult[] = [];

  // AI 选中的条目（按 AI 排序）
  for (const item of rankedItems) {
    const original = pool[item.index];
    if (!original) continue;
    result.push({
      ...original,
      score: item.score,
      matchPercentage: Math.round(item.score * 100),
      matchSource: 'ai_ranked',
      // 如果有 AI 截取的 matchedSentence，用它替换 content（前端展示用）
      content: item.matchedSentence || original.content,
      matchedSentence: item.matchedSentence || undefined,
      highlights: item.highlights.length > 0 ? item.highlights : undefined,
      rankReason: item.reason || undefined,
    });
  }

  // AI 未选中的条目（池内）
  for (let i = 0; i < pool.length; i++) {
    if (!rankedSet.has(i)) {
      result.push(pool[i]);
    }
  }

  // 超出 AI 精排范围的条目（未参与精排，保留原排序）
  for (const item of overflow) {
    result.push(item);
  }

  return result;
}
