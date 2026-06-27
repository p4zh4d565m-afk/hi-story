/**
 * Novel importer — parse TXT, EPUB, Markdown into Chapter[] data.
 *
 * Strategy:
 * - TXT: split by chapter markers (第X章, Chapter X, etc.) or by double-newline blocks
 * - EPUB: extract .xhtml/.html files from the ZIP, strip tags, split into chapters
 * - Markdown: split by ## / # headings, preserve simple formatting as HTML for TipTap
 */

import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { readZip, stripHtml, type ZipEntry } from './zip-reader';

export interface ImportedChapter {
  title: string;
  content: string;       // HTML for TipTap
  sortOrder: number;
}

export interface ImportResult {
  title: string;          // detected book title
  author?: string;
  chapters: ImportedChapter[];
  format: 'txt' | 'epub' | 'markdown';
  totalWords: number;
  warnings: string[];
}

interface EpubMetadata {
  title?: string;
  author?: string;
}

// ============================================================
// Chapter splitting
// ============================================================

const CHAPTER_PATTERNS = [
  /^第[零一二三四五六七八九十百千万\d]+[章节回幕]/m,
  /^Chapter\s+\d+/im,
  /^Part\s+\d+/im,
  /^[一二三四五六七八九十百千万]+[、，\s]/m,
];

function detectChapterHeadings(text: string): number[] {
  // Try Chinese chapter pattern first
  const cnRe = /^第[零一二三四五六七八九十百千万\d]+[章节回幕]/gm;
  const matches: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = cnRe.exec(text)) !== null) {
    matches.push(m.index);
  }
  if (matches.length >= 3) return matches;

  // Try English chapter pattern
  const enRe = /^Chapter\s+\d+/gim;
  while ((m = enRe.exec(text)) !== null) {
    matches.push(m.index);
  }
  if (matches.length >= 3) return matches;

  return matches;
}

// ============================================================
// TXT import
// ============================================================

function importTxt(filePath: string): ImportResult {
  const warnings: string[] = [];
  let raw = fs.readFileSync(filePath, 'utf-8');

  // Remove BOM
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);

  // Normalize line endings
  raw = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const title = path.basename(filePath, path.extname(filePath));
  const chapters: ImportedChapter[] = [];
  const headingPositions = detectChapterHeadings(raw);

  if (headingPositions.length >= 3) {
    // Split by detected headings
    for (let i = 0; i < headingPositions.length; i++) {
      const start = headingPositions[i];
      const end = i + 1 < headingPositions.length ? headingPositions[i + 1] : raw.length;
      const block = raw.slice(start, end).trim();

      // Extract title from first line
      const newlineIdx = block.indexOf('\n');
      const chTitle = newlineIdx > 0 ? block.slice(0, newlineIdx).trim() : `第${i + 1}章`;
      const body = newlineIdx > 0 ? block.slice(newlineIdx + 1).trim() : block;

      if (body.length > 50) {
        chapters.push({
          title: cleanTitle(chTitle),
          content: textToHtml(body),
          sortOrder: i,
        });
      }
    }
  } else {
    // Try splitting by large blank-line gaps (3+ consecutive newlines)
    const sections = raw.split(/\n{3,}/).filter(s => s.trim().length > 100);

    if (sections.length >= 2) {
      for (let i = 0; i < sections.length; i++) {
        const section = sections[i].trim();
        const firstLine = section.split('\n')[0].trim();
        const isHeading = firstLine.length < 50 && !firstLine.endsWith('。');
        chapters.push({
          title: isHeading ? cleanTitle(firstLine) : `第${i + 1}章`,
          content: textToHtml(isHeading ? section.slice(firstLine.length).trim() : section),
          sortOrder: i,
        });
      }
    } else {
      // Single chapter — no splitting
      chapters.push({
        title: '第一章',
        content: textToHtml(raw.trim()),
        sortOrder: 0,
      });
    }
  }

  if (chapters.length > 100) {
    warnings.push(`已拆分出 ${chapters.length} 个章节，数量较多，可能需要手动调整`);
  }

  const totalWords = countCjk(raw);

  return { title, chapters, format: 'txt', totalWords, warnings };
}

