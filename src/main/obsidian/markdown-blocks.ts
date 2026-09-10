export type MarkdownBlock =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: { text: string; depth: number }[] }
  | { type: 'boldLabel'; label: string; value: string };

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const LIST_RE = /^(\s*)(?:[-*+]|\d+[.、])\s+(.*)$/;
const BOLD_LABEL_RE = /^\*\*(.+?)\*\*\s*[:：]\s*(.*)$/;

/** 把去除 frontmatter 后的 markdown 正文切成顺序块。空行是分隔符。 */
export function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];
  let list: { text: string; depth: number }[] = [];

  const flushParagraph = () => {
    if (paragraph.length) { blocks.push({ type: 'paragraph', text: paragraph.join('\n').trim() }); paragraph = []; }
  };
  const flushList = () => {
    if (list.length) { blocks.push({ type: 'list', items: list }); list = []; }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = line.match(HEADING_RE);
    if (heading) {
      flushParagraph(); flushList();
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].trim() });
      continue;
    }
    const listItem = line.match(LIST_RE);
    if (listItem) {
      flushParagraph();
      const depth = Math.floor(listItem[1].length / 2);
      list.push({ text: listItem[2].trim(), depth });
      continue;
    }
    const bold = line.match(BOLD_LABEL_RE);
    if (bold) {
      flushParagraph(); flushList();
      blocks.push({ type: 'boldLabel', label: bold[1].trim(), value: bold[2].trim() });
      continue;
    }
    if (line.trim() === '') { flushParagraph(); flushList(); continue; }
    flushList();
    paragraph.push(line);
  }
  flushParagraph(); flushList();
  return blocks;
}

export interface MarkdownTable {
  headers: string[];
  rows: string[][];
}

/** 从 markdown 表格文本解析表头与数据行。支持 `\|` 转义竖线。 */
export function parseMarkdownTable(text: string): MarkdownTable {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('|'));

  const splitRow = (line: string): string[] => {
    const cells: string[] = [];
    let current = '';
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '\\' && line[i + 1] === '|') { current += '|'; i++; continue; }
      if (ch === '|') { cells.push(current.trim()); current = ''; continue; }
      current += ch;
    }
    cells.push(current.trim());
    // 去掉首尾空单元格（`| ... |` 的首尾竖线产生空串）
    if (cells.length && cells[0] === '') cells.shift();
    if (cells.length && cells[cells.length - 1] === '') cells.pop();
    return cells;
  };

  const isSeparator = (cells: string[]) => cells.every(cell => /^:?-{3,}:?$/.test(cell.trim()));

  const headerCells = lines.length ? splitRow(lines[0]) : [];
  const rows: string[][] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitRow(lines[i]);
    if (isSeparator(cells)) continue;
    rows.push(cells);
  }
  return { headers: headerCells, rows };
}
