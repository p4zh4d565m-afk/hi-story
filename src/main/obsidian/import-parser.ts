import type {
  MasterOutline, OutlinePhase, VolumeOutline,
  ObsidianImportSlot, ObsidianImportDrafts, ObsidianImportIssue,
  ImportChapterDraft, ImportCharacterInput, ImportWorldInput,
} from '../../renderer/types';
import { parseMarkdownBlocks, parseMarkdownTable, type MarkdownBlock } from './markdown-blocks';

export interface ParseResult<T> { value: T; issues: ObsidianImportIssue[] }

/** 剥掉 `[[路径|显示文本]]` 或 `[[路径]]`，取显示文本；缺省时取路径末段（去掉 #锚点）。 */
export function stripWikiLinks(text: string): string {
  return text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target: string, label?: string) => {
    if (label) return label;
    const noAnchor = target.split('#')[0];
    const seg = noAnchor.split('/').filter(Boolean);
    return seg.length ? seg[seg.length - 1] : noAnchor;
  });
}

/** 从标题文本解析章节/卷号：`第 N 章` / `第 N 卷`，支持阿拉伯与中文数字（1—9999）。 */
const CN_DIGITS: Record<string, number> = { '零': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
const CN_UNITS: Record<string, number> = { '十': 10, '百': 100, '千': 1000 };
function chineseNumberToInt(s: string): number | null {
  if (!s || !/^[零一二两三四五六七八九十百千]+$/.test(s)) return null;
  let total = 0; let section = 0; let number = 0;
  for (const ch of s) {
    const d = CN_DIGITS[ch];
    if (d !== undefined) { number = d; continue; }
    const u = CN_UNITS[ch];
    if (u !== undefined) { if (number === 0) number = 1; section += number * u; number = 0; continue; }
  }
  total = section + number;
  return total > 0 ? total : null;
}

/** 匹配「第 N 章」「第 N 卷」，返回 {number, kind, tail}。 */
function parseNumberedHeading(text: string): { number: number; kind: 'chapter' | 'volume'; tail: string } | null {
  const m = text.match(/^第\s*(0*[1-9][0-9]*|[零一二两三四五六七八九十百千]+)\s*([章卷])(?:\s*[:：]?\s*(.*))?$/);
  if (!m) return null;
  const num = /^[0-9]+$/.test(m[1]) ? parseInt(m[1], 10) : chineseNumberToInt(m[1]);
  if (!num) return null;
  return { number: num, kind: m[2] as 'chapter' | 'volume', tail: (m[3] || '').trim() };
}

/** 段落内所有 block 的纯文本（剥 wiki 链接）。 */
function blocksText(blocks: MarkdownBlock[]): string {
  return blocks.map(b => {
    if (b.type === 'paragraph') return b.text;
    if (b.type === 'heading') return b.text;
    if (b.type === 'boldLabel') return `${b.label}：${b.value}`;
    if (b.type === 'list') return b.items.map(it => it.text).join(' ');
    return '';
  }).filter(Boolean).join('\n');
}

/** 段落内列表项（剥 wiki 链接）。 */
function listText(blocks: MarkdownBlock[]): string[] {
  return blocks.filter(b => b.type === 'list').flatMap(b => b.items.map(it => stripWikiLinks(it.text)));
}

/** 从标题（包含匹配）到下一同级/更高级标题之间的段落。 */
function findSection(blocks: MarkdownBlock[], headingText: string, level: number): MarkdownBlock[] {
  let start = -1;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type === 'heading' && b.level === level && b.text.includes(headingText)) { start = i + 1; break; }
  }
  if (start === -1) return [];
  const out: MarkdownBlock[] = [];
  for (let i = start; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type === 'heading' && b.level <= level) break;
    out.push(b);
  }
  return out;
}

/** 按前缀匹配段落标题（如「结局」匹配「- 结局：xxx」行）。 */
function findField(lines: string[], prefix: string): string {
  const line = lines.find(l => l.startsWith(prefix));
  if (!line) return '';
  const idx = line.indexOf('：') >= 0 ? line.indexOf('：') : line.indexOf(':');
  return idx >= 0 ? line.slice(idx + 1).trim() : line.replace(prefix, '').trim();
}