// ============================================================
// EPUB import
// ============================================================

function importEpub(filePath: string): ImportResult {
  const warnings: string[] = [];
  const zip = readZip(filePath);

  // Find container.xml to locate OPF
  const containerEntry = zip.get('META-INF/container.xml');
  if (!containerEntry) throw new Error('Invalid EPUB: missing container.xml');

  const containerXml = containerEntry.getData().toString('utf-8');
  const opfMatch = containerXml.match(/full-path="([^"]+)"/);
  if (!opfMatch) throw new Error('Invalid EPUB: cannot find OPF path');

  const opfPath = opfMatch[1];
  const opfEntry = zip.get(opfPath);
  if (!opfEntry) throw new Error(`Invalid EPUB: OPF not found: ${opfPath}`);

  const opfXml = opfEntry.getData().toString('utf-8');
  const opfDir = path.posix.dirname(opfPath);

  // ── metadata ──
  const titleMatch = opfXml.match(/<dc:title[^>]*>([^<]*)<\/dc:title>/);
  const creatorMatch = opfXml.match(/<dc:creator[^>]*>([^<]*)<\/dc:creator>/);

  // ── spine reading order ──
  const spineMatch = opfXml.match(/<spine[^>]*>([\s\S]*?)<\/spine>/);
  const idrefs: string[] = [];
  if (spineMatch) {
    const idrefRe = /idref="([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = idrefRe.exec(spineMatch[1])) !== null) {
      idrefs.push(m[1]);
    }
  }

  // ── manifest items ──
  const manifest: Map<string, string> = new Map(); // id → href
  const itemRe = /<item[^>]*id="([^"]*)"[^>]*href="([^"]*)"[^>]*\/?>/g;
  let m2: RegExpExecArray | null;
  while ((m2 = itemRe.exec(opfXml)) !== null) {
    manifest.set(m2[1], m2[2]);
  }

  // ── Extract text from spine items ──
  const chapters: ImportedChapter[] = [];
  let chapterIndex = 0;

  for (const idref of idrefs) {
    const href = manifest.get(idref);
    if (!href) continue;

    // Resolve relative path
    const fullPath = path.posix.normalize(
      opfDir ? `${opfDir}/${href}` : href
    );

    const entry = zip.get(fullPath);
    if (!entry || !entry.isFile) continue;

    let html = entry.getData().toString('utf-8');

    // Try to extract <title> for chapter name
    let chTitle = '';
    const titleTag = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    if (titleTag && titleTag[1].trim()) {
      chTitle = titleTag[1].trim();
    } else {
      chTitle = `第${chapterIndex + 1}章`;
    }

    // Extract <body> content
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    if (bodyMatch) {
      html = bodyMatch[1];
    }

    const plainText = stripHtml(html);
    if (plainText.length < 100) {
      warnings.push(`跳过内容过短的章节: ${chTitle} (${plainText.length} 字)`);
      continue;
    }

    // Convert to simple HTML paragraphs for TipTap
    const tipTapHtml = textToHtml(plainText);

    chapters.push({
      title: cleanTitle(chTitle),
      content: tipTapHtml,
      sortOrder: chapterIndex,
    });

    chapterIndex++;
  }

  if (chapters.length === 0) {
    throw new Error('未提取到任何章节内容，EPUB 可能为图片格式或加密');
  }

  const totalWords = chapters.reduce((sum, ch) => sum + countCjk(stripHtml(ch.content)), 0);

  return {
    title: titleMatch?.[1]?.trim() || path.basename(filePath, '.epub'),
    author: creatorMatch?.[1]?.trim(),
    chapters,
    format: 'epub',
    totalWords,
    warnings,
  };
}

// ============================================================
// Markdown import
// ============================================================

function importMarkdown(filePath: string): ImportResult {
  const warnings: string[] = [];
  let raw = fs.readFileSync(filePath, 'utf-8');

  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  raw = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const title = path.basename(filePath, path.extname(filePath));
  const chapters: ImportedChapter[] = [];

  // Split by H2 (##) or H1 (#) headings
  const headingRe = /^(#{1,2})\s+(.+)$/gm;
  const headingPositions: Array<{ index: number; level: number; text: string }> = [];

  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(raw)) !== null) {
    headingPositions.push({ index: m.index, level: m[1].length, text: m[2].trim() });
  }

  if (headingPositions.length >= 2) {
    for (let i = 0; i < headingPositions.length; i++) {
      const current = headingPositions[i];
      const next = headingPositions[i + 1];
      const bodyStart = raw.indexOf('\n', current.index) + 1;
      const bodyEnd = next ? next.index : raw.length;
      const body = raw.slice(bodyStart, bodyEnd).trim();

      if (body.length > 50) {
        chapters.push({
          title: cleanTitle(current.text),
          content: markdownToHtml(body),
          sortOrder: i,
        });
      }
    }
  } else {
    // No headings found — treat whole file as one chapter
    chapters.push({
      title: '第一章',
      content: markdownToHtml(raw.trim()),
      sortOrder: 0,
    });
  }

  if (chapters.length > 200) {
    warnings.push(`已拆分出 ${chapters.length} 个章节，数量较多`);
  }

  const totalWords = countCjk(raw);

  return { title, chapters, format: 'markdown', totalWords, warnings };
}

