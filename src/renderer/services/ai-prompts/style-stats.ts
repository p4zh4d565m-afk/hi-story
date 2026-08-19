// ============================================================
// 全书级句式 tic 统计（纯正则，零 LLM 消耗）
// 参考 voocel/ainovel-cli 的 stylestat 设计
// 解决单章反 AI 检测的盲区：单章看每处都"正常"的句式，全书章均几十次就是病
// ============================================================

export interface PatternStat {
  /** 句式模式名 */
  name: string;
  /** 全书总次数 */
  total: number;
  /** 章均次数 */
  perChapter: number;
}

export interface PhraseStat {
  /** 高频短语 */
  text: string;
  /** 出现次数 */
  count: number;
}

export interface SentenceStat {
  /** 跨章重复句 */
  text: string;
  /** 出现的章数 */
  chapters: number;
  /** 总次数 */
  count: number;
}

export interface StyleStatsResult {
  /** 统计的章数 */
  chapters: number;
  /** 固定句式模式计数 */
  patterns: PatternStat[];
  /** 最近 N 章高频短语（口头禅镜像） */
  topPhrases: PhraseStat[];
  /** 跨章逐字重复句 */
  repeatedSentences: SentenceStat[];
  /** 章末短句收尾占比 */
  endingShortRatio: number;
  /** 开篇时间词率 */
  openingTimeRate: number;
  /** 标题「第N章」前缀混用情况 */
  titleFormatMixed: { withPrefix: number; withoutPrefix: number } | null;
}

/** 通用 AI 文风句式模式（正则近似，用于全书纵向基线对比） */
const PATTERN_DEFS: Array<{ name: string; re: RegExp }> = [
  { name: '矫正句「不是…(而)是…」', re: /不是[^。！？\n]{1,24}?[，、]?(?:而)?是/g },
  { name: '计时量词「X息/X瞬」', re: /[一两二三四五六七八九十几数半][息瞬]/g },
  { name: '明喻「像一/仿佛/如同/宛如」', re: /像一|仿佛|如同|宛如/g },
  { name: '沉默节拍「沉默了/没有说话/没有回头」', re: /沉默了|没有说话|没有回头/g },
  { name: '神态模板「眼中闪过/嘴角勾起/咬了咬唇」', re: /眼[中底]闪过|目光一凝|瞳孔一缩|眼眶微红|嘴角[微轻一]?[勾扬翘]|咬了咬唇|不可置信/g },
  { name: '躯体反应「心头一紧/身子一颤/倒吸凉气」', re: /心头一[紧沉颤]|身子一[颤震僵]|倒吸(?:了)?一口凉气/g },
  { name: '思维标记「心想/意识到/感到/觉得」', re: /心想|意识到|感到|觉得/g },
  { name: '抽象套话「一种说不出的/的意义在于」', re: /一种说不出的|说不清[的道]|的意义在于|真正的[^。！？\n]{1,10}是/g },
];

const MIN_CHAPTERS = 5;      // 少于此章数不统计，样本太小频率无意义
const PHRASE_WINDOW = 20;    // 高频短语只看最近 20 章
const SHORT_ENDING_RUNES = 30; // 章末行 ≤ 30 字计为「短结尾」

/** 首尾虚词/代词，n-gram 以这些字开头/结尾的不是文风短语 */
const GRAM_EDGE_STOP = '的了着是在和与就也都还又把被他她它我你这那';

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function isHan(r: string): boolean {
  return r >= '一' && r <= '鿿';
}

/** 剥离引号：同一句台词带/不带引号不应算两条 */
function trimWrappedQuotes(s: string): string {
  return s.replace(/^[""''「」『』]+/, '').replace(/[""''「」『』]+$/, '').trim();
}

function chapterSentenceCounts(text: string): Map<string, number> {
  const map = new Map<string, number>();
  const sentences = text.split(/[。！？\n]+/);
  for (const raw of sentences) {
    const sent = trimWrappedQuotes(raw.trim());
    if (sent.length < 12) continue;
    map.set(sent, (map.get(sent) || 0) + 1);
  }
  return map;
}

function validGram(gram: string): boolean {
  for (const r of gram) {
    if (!isHan(r)) return false;
  }
  if (GRAM_EDGE_STOP.includes(gram[0]) || GRAM_EDGE_STOP.includes(gram[gram.length - 1])) return false;
  return true;
}

/** 专有名词（人名）拆成 2 字片段，用于过滤掉人名混进口头禅清单 */
function stopwordBigrams(stopwords: string[]): string[] {
  const grams: string[] = [];
  for (const w of stopwords) {
    const runes = [...w.trim()];
    if (runes.length < 2) continue;
    for (let i = 0; i + 2 <= runes.length; i++) {
      grams.push(runes.slice(i, i + 2).join(''));
    }
  }
  return grams;
}

