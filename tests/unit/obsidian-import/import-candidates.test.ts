import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { scanImportCandidates, identifySlots, sha256, resolveInsideRoot, IMPORT_LIMITS } from '../../../src/main/obsidian/import-candidates';

describe('Obsidian 导入候选扫描', () => {
  let vault: string;
  beforeEach(async () => { vault = await mkdtemp(path.join(tmpdir(), 'hi-story-import-')); });
  afterEach(async () => { await rm(vault, { recursive: true, force: true }); });
  const write = async (p: string, c: string | Buffer) => { const f = path.join(vault, p); await mkdir(path.dirname(f), { recursive: true }); await writeFile(f, c); };

  it('按目录分类：人物/世界观/分卷大纲目录下的 md 分别归类', async () => {
    await write('人物/沈屿.md', '# 沈屿\n## 性格层次\n- 表面：高智商。');
    await write('世界观/主要场景.md', '# 主要场景\n## 星海游轮\n- 开场地点。');
    await write('分卷大纲/卷一/阶段1.md', '# 阶段1\n## 这一阶段做什么\n推进。');
    await write('我的完整大纲.md', '# 完整大纲\n## 作品定位\n- 类型：BL');
    const r = await scanImportCandidates(vault);
    expect(r.status).toBe('ready');
    const kinds = Object.fromEntries(r.candidates.map(c => [c.relativePath, c.kind]));
    expect(kinds['人物/沈屿.md']).toBe('character');
    expect(kinds['世界观/主要场景.md']).toBe('world');
    expect(kinds['分卷大纲/卷一/阶段1.md']).toBe('outline');
  });

  it('无法分类的 Markdown 保留为 unclassified 并进入候选', async () => {
    await write('资料/随手记.md', '没有类型标记');
    const r = await scanImportCandidates(vault);
    expect(r.candidates.some(c => c.kind === 'unclassified')).toBe(true);
  });

  it('role 优先于文件名；roles 多槽位', async () => {
    expect(identifySlots('大纲/第一卷大纲.md', { role: 'master' }).slots).toEqual(['master']);
    expect(identifySlots('随便.md', { roles: ['volume', 'chapter'] }).slots).toEqual(['volume', 'chapter']);
    expect(identifySlots('第一卷大纲.md', {}).slots).toEqual(['volume']);
  });

  it('路径逃逸被拒绝', async () => {
    await write('人物/正常.md', '正常内容');
    expect(await resolveInsideRoot(vault, '../secret.md')).toBeNull();
    expect(await resolveInsideRoot(vault, 'C:\\Windows\\x.md')).toBeNull();
    expect(await resolveInsideRoot(vault, '人物/正常.md')).toBeTruthy();
  });

  it('超大文件进入 oversize 警告并被跳过', async () => {
    const big = Buffer.alloc(IMPORT_LIMITS.maxFileBytes + 1, 97);
    await write('人物/超长.md', big);
    const r = await scanImportCandidates(vault);
    expect(r.candidates.some(c => c.relativePath === '人物/超长.md')).toBe(false);
    expect(r.issues.some(w => w.code === 'oversize')).toBe(true);
  });

  it('sha256 稳定且与内容一致', () => {
    const a = sha256(Buffer.from('abc'));
    const b = sha256(Buffer.from('abc'));
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });
});
