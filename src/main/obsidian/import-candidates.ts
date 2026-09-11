import { promises as fs } from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { parseMarkdown, getKind, shouldIgnoreDirectory } from './markdown-vault';
import { parseCandidateDrafts } from './import-parser';
import type { ObsidianImportCandidate, ObsidianImportSlot, ObsidianImportIssue } from '../../renderer/types';

export const IMPORT_LIMITS = { maxFileBytes: 2 * 1024 * 1024, maxCandidates: 500, maxTotalBytes: 50 * 1024 * 1024 };

export function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** 校验相对路径并返回真实绝对路径；拒绝绝对路径、盘符、UNC、`..` 及符号链接逃逸。 */
export async function resolveInsideRoot(rootPath: string, relativePath: string): Promise<string | null> {
  if (path.isAbsolute(relativePath)) return null;
  if (/^[a-zA-Z]:[\\/]/.test(relativePath)) return null;
  if (relativePath.startsWith('\\\\')) return null;
  const normalized = relativePath.split('\\').join('/');
  if (normalized.split('/').some(seg => seg === '..')) return null;
  const rootReal = await fs.realpath(rootPath).catch(() => null);
  if (!rootReal) return null;
  const target = path.join(rootPath, relativePath);
  const targetReal = await fs.realpath(target).catch(() => null);
  if (!targetReal) return null;
  const rel = path.relative(rootReal, targetReal);
  // rel 不以 ../ 开头且不是绝对路径，则目标在根目录内
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)) ? targetReal : null;
}

const SLOT_ORDER: ObsidianImportSlot[] = ['chapter', 'master', 'volume'];

/** 大纲辅助文件：卷内阶段文件与分卷总览——它们不是「一个文件 = 一个卷」的真卷，导入时忽略，避免空卷/阶段噪音。 */
export function isOutlineAuxiliary(relativePath: string): boolean {
  const name = relativePath.toLowerCase();
  const base = path.basename(relativePath).toLowerCase();
  // 卷目录（分卷大纲/卷N 或 第N卷）下的「阶段N」文件
  const dirSegs = relativePath.split('/').slice(0, -1).map(s => s.toLowerCase());
  const inVolumeDir = dirSegs.some(s => /分卷大纲|^第.{1,8}卷/.test(s));
  const isStageFile = /^阶段\s*\d+/.test(base);
  if (inVolumeDir && isStageFile) return true;
  // 分卷总览：文件名本身含「分卷大纲」但非「大纲_卷N」形式（如「小说大纲_分卷大纲.md」），且不在卷目录内
  if (/分卷大纲/.test(base) && !/大纲_卷\d/.test(base) && !inVolumeDir) return true;
  return false;
}

/** 大纲细分：role/roles 优先，其次文件名按章纲→总纲→分卷特异性顺序，最后目录层级。 */
export function identifySlots(relativePath: string, frontmatter: Record<string, unknown>): { slots: ObsidianImportSlot[]; issues: ObsidianImportIssue[] } {
  const issues: ObsidianImportIssue[] = [];
  // 阶段文件与分卷总览显式排除（最优先），即使作者显式声明 role 也不当卷——只读导入的确定性保护
  if (isOutlineAuxiliary(relativePath)) return { slots: [], issues };

  const role = frontmatter.role;
  const roles = frontmatter.roles;
  const valid: ObsidianImportSlot[] = ['master', 'volume', 'chapter'];

  if (Array.isArray(roles)) {
    const slots = roles.filter((r): r is ObsidianImportSlot => valid.includes(r as any));
    const invalid = roles.filter(r => !valid.includes(r as any));
    if (invalid.length) issues.push({ code: 'invalid_input', severity: 'warning', message: `忽略非法 role 值：${invalid.join('、')}` });
    if (role !== undefined) issues.push({ code: 'conflict', severity: 'warning', message: 'role 与 roles 同时存在，以 roles 为准' });
    if (slots.length) return { slots: [...new Set(slots)], issues };
  }
  if (typeof role === 'string' && valid.includes(role as any)) return { slots: [role as ObsidianImportSlot], issues };

  const name = relativePath.toLowerCase();
  // 特异性顺序：先章纲，再总纲，最后分卷（避免「第一卷大纲」误判为总纲）
  if (/章节细纲|章节|章纲/.test(name)) return { slots: ['chapter'], issues };
  if (/完整大纲|全书总纲|总纲|全书/.test(name)) return { slots: ['master'], issues };
  if (/大纲_卷\d|分卷|卷纲|第.{1,4}卷/.test(name)) return { slots: ['volume'], issues };

  const dirSegments = relativePath.split('/').slice(0, -1).map(s => s.toLowerCase());
  if (dirSegments.some(s => /^(第.{1,8}卷|分卷|卷纲)/.test(s))) return { slots: ['volume'], issues };
  return { slots: [], issues };
}