/** 在窗口内挖掘 3-6 字高频短语 */
function minePhrases(chapters: string[], stopwords: string[]): PhraseStat[] {
  const text = chapters.join('\n');
  const runes = [...text];
  const threshold = Math.max(8, Math.floor(chapters.length / 2));
  const stopGrams = stopwordBigrams(stopwords);

  const counts = new Map<string, number>();
  for (let size = 3; size <= 6; size++) {
    for (let i = 0; i + size <= runes.length; i++) {
      const gram = runes.slice(i, i + size).join('');
      if (!validGram(gram)) continue;
      counts.set(gram, (counts.get(gram) || 0) + 1);
    }
  }

  const hitStopword = (gram: string) => stopGrams.some(g => gram.includes(g));

  const cands: Array<{ text: string; count: number }> = [];
  for (const [g, c] of counts) {
    if (c < threshold || hitStopword(g)) continue;
    cands.push({ text: g, count: c });
  }
  cands.sort((a, b) => (b.count - a.count) || (b.text.length - a.text.length) || a.text.localeCompare(b.text));

  const out: PhraseStat[] = [];
  for (const c of cands) {
    if (out.length >= 8) break;
    const dup = out.some(p => p.text.includes(c.text) || c.text.includes(p.text));
    if (!dup) out.push({ text: c.text, count: c.count });
  }
  return out;
}

/** 跨 ≥3 章逐字重复的 ≥12 字句子 */
function repeatedSentences(chapters: string[]): SentenceStat[] {
  const seen = new Map<string, { count: number; chapters: Set<number> }>();
  chapters.forEach((text, ci) => {
    for (const [sent, count] of chapterSentenceCounts(text)) {
      let rec = seen.get(sent);
      if (!rec) { rec = { count: 0, chapters: new Set() }; seen.set(sent, rec); }
      rec.count += count;
      rec.chapters.add(ci);
    }
  });

  const out: SentenceStat[] = [];
  for (const [sent, rec] of seen) {
    if (rec.chapters.size < 3) continue;
    const text = sent.length > 40 ? sent.slice(0, 40) + '…' : sent;
    out.push({ text, chapters: rec.chapters.size, count: rec.count });
  }
  out.sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));
  return out.slice(0, 5);
}

function lastNonEmptyLine(text: string): string {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line) return line;
  }
  return '';
}

function firstParagraph(text: string): string {
  for (const line of text.split('\n')) {
    const l = line.trim();
    if (!l || l.startsWith('#')) continue;
    return l;
  }
  return '';
}

/**
 * 计算全书级句式 tic 统计。所有结果都是事实计数，不含裁定。
 * 章数 < 5 时返回 null（样本太小无意义）。
 */
export function runStyleStats(
  chapters: string[],
  opts?: { stopwords?: string[]; titles?: string[] },
): StyleStatsResult | null {
  const n = chapters.length;
  if (n < MIN_CHAPTERS) return null;

  const all = chapters.join('\n');

  // 1. 固定句式模式
  const patterns: PatternStat[] = [];
  for (const def of PATTERN_DEFS) {
    const total = (all.match(def.re) || []).length;
    if (total === 0) continue;
    patterns.push({ name: def.name, total, perChapter: round1(total / n) });
  }
  patterns.sort((a, b) => b.perChapter - a.perChapter);

  // 2. 高频短语
  const window = n <= PHRASE_WINDOW ? chapters : chapters.slice(n - PHRASE_WINDOW);
  const topPhrases = minePhrases(window, opts?.stopwords ?? []);

  // 3. 跨章重复句
  const repeatedSentencesList = repeatedSentences(chapters);

  // 4. 章末短句收尾占比
  let shortCount = 0;
  let measured = 0;
  for (const text of chapters) {
    const line = lastNonEmptyLine(text);
    if (!line) continue;
    measured++;
    if ([...line].length <= SHORT_ENDING_RUNES) shortCount++;
  }
  const endingShortRatio = measured > 0 ? round2(shortCount / measured) : 0;

  // 5. 开篇时间词率
  const openingTimeRe = /夜|清晨|黎明|天亮|醒来|晨光|一整夜/;
  let openingHit = 0;
  for (const text of chapters) {
    if (openingTimeRe.test(firstParagraph(text))) openingHit++;
  }
  const openingTimeRate = round2(openingHit / n);

  // 6. 标题「第N章」前缀混用
  const titles = opts?.titles ?? [];
  let titleFormatMixed: { withPrefix: number; withoutPrefix: number } | null = null;
  if (titles.length > 0) {
    const prefixRe = /^#{0,2}\s*第[零〇一二三四五六七八九十百千万\d]+章/;
    let withPrefix = 0, withoutPrefix = 0;
    for (const t of titles) {
      if (!t.trim()) continue;
      if (prefixRe.test(t)) withPrefix++; else withoutPrefix++;
    }
    if (withPrefix > 0 && withoutPrefix > 0) titleFormatMixed = { withPrefix, withoutPrefix };
  }

  return {
    chapters: n,
    patterns,
    topPhrases,
    repeatedSentences: repeatedSentencesList,
    endingShortRatio,
    openingTimeRate,
    titleFormatMixed,
  };
}
