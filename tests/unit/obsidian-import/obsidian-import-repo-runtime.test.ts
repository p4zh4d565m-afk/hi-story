import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { ObsidianImportRepo } from '../../../src/main/db/repositories/obsidian-import.repo';
import { runMigrations } from '../../../src/main/db/migrations';

describe('Obsidian 导入仓储：运行时 DTO / blocking / 名称冲突 / 卷去重', () => {
  let db: Database.Database; let vault: string;
  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    db.prepare("INSERT INTO projects (id, name, created_at, updated_at) VALUES ('p1', '测试项目', 't', 't')").run();
    vault = await mkdtemp(path.join(tmpdir(), 'hi-story-import-repo3-'));
  });
  afterEach(async () => { db.close(); await rm(vault, { recursive: true, force: true }); });

  const write = async (p: string, c: string) => { const f = path.join(vault, p); await mkdir(path.dirname(f), { recursive: true }); await writeFile(f, c); };
  const setPath = () => db.prepare('UPDATE projects SET obsidian_path = ? WHERE id = ?').run(vault, 'p1');

  const selOf = (cand: any, overrides: any = {}) => ({
    relativePath: cand.relativePath, hash: cand.hash, slots: cand.slots, defaultVolumeIndex: null,
    characterOverrides: overrides.characterOverrides ?? [],
    worldOverrides: overrides.worldOverrides ?? [],
  });

  it('运行时 DTO：selections 非数组 / 缺 projectId 被拒绝', async () => {
    const repo = new ObsidianImportRepo(db);
    setPath();
    const bad = await repo.commit({ projectId: '', operationId: 'op', selections: undefined as any, layerChoices: { master: { action: 'keep', unlockLocked: false }, volumes: { action: 'keep', unlockLocked: false }, chapters: { action: 'keep', unlockLocked: false } } });
    expect(bad.success).toBe(false);
  });

  it('blocking issue：无卷归属章纲在 commit 被拒绝', async () => {
    // 一个章纲文件，表格不含卷标题，章节 volumeIndex=null
    await write('章纲.md', '| 章 | 标题 | 核心事件 |\n|---|---|---|\n| 1 | 起点 | 开场。 |');
    const repo = new ObsidianImportRepo(db);
    setPath();
    const prep = await repo.prepare('p1');
    const cand = prep.data!.candidates.find((c: any) => c.slots.includes('chapter'))!;
    expect(cand.drafts.chapters[0].volumeIndex).toBeNull();
    const res = await repo.commit({
      projectId: 'p1', operationId: 'op', selections: [selOf(cand)],
      layerChoices: { master: { action: 'keep', unlockLocked: false }, volumes: { action: 'keep', unlockLocked: false }, chapters: { action: 'fill', unlockLocked: false } },
    });
    expect(res.success).toBe(false);
    expect(res.error).toContain('卷归属');
  });

  it('最终名称冲突：新建人物与数据库现有记录归一化重名被拒绝', async () => {
    db.prepare("INSERT INTO characters (id, project_id, name) VALUES ('c1','p1','沈屿')").run();
    await write('人物/沈屿2.md', '# 沈屿2\n## 性格层次\n- 表面：高智商。');
    // 文件 sourceName 是「沈屿2」，但作者把导入名改成「沈屿」，与现有记录重名
    const repo = new ObsidianImportRepo(db);
    setPath();
    const prep = await repo.prepare('p1');
    const cand = prep.data!.candidates.find((c: any) => c.slots.includes('character'))!;
    const res = await repo.commit({
      projectId: 'p1', operationId: 'op', selections: [selOf(cand, { characterOverrides: [{ sourceName: cand.drafts.characters[0].sourceName, name: '沈屿', overwrite: false }] })],
      layerChoices: { master: { action: 'keep', unlockLocked: false }, volumes: { action: 'keep', unlockLocked: false }, chapters: { action: 'keep', unlockLocked: false } },
    });
    expect(res.success).toBe(false);
    expect(res.error).toContain('重名');
  });

  it('卷双重去重：两个卷标题不同但 chapterRange 相同被拒绝', async () => {
    await write('大纲_卷1.md', '# 卷 1 开端（第 1-10 章）\n## 本卷目标\n开端');
    await write('大纲_卷2.md', '# 卷 2 续篇（第 1-10 章）\n## 本卷目标\n续篇');
    const repo = new ObsidianImportRepo(db);
    setPath();
    const prep = await repo.prepare('p1');
    const cands = prep.data!.candidates.filter((c: any) => c.slots.includes('volume'));
    expect(cands.length).toBe(2);
    const res = await repo.commit({
      projectId: 'p1', operationId: 'op',
      selections: cands.map((c: any) => ({ relativePath: c.relativePath, hash: c.hash, slots: c.slots, defaultVolumeIndex: null, characterOverrides: [], worldOverrides: [] })),
      layerChoices: { master: { action: 'keep', unlockLocked: false }, volumes: { action: 'fill', unlockLocked: false }, chapters: { action: 'keep', unlockLocked: false } },
    });
    // 两个卷 chapterRange 都是「第 1-10 章」，应拒绝（即使标题不同）
    expect(res.success).toBe(false);
    expect(res.error).toContain('重复卷');
  });
});