// ===== 总纲 =====
export function parseMaster(content: string, name: string): ParseResult<MasterOutline> {
  const blocks = parseMarkdownBlocks(content);
  const outline: MasterOutline = { premise: '', ending: '', protagonistArc: '', centralConflict: '', structureModel: '', phases: [], subplots: [], storyPromises: [] };
  const issues: ObsidianImportIssue[] = [];

  // premise：首个 blockquote 的「完整设定」行，缺省用第一段
  const blockquoteText = blocks.filter(b => b.type === 'paragraph').map(b => b.text).join('\n');
  const fullSetting = blockquoteText.match(/完整设定[：:]\s*(.+)/);
  if (fullSetting) outline.premise = stripWikiLinks(fullSetting[1].trim());
  else {
    const firstPara = blocks.find(b => b.type === 'paragraph');
    if (firstPara) outline.premise = stripWikiLinks(firstPara.text);
  }

  const position = findSection(blocks, '作品定位', 2);
  const posLines = position.filter(b => b.type === 'list').flatMap(b => b.items.map(it => it.text));
  outline.ending = findField(posLines, '结局');
  outline.structureModel = findField(posLines, '类型');
  outline.protagonistArc = findField(posLines, '人设定调');

  // phases：三卷大纲索引
  const index = findSection(blocks, '三卷大纲索引', 2);
  const indexLines = listText(index);
  const phaseRe = /(卷\s*\d+[^（(]*)[（(]第\s*(\d+)[—-]\s*(\d+)\s*章/;
  for (const line of indexLines) {
    const m = line.match(phaseRe);
    if (m) {
      outline.phases.push({ title: m[1].trim(), purpose: '', chapterRange: `第 ${m[2]}-${m[3]} 章`, keyEvents: [], turningPoint: '', emotionTrend: '' });
    }
  }

  // subplots：三攻反转错开
  const reversal = findSection(blocks, '三攻反转错开', 2);
  outline.subplots = listText(reversal);

  // storyPromises：伏笔总表
  const foreshadow = findSection(blocks, '伏笔总表', 2);
  const foreshadowText = blocksText(foreshadow);
  const table = parseMarkdownTable(foreshadowText);
  if (table.rows.length) {
    const subjectIdx = table.headers.findIndex(h => h === '伏笔');
    const contentIdx = table.headers.findIndex(h => h === '内容');
    outline.storyPromises = table.rows.map(r => {
      const subject = subjectIdx >= 0 ? stripWikiLinks(r[subjectIdx] || '') : '';
      const content = contentIdx >= 0 ? stripWikiLinks(r[contentIdx] || '') : '';
      return subject && content ? `${subject}：${content}` : (subject || content || r.join(' '));
    }).filter(Boolean);
  }

  if (!outline.premise) issues.push({ code: 'missing_field', severity: 'warning', message: '总纲缺少 premise' });
  return { value: outline, issues };
}

// ===== 分卷 =====
export function parseVolumes(content: string): ParseResult<VolumeOutline[]> {
  const blocks = parseMarkdownBlocks(content);
  const volumes: VolumeOutline[] = [];
  const issues: ObsidianImportIssue[] = [];

  // 一级标题 = 一个卷
  const topHeadings = blocks.filter((b): b is Extract<MarkdownBlock, { type: 'heading' }> => b.type === 'heading' && b.level === 1);
  for (const h of topHeadings) {
    const sec = findSection(blocks, h.text, 1);
    const conflict = findSection(sec, '核心冲突', 2);
    const stages = findSection(sec, '阶段拆解', 2);
    const hook = findSection(sec, '卷末钩子', 2);
    const chars = findSection(sec, '本卷重点人物', 2);

    const titleMatch = h.text.match(/^(.+?)[（(]第\s*(\d+)[—-]\s*(\d+)\s*章/);
    const volume: VolumeOutline = {
      title: titleMatch ? titleMatch[1].trim() : h.text,
      chapterRange: titleMatch ? `第 ${titleMatch[2]}-${titleMatch[3]} 章` : '',
      volumeGoal: stripWikiLinks(blocksText(conflict).trim()),
      openingState: '', mainProgression: stripWikiLinks(listText(stages).join('；')),
      characterProgression: stripWikiLinks(blocksText(chars).trim()),
      keyEvents: listText(stages), climax: stripWikiLinks(blocksText(hook).trim()),
      endingState: '', promisesOpened: [], promisesPaid: [],
    };
    volumes.push(volume);
  }

  if (volumes.length === 0) issues.push({ code: 'missing_field', severity: 'warning', message: '未识别到分卷标题' });
  return { value: volumes, issues };
}

// ===== 章纲（表格）=====
export function parseChapters(content: string, defaultVolumeIndex: number | null): ParseResult<ImportChapterDraft[]> {
  const blocks = parseMarkdownBlocks(content);
  const chapters: ImportChapterDraft[] = [];
  const issues: ObsidianImportIssue[] = [];
  let currentVolumeIndex = defaultVolumeIndex ?? -1;
  let lastChapterNumber = 0;

  // 按顺序扫描：`## 卷 N ...` 标题切换当前卷；表格行产出章节。
  for (const b of blocks) {
    if (b.type === 'heading') {
      const volMatch = b.text.match(/卷\s*(\d+)/);
      if (volMatch) currentVolumeIndex = parseInt(volMatch[1], 10) - 1;
      continue;
    }
    if (b.type !== 'paragraph') continue;
    const table = parseMarkdownTable(b.text);
    if (!table.rows.length) continue;

    const col = (name: string) => table.headers.findIndex(h => h === name);
    // 可选列：仅当表头命中任一别名时才解析，否则该字段留空（绝不猜测）
    const optionalCol = (names: string[]) => {
      const lower = names.map(n => n.toLowerCase());
      return table.headers.findIndex(h => lower.includes(h.toLowerCase()));
    };
    const iChapter = col('章');
    const iTitle = col('标题');
    const iCore = col('核心事件');
    const iPush = col('剧情推进');
    const iCool = col('爽点/悬念');
    const iForeshadow = col('伏笔');
    const iScene = col('场景');
    const iEmotion = col('情绪');
    const iPov = optionalCol(['视角', 'POV', 'pov']);
    const iOpening = optionalCol(['开场处境', '开场']);
    const iKeyBeats = optionalCol(['关键节拍', '节拍', 'keyBeats']);
    const iCharacterChange = optionalCol(['人物变化', '人物弧变化']);

    for (const row of table.rows) {
      const chapterNumber = iChapter >= 0 ? parseInt(row[iChapter], 10) : NaN;
      if (!Number.isInteger(chapterNumber) || chapterNumber <= 0) {
        issues.push({ code: 'missing_assignment', severity: 'blocking', message: `无法解析章节号：${row[iChapter] ?? ''}` });
        continue;
      }
      if (lastChapterNumber > 0 && chapterNumber !== lastChapterNumber + 1) {
        issues.push({ code: 'chapter_gap', severity: 'warning', message: `章节断号：第${lastChapterNumber}章后直接是第${chapterNumber}章` });
      }
      lastChapterNumber = chapterNumber;

      const coolCell = iCool >= 0 ? stripWikiLinks(row[iCool] || '') : '';
      const coolParts = coolCell.split('；').map(s => s.trim()).filter(Boolean);
      const payoff = coolParts.find(s => s.startsWith('爽点'))?.replace(/^爽点[：:]?/, '').trim() || '';
      const endingHook = coolParts.find(s => s.startsWith('钩子') || s.startsWith('悬念'))?.replace(/^(钩子|悬念)[：:]?/, '').trim() || '';

      const keyBeatsCell = iKeyBeats >= 0 ? stripWikiLinks(row[iKeyBeats] || '') : '';
      const keyBeats = keyBeatsCell.split(/[；、]/).map(s => s.trim()).filter(Boolean);

      chapters.push({
        sourceHeading: `${chapterNumber} ${iTitle >= 0 ? row[iTitle] || '' : ''}`.trim(),
        chapterNumber,
        volumeIndex: currentVolumeIndex >= 0 ? currentVolumeIndex : null,
        title: iTitle >= 0 ? stripWikiLinks(row[iTitle] || '') : '',
        pov: iPov >= 0 ? stripWikiLinks(row[iPov] || '') : '',
        chapterGoal: iPush >= 0 ? stripWikiLinks(row[iPush] || '') : '',
        openingSituation: iOpening >= 0 ? stripWikiLinks(row[iOpening] || '') : '',
        centralConflict: iCore >= 0 ? stripWikiLinks(row[iCore] || '') : '',
        keyBeats,
        reveal: iForeshadow >= 0 ? stripWikiLinks(row[iForeshadow] || '') : '',
        characterChange: iCharacterChange >= 0 ? stripWikiLinks(row[iCharacterChange] || '') : '',
        emotionalBeat: iEmotion >= 0 ? stripWikiLinks(row[iEmotion] || '') : '',
        payoff,
        endingHook,
      });
    }
  }

  if (chapters.length === 0) issues.push({ code: 'missing_field', severity: 'warning', message: '未识别到章节表格' });
  return { value: chapters, issues };
}

// ===== 人物 =====
export function parseCharacter(content: string, name: string, frontmatter: Record<string, unknown>): ParseResult<{ aliases: string; appearance: string; personality: string; background: string; arc: string }> {
  const blocks = parseMarkdownBlocks(content);
  const issues: ObsidianImportIssue[] = [];

  let aliases = '';
  const fmAliases = frontmatter.aliases;
  if (Array.isArray(fmAliases)) aliases = fmAliases.map(String).join('、');
  else if (typeof fmAliases === 'string') aliases = fmAliases;

  const identity = findSection(blocks, '身份与能力', 2);
  const personality = findSection(blocks, '性格层次', 2);
  const desire = findSection(blocks, '欲望与成长', 2);
  const appearance = findSection(blocks, '外貌', 2);
  const aliasSec = findSection(blocks, '别名', 2);

  const backgroundText = stripWikiLinks(blocksText(identity).trim());
  const appearanceText = stripWikiLinks(blocksText(appearance).trim());
  const arcText = stripWikiLinks(listText(desire).join('；'));

  let aliasesFromSection = listText(aliasSec).join('、');
  if (aliasesFromSection) aliases = aliasesFromSection;

  return {
    value: {
      aliases,
      appearance: appearanceText,
      personality: stripWikiLinks(blocksText(personality).trim()),
      background: backgroundText,
      arc: arcText,
    },
    issues,
  };
}

// ===== 世界观 =====
export function parseWorld(content: string, name: string): { description: string } {
  return { description: stripWikiLinks(content.trim()) };
}

const WORLD_CATEGORIES = ['place', 'faction', 'race', 'law', 'history', 'culture'];

/** 按 slots 编排五类解析，产出预览 drafts 并转 issues。 */
export function parseCandidateDrafts(
  content: string, frontmatter: Record<string, unknown>, slots: ObsidianImportSlot[], name: string, defaultVolumeIndex?: number | null,
): { drafts: ObsidianImportDrafts; issues: ObsidianImportIssue[] } {
  const drafts: ObsidianImportDrafts = { master: null, volumes: [], chapters: [], characters: [], worlds: [] };
  const issues: ObsidianImportIssue[] = [];

  if (slots.includes('master')) {
    const r = parseMaster(content, name);
    drafts.master = r.value;
    issues.push(...r.issues);
  }
  if (slots.includes('volume')) {
    const r = parseVolumes(content);
    drafts.volumes = r.value;
    issues.push(...r.issues);
  }
  if (slots.includes('chapter')) {
    const r = parseChapters(content, defaultVolumeIndex ?? null);
    drafts.chapters = r.value;
    issues.push(...r.issues);
  }
  if (slots.includes('character')) {
    const r = parseCharacter(content, name, frontmatter);
    const c: ImportCharacterInput = {
      sourceName: name, name, aliases: r.value.aliases, appearance: r.value.appearance,
      personality: r.value.personality, background: r.value.background, arc: r.value.arc, overwrite: false,
    };
    drafts.characters = [c];
  }
  if (slots.includes('world')) {
    const w = parseWorld(content, name);
    const cat = typeof frontmatter.category === 'string' && WORLD_CATEGORIES.includes(frontmatter.category)
      ? frontmatter.category as ImportWorldInput['category']
      : null;
    drafts.worlds = [{ sourceName: name, name, category: cat, description: w.description, overwrite: false }];
  }
  return { drafts, issues };
}
