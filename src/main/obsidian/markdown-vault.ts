import { promises as fs } from 'fs';
import path from 'path';
import type {
  ObsidianDocument,
  ObsidianDocumentKind,
  ObsidianScanResult,
  ObsidianScanWarning,
} from '../../renderer/types';

const yaml = require('js-yaml') as { load(source: string): unknown };

const IGNORED_DIRECTORIES = new Set([
  '.obsidian', '.trash', 'attachments', 'attachment', 'assets', '附件', '图片', 'images',
]);

const DIRECTORY_KINDS: Record<string, ObsidianDocumentKind> = {
  '人物': 'character',
  '角色': 'character',
  characters: 'character',
  character: 'character',
  '世界观': 'world',
  '设定': 'world',
  world: 'world',
  settings: 'world',
  '大纲': 'outline',
  '长期大纲': 'outline',
  '分卷大纲': 'outline',
  outlines: 'outline',
  outline: 'outline',
};

const TYPE_KINDS: Record<string, ObsidianDocumentKind> = {
  character: 'character',
  role: 'character',
  '人物': 'character',
  '角色': 'character',
  world: 'world',
  setting: 'world',
  '世界观': 'world',
  '设定': 'world',
  outline: 'outline',
  'long-outline': 'outline',
  '大纲': 'outline',
  '长期大纲': 'outline',
};

interface ParsedMarkdown {
  frontmatter: Record<string, unknown>;
  content: string;
}

export function parseMarkdown(source: string): ParsedMarkdown {
  const normalized = source.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return { frontmatter: {}, content: normalized.trim() };
  }

  const frontmatterMatch = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!frontmatterMatch) throw new Error('YAML frontmatter 缺少结束分隔线');

  const parsed = yaml.load(frontmatterMatch[1]);
  if (parsed !== undefined && (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))) {
    throw new Error('YAML frontmatter 必须是键值对象');
  }

  return {
    frontmatter: (parsed ?? {}) as Record<string, unknown>,
    content: normalized.slice(frontmatterMatch[0].length).trim(),
  };
}

export function getKind(relativePath: string, frontmatter: Record<string, unknown>): ObsidianDocumentKind | null {
  const declaredType = typeof frontmatter.type === 'string' ? frontmatter.type.trim().toLowerCase() : '';
  if (declaredType && TYPE_KINDS[declaredType]) return TYPE_KINDS[declaredType];

  const firstDirectory = relativePath.split('/')[0].toLowerCase();
  return DIRECTORY_KINDS[firstDirectory] ?? null;
}

export function shouldIgnoreDirectory(name: string): boolean {
  return name.startsWith('.') || IGNORED_DIRECTORIES.has(name.toLowerCase());
}

async function collectMarkdownFiles(rootPath: string): Promise<string[]> {
  const files: string[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!shouldIgnoreDirectory(entry.name)) await visit(fullPath);
      } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.md') {
        files.push(fullPath);
      }
    }
  }

  await visit(rootPath);
  return files.sort((left, right) => left.localeCompare(right, 'zh-CN'));
}

export async function scanObsidianVault(vaultPath: string): Promise<ObsidianScanResult> {
  const configuredPath = vaultPath.trim();
  if (!configuredPath) {
    return { status: 'unconfigured', path: '', documents: [], warnings: [], message: '尚未配置 Obsidian 目录' };
  }

  try {
    const stat = await fs.stat(configuredPath);
    if (!stat.isDirectory()) throw new Error('配置路径不是目录');
  } catch {
    return {
      status: 'missing',
      path: configuredPath,
      documents: [],
      warnings: [],
      message: `Obsidian 目录不存在或不可访问：${configuredPath}`,
    };
  }

  const documents: ObsidianDocument[] = [];
  const warnings: ObsidianScanWarning[] = [];
  let files: string[];
  try {
    files = await collectMarkdownFiles(configuredPath);
  } catch (error) {
    return {
      status: 'missing',
      path: configuredPath,
      documents: [],
      warnings: [],
      message: `Obsidian 目录不可读取：${(error as Error).message}`,
    };
  }

  for (const filePath of files) {
    const relativePath = path.relative(configuredPath, filePath).split(path.sep).join('/');
    try {
      const source = await fs.readFile(filePath, 'utf8');
      const parsed = parseMarkdown(source);
      const kind = getKind(relativePath, parsed.frontmatter);
      if (!kind) continue;
      const stat = await fs.stat(filePath);
      const frontmatterName = typeof parsed.frontmatter.name === 'string' ? parsed.frontmatter.name.trim() : '';
      documents.push({
        id: relativePath,
        kind,
        name: frontmatterName || path.basename(filePath, path.extname(filePath)),
        relativePath,
        content: parsed.content,
        frontmatter: parsed.frontmatter,
        updatedAt: stat.mtime.toISOString(),
      });
    } catch (error) {
      warnings.push({ relativePath, message: (error as Error).message || '文件读取失败' });
    }
  }

  return { status: 'ready', path: configuredPath, documents, warnings };
}