// ============================================================
// Main entry
// ============================================================

export function importNovel(filePath: string): ImportResult {
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case '.txt':
      return importTxt(filePath);
    case '.epub':
      return importEpub(filePath);
    case '.md':
    case '.markdown':
      return importMarkdown(filePath);
    default:
      throw new Error(`不支持的文件格式: ${ext}。支持 TXT、EPUB、Markdown。`);
  }
}

// ============================================================
// Helpers
// ============================================================

function textToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return '<p>' + escaped.split(/\n{2,}/).map(para =>
    para.split('\n').join('<br>')
  ).join('</p><p>') + '</p>';
}

function markdownToHtml(md: string): string {
  // Simple Markdown → HTML conversion for TipTap
  const paragraphs = md.split(/\n{2,}/);

  return paragraphs.map(p => {
    p = p.trim();
    if (!p) return '';

    // Headings (already split, but handle inline)
    if (/^###\s/.test(p)) return `<h3>${escapeHtml(p.slice(4))}</h3>`;
    if (/^##\s/.test(p)) return `<h2>${escapeHtml(p.slice(3))}</h2>`;
    if (/^#\s/.test(p)) return `<h1>${escapeHtml(p.slice(2))}</h1>`;

    // Horizontal rule
    if (/^[-*_]{3,}$/.test(p)) return '<hr>';

    // Unordered list
    if (/^[-*+]\s/.test(p)) {
      const items = p.split('\n').filter(l => /^[-*+]\s/.test(l));
      return '<ul>' + items.map(item => `<li>${processInline(item.replace(/^[-*+]\s/, ''))}</li>`).join('') + '</ul>';
    }

    // Ordered list
    if (/^\d+\.\s/.test(p)) {
      const items = p.split('\n').filter(l => /^\d+\.\s/.test(l));
      return '<ol>' + items.map(item => `<li>${processInline(item.replace(/^\d+\.\s/, ''))}</li>`).join('') + '</ol>';
    }

    // Blockquote
    if (/^>\s/.test(p)) {
      const lines = p.split('\n').map(l => l.replace(/^>\s?/, '')).join('<br>');
      return `<blockquote>${processInline(lines)}</blockquote>`;
    }

    // Code block
    if (/^```/.test(p) && /```$/.test(p)) {
      const code = p.replace(/^```\w*\n?/, '').replace(/```$/, '').trim();
      return `<pre><code>${escapeHtml(code)}</code></pre>`;
    }

    return `<p>${processInline(p)}</p>`;
  }).filter(Boolean).join('');
}

function processInline(text: string): string {
  // Bold, italic, code, links
  return escapeHtml(text)
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\n/g, '<br>');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function cleanTitle(title: string): string {
  return title.replace(/^第[零一二三四五六七八九十百千万\d]+[章节回幕]\s*/g, '').trim() || title;
}

function countCjk(text: string): number {
  return (text.match(/[一-鿿㐀-䶿]/g) || []).length ||
    text.replace(/<[^>]*>/g, '').replace(/\s+/g, '').length;
}
