import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { scanObsidianVault } from '../../../src/main/obsidian/markdown-vault';

describe('Obsidian Markdown 只读扫描器', () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = await mkdtemp(path.join(tmpdir(), 'hi-story-obsidian-'));
  });

  afterEach(async () => {
    await rm(vaultPath, { recursive: true, force: true });
  });

  async function write(relativePath: string, content: string | Buffer): Promise<void> {
    const fullPath = path.join(vaultPath, relativePath);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content);
  }

  it('读取人物、世界观和长期大纲，并忽略隐藏目录、附件目录与非 Markdown 文件', async () => {
    await write('人物/林照夜.md', '# 林照夜\n主角。');
    await write('世界观/北境.md', '# 北境\n终年寒冷。');
    await write('大纲/第一卷.md', '# 第一卷\n离开故乡。');
    await write('.obsidian/workspace.md', '不应读取');
    await write('附件/插图.md', '不应读取');
    await write('人物/备注.txt', '不应读取');

    const result = await scanObsidianVault(vaultPath);

    expect(result.status).toBe('ready');
    expect(result.documents).toHaveLength(3);
    expect(result.documents.map(item => [item.kind, item.name])).toEqual(expect.arrayContaining([
      ['outline', '第一卷'],
      ['character', '林照夜'],
      ['world', '北境'],
    ]));
  });

  it('解析 YAML frontmatter，并允许 type 覆盖目录分类', async () => {
    await write('资料/顾青.md', `---
type: character
name: 顾青
tags:
  - 主角
  - 剑修
---
# 人物小传
沉默寡言。
`);

    const result = await scanObsidianVault(vaultPath);
    const document = result.documents[0];

    expect(document).toMatchObject({ kind: 'character', name: '顾青', content: '# 人物小传\n沉默寡言。' });
    expect(document.frontmatter.tags).toEqual(['主角', '剑修']);
  });

  it('支持以 frontmatter 结束且没有正文的 Markdown 文件', async () => {
    await write('人物/空白人物.md', '---\ntype: character\nname: 空白人物\n---');

    const result = await scanObsidianVault(vaultPath);

    expect(result.documents).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: '空白人物', content: '' }),
    ]));
    expect(result.warnings).toEqual([]);
  });

  it('没有 frontmatter 时使用文件名作为名称', async () => {
    await write('characters/沈砚.md', '普通正文');

    const result = await scanObsidianVault(vaultPath);

    expect(result.documents[0]).toMatchObject({ kind: 'character', name: '沈砚', content: '普通正文' });
  });

  it('路径不存在时返回 missing 状态而不是抛错', async () => {
    const result = await scanObsidianVault(path.join(vaultPath, '不存在'));

    expect(result).toMatchObject({ status: 'missing', documents: [], path: path.join(vaultPath, '不存在') });
    expect(result.message).toContain('不存在');
  });

  it('损坏文件只产生警告，不阻断其他文件', async () => {
    await write('人物/正常.md', '仍然可以读取');
    await write('人物/损坏.md', '---\nname: [未闭合\n---\n正文');

    const result = await scanObsidianVault(vaultPath);

    expect(result.documents.map(item => item.name)).toEqual(['正常']);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].relativePath).toBe('人物/损坏.md');
  });
});
