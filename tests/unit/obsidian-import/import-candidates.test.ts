import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { scanImportCandidates, identifySlots, isOutlineAuxiliary, sha256, resolveInsideRoot, IMPORT_LIMITS } from '../../../src/main/obsidian/import-candidates';
import { volumeDirToIndex } from '../../../src/main/obsidian/import-parser';

describe('Obsidian 导入候选扫描', () => {
  let vault: string;
  beforeEach(async () => { vault = await mkdtemp(path.join(tmpdir(), 'hi-story-import-')); });
  afterEach(async () => { await rm(vault, { recursive: true, force: true }); });
  const write = async (p: string, c: string | Buffer) => { const f = path.join(vault, p); await mkdir(path.dirname(f), { recursive: true }); await writeFile(f, c); };

  it('按目录分类：人物/世界观/分卷大纲目录下的 md 分别归类', async () => {
    await write('人物/沈屿.md', '# 沈屿\n## 性格层次\n- 表面：高智商。');
    await write('世界观/主要场景.md', '# 主要场景\n## 星海游轮\n- 开场地点。');
    await write('分卷大纲/卷一大纲.md', '# 卷 1\n## 核心冲突\n推进。');
    await write('我的完整大纲.md', '# 完整大纲\n## 作品定位\n- 类型：BL');
    const r = await scanImportCandidates(vault);
    expect(r.status).toBe('ready');
    const kinds = Object.fromEntries(r.candidates.map(c => [c.relativePath, c.kind]));
    expect(kinds['人物/沈屿.md']).toBe('character');
    expect(kinds['世界观/主要场景.md']).toBe('world');
    expect(kinds['分卷大纲/卷一大纲.md']).toBe('outline');
  });

  it('卷内阶段文件进候选（stage 槽位），分卷总览仍不作为卷候选', async () => {
    await write('分卷大纲/卷一/阶段1-订婚.md', '# 阶段1：订婚（第1—15章）\n## 这一阶段做什么\n推进。');
    await write('小说大纲_分卷大纲.md', '# 分卷大纲\n## 卷 1\n- 核心冲突：x');
    await write('我有一个妹妹_大纲_卷1.md', '# 卷 1 霍昭线（第 1-50 章）\n## 核心冲突\nx');
    const r = await scanImportCandidates(vault);
    const stage = r.candidates.find(c => c.relativePath === '分卷大纲/卷一/阶段1-订婚.md');
    expect(stage).toBeTruthy();
    expect(stage?.slots).toEqual(['stage']);
    expect(stage?.drafts.stages).toHaveLength(1);
    expect(r.candidates.map(c => c.relativePath)).not.toContain('小说大纲_分卷大纲.md');
    expect(r.candidates.map(c => c.relativePath)).toContain('我有一个妹妹_大纲_卷1.md');
  });

  it('阶段候选按目录预填默认卷归属（卷一=0）', async () => {
    await write('分卷大纲/卷一/阶段1-订婚.md', '# 阶段1：订婚（第1—15章）\n## 这一阶段做什么\n推进。');
    const r = await scanImportCandidates(vault);
    const stage = r.candidates.find(c => c.relativePath === '分卷大纲/卷一/阶段1-订婚.md');
    expect(stage?.drafts.stages[0].volumeIndex).toBe(0);
  });

  it('文件名中间含「阶段N」的备忘文件不判 stage（仍进候选，非 stage）', async () => {
    await write('分卷大纲/卷一/备忘-阶段1讨论.md', '# 备忘\n## 讨论\n阶段1 的讨论稿');
    const r = await scanImportCandidates(vault);
    const memo = r.candidates.find(c => c.relativePath === '分卷大纲/卷一/备忘-阶段1讨论.md');
    expect(memo).toBeTruthy();
    expect(memo?.slots).not.toContain('stage');
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

  it('identifySlots：阶段文件返回 stage，大纲_卷N 仍判卷，分卷总览空槽位', () => {
    expect(identifySlots('分卷大纲/卷一/阶段1.md', {}).slots).toEqual(['stage']);
    expect(identifySlots('小说大纲_分卷大纲.md', {}).slots).toEqual([]);
    expect(identifySlots('我有一个妹妹_大纲_卷1.md', {}).slots).toEqual(['volume']);
  });

  it('identifySlots：阶段文件即使显式 role:volume 仍为 stage', () => {
    expect(identifySlots('分卷大纲/卷一/阶段1.md', { role: 'volume' }).slots).toEqual(['stage']);
  });

  it('isOutlineAuxiliary：仅分卷总览为 true，阶段文件与真卷文件为 false', () => {
    expect(isOutlineAuxiliary('分卷大纲/卷一/阶段1-订婚.md')).toBe(false);
    expect(isOutlineAuxiliary('小说大纲_分卷大纲.md')).toBe(true);
    expect(isOutlineAuxiliary('分卷大纲/卷一大纲.md')).toBe(false);
    expect(isOutlineAuxiliary('我有一个妹妹_大纲_卷1.md')).toBe(false);
  });

  it('volumeDirToIndex：中文卷与阿拉伯卷号均预填，对不上返回 null', () => {
    expect(volumeDirToIndex('卷一')).toBe(0);
    expect(volumeDirToIndex('卷二')).toBe(1);
    expect(volumeDirToIndex('第3卷')).toBe(2);
    expect(volumeDirToIndex('卷1')).toBe(0);
    expect(volumeDirToIndex('资料')).toBeNull();
    expect(volumeDirToIndex('')).toBeNull();
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