export interface ImportScanResult {
  status: 'ready' | 'missing';
  rootPath: string;
  candidates: ObsidianImportCandidate[];
  issues: ObsidianImportIssue[];
  message?: string;
}

/** 递归遍历 md 文件，遍历过程中即时限流（候选数与总字节），不先全量收集进内存。 */
async function collectMarkdownFilesLimited(rootPath: string, onLimit: (reason: string) => void): Promise<string[]> {
  const files: string[] = [];
  let totalBytes = 0;
  let limited = false;

  async function visit(directory: string): Promise<void> {
    if (limited) return;
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => [] as never[]);
    entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    for (const entry of entries) {
      if (limited) return;
      if (entry.isSymbolicLink()) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!shouldIgnoreDirectory(entry.name)) await visit(fullPath);
        continue;
      }
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.md') continue;
      if (files.length >= IMPORT_LIMITS.maxCandidates) { onLimit('候选文件达到 500 个上限，剩余文件未读取'); limited = true; return; }
      const stat = await fs.stat(fullPath).catch(() => null);
      if (!stat) continue;
      if (totalBytes + stat.size > IMPORT_LIMITS.maxTotalBytes) { onLimit('总读取量达到 50 MiB 上限，剩余文件未读取'); limited = true; return; }
      totalBytes += stat.size;
      files.push(fullPath);
    }
  }

  await visit(rootPath);
  return files;
}

/** 排除导航/汇总类文件。 */
function isNavFile(relativePath: string): boolean {
  const base = path.basename(relativePath);
  return /^\d+\s*.*导航\.md$/.test(base) || /配角速查\.md$/.test(base);
}

export async function scanImportCandidates(rootPath: string): Promise<ImportScanResult> {
  const configuredPath = rootPath.trim();
  if (!configuredPath) return { status: 'missing', rootPath: '', candidates: [], issues: [], message: '尚未配置 Obsidian 目录' };
  try {
    const stat = await fs.stat(configuredPath);
    if (!stat.isDirectory()) throw new Error('配置路径不是目录');
  } catch (e) {
    return { status: 'missing', rootPath: configuredPath, candidates: [], issues: [], message: `Obsidian 目录不可访问：${(e as Error).message}` };
  }

  const candidates: ObsidianImportCandidate[] = [];
  const issues: ObsidianImportIssue[] = [];
  const limitReasons = new Set<string>();
  const files = await collectMarkdownFilesLimited(configuredPath, r => limitReasons.add(r));
  for (const reason of limitReasons) issues.push({ code: 'oversize', severity: 'warning', message: reason });

  for (const filePath of files) {
    const relativePath = path.relative(configuredPath, filePath).split(path.sep).join('/');
    if (isNavFile(relativePath)) continue;
    // 大纲辅助文件（卷内阶段 / 分卷总览）不进入候选，避免空卷/阶段噪音
    if (isOutlineAuxiliary(relativePath)) continue;
    try {
      const stat = await fs.stat(filePath);
      if (stat.size > IMPORT_LIMITS.maxFileBytes) {
        issues.push({ code: 'oversize', severity: 'warning', message: '文件超过 2 MiB 上限，已跳过', relativePath });
        continue;
      }
      const bytes = await fs.readFile(filePath);
      const parsed = parseMarkdown(bytes.toString('utf8'));
      const kind = getKind(relativePath, parsed.frontmatter) ?? 'unclassified';

      // 人物/世界观直接定槽位；outline 与根目录大纲文件走文件名细分
      let slots: ObsidianImportSlot[] = [];
      let slotIssues: ObsidianImportIssue[] = [];
      if (kind === 'character') slots = ['character'];
      else if (kind === 'world') slots = ['world'];
      else {
        const id = identifySlots(relativePath, parsed.frontmatter);
        slots = id.slots; slotIssues = id.issues;
      }

      const frontmatterName = typeof parsed.frontmatter.name === 'string' ? parsed.frontmatter.name.trim() : '';
      const name = frontmatterName || path.basename(filePath, path.extname(filePath));
      const parsedDrafts = parseCandidateDrafts(parsed.content, parsed.frontmatter, slots, name);

      candidates.push({
        relativePath, hash: sha256(bytes), name, kind, slots,
        drafts: parsedDrafts.drafts,
        issues: [
          ...(slots.length === 0 ? [{ code: 'unclassified' as const, severity: 'warning' as const, message: '无法自动分类，请在预览中手动指定', relativePath }] : []),
          ...slotIssues,
          ...parsedDrafts.issues,
        ],
      });
    } catch (e) {
      issues.push({ code: 'bad_file', severity: 'warning', message: (e as Error).message || '文件读取失败', relativePath });
    }
  }
  return { status: 'ready', rootPath: configuredPath, candidates, issues };
}
