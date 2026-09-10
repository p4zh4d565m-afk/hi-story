import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { ObsidianImportRepo } from '../../../src/main/db/repositories/obsidian-import.repo';
import { runMigrations } from '../../../src/main/db/migrations';

describe('Obsidian 导入：最终实体名称冲突（R2）', () => {
  let db: Database.Database; let vault: string;
  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    db.prepare("INSERT INTO projects (id, name, created_at, updated_at) VALUES ('p1', '测试项目', 't', 't')").run();
    vault = await mkdtemp(path.join(tmpdir(), 'hi-story-import-conflict-'));
  });
  afterEach(async () => { db.close(); await rm(vault, { recursive: true, force: true }); });

  const write = async (p: string, c: string) => { const f = path.join(vault, p); await mkdir(path.dirname(f), { recursive: true }); await writeFile(f, c); };
  const setPath = () => db.prepare('UPDATE projects SET obsidian_path = ? WHERE id = ?').run(vault, 'p1');

  const keepChoices = () => ({ master: { action: 'keep' as const, unlockLocked: false }, volumes: { action: 'keep' as const, unlockLocked: false }, chapters: { action: 'keep' as const, unlockLocked: false } });

  /** 找某槽位候选，构 selection；可按 index 顺序返回多个。 */
  const candidatesOf = async (repo: ObsidianImportRepo, slot: string) => {
    const prep = await repo.prepare('p1');
    return prep.data!.candidates.filter((c: any) => c.slots.includes(slot));
  };
  const selOf = (cand: any, overrides: any = {}) => ({
    relativePath: cand.relativePath, hash: cand.hash, slots: cand.slots, defaultVolumeIndex: null,
    characterOverrides: overrides.characterOverrides ?? [],
    worldOverrides: overrides.worldOverrides ?? [],
  });

  it('两个不同来源人物改成同一最终名称，事务零写入', async () => {
    await write('人物/甲.md', '# 甲\n## 性格层次\n- 表面：冷静。');
    await write('人物/乙.md', '# 乙\n## 性格层次\n- 表面：热情。');
    const repo = new ObsidianImportRepo(db);
    setPath();
    const chars = await candidatesOf(repo, 'character');
    expect(chars.length).toBe(2);
    const res = await repo.commit({
      projectId: 'p1', operationId: 'op', selections: [
        selOf(chars[0], { characterOverrides: [{ sourceName: chars[0].drafts.characters[0].sourceName, name: '沈屿', overwrite: false }] }),
        selOf(chars[1], { characterOverrides: [{ sourceName: chars[1].drafts.characters[0].sourceName, name: '沈屿', overwrite: false }] }),
      ],
      layerChoices: keepChoices(),
    });
    expect(res.success).toBe(false);
    expect(res.error).toContain('重名');
    expect(db.prepare('SELECT COUNT(*) AS n FROM characters').get()).toEqual({ n: 0 });
  });

  it('两个不同来源世界观改成同一最终名称，事务零写入', async () => {
    await write('世界观/甲.md', '# 甲\n描述甲');
    await write('世界观/乙.md', '# 乙\n描述乙');
    const repo = new ObsidianImportRepo(db);
    setPath();
    const worlds = await candidatesOf(repo, 'world');
    expect(worlds.length).toBe(2);
    const res = await repo.commit({
      projectId: 'p1', operationId: 'op', selections: [
        selOf(worlds[0], { worldOverrides: [{ sourceName: worlds[0].drafts.worlds[0].sourceName, name: '星海', category: 'place', overwrite: false }] }),
        selOf(worlds[1], { worldOverrides: [{ sourceName: worlds[1].drafts.worlds[0].sourceName, name: '星海', category: 'place', overwrite: false }] }),
      ],
      layerChoices: keepChoices(),
    });
    expect(res.success).toBe(false);
    expect(res.error).toContain('重名');
    expect(db.prepare('SELECT COUNT(*) AS n FROM world_entries').get()).toEqual({ n: 0 });
  });

  it('已有 A、B，覆盖 A 并改名为 B，失败且 A、B 均不变', async () => {
    db.prepare("INSERT INTO characters (id, project_id, name) VALUES ('c1','p1','沈屿')").run();
    db.prepare("INSERT INTO characters (id, project_id, name) VALUES ('c2','p1','林晚')").run();
    await write('人物/沈屿.md', '# 沈屿\n## 性格层次\n- 表面：高智商。');
    const repo = new ObsidianImportRepo(db);
    setPath();
    const chars = await candidatesOf(repo, 'character');
    const res = await repo.commit({
      projectId: 'p1', operationId: 'op', selections: [
        selOf(chars[0], { characterOverrides: [{ sourceName: '沈屿', name: '林晚', overwrite: true }] }),
      ],
      layerChoices: keepChoices(),
    });
    expect(res.success).toBe(false);
    expect(res.error).toContain('重名');
    // A、B 均不变：沈屿仍是 c1，林晚仍是 c2
    expect(db.prepare("SELECT name FROM characters WHERE id = 'c1'").get()).toEqual({ name: '沈屿' });
    expect(db.prepare("SELECT name FROM characters WHERE id = 'c2'").get()).toEqual({ name: '林晚' });
  });

  it('overwrite=false 的已有来源为 skip，不因未写入的编辑名产生假冲突', async () => {
    db.prepare("INSERT INTO characters (id, project_id, name) VALUES ('c1','p1','沈屿')").run();
    await write('人物/沈屿.md', '# 沈屿\n## 性格层次\n- 表面：高智商。');
    const repo = new ObsidianImportRepo(db);
    setPath();
    const chars = await candidatesOf(repo, 'character');
    const res = await repo.commit({
      projectId: 'p1', operationId: 'op', selections: [
        // 编辑名改成了别的，但 overwrite=false → skip，不应冲突
        selOf(chars[0], { characterOverrides: [{ sourceName: '沈屿', name: '随便改个名', overwrite: false }] }),
      ],
      layerChoices: keepChoices(),
    });
    expect(res.success).toBe(true);
    expect(db.prepare("SELECT name FROM characters WHERE id = 'c1'").get()).toEqual({ name: '沈屿' });
  });

  it('空白变体：最终名称与现有记录仅首尾空白不同仍冲突', async () => {
    db.prepare("INSERT INTO characters (id, project_id, name) VALUES ('c1','p1','沈屿')").run();
    await write('人物/甲.md', '# 甲\n## 性格层次\n- 表面：冷静。');
    const repo = new ObsidianImportRepo(db);
    setPath();
    const chars = await candidatesOf(repo, 'character');
    const res = await repo.commit({
      projectId: 'p1', operationId: 'op', selections: [
        selOf(chars[0], { characterOverrides: [{ sourceName: '甲', name: ' 沈屿 ', overwrite: false }] }),
      ],
      layerChoices: keepChoices(),
    });
    expect(res.success).toBe(false);
    expect(res.error).toContain('重名');
  });

  it('大小写变体：最终名称仅大小写不同仍冲突', async () => {
    db.prepare("INSERT INTO characters (id, project_id, name) VALUES ('c1','p1','Lin')").run();
    await write('人物/甲.md', '# 甲\n## 性格层次\n- 表面：冷静。');
    const repo = new ObsidianImportRepo(db);
    setPath();
    const chars = await candidatesOf(repo, 'character');
    const res = await repo.commit({
      projectId: 'p1', operationId: 'op', selections: [
        selOf(chars[0], { characterOverrides: [{ sourceName: '甲', name: 'lin', overwrite: false }] }),
      ],
      layerChoices: keepChoices(),
    });
    expect(res.success).toBe(false);
    expect(res.error).toContain('重名');
  });

  it('NFKC 变体：全角字母与半角字母归一化后冲突', async () => {
    db.prepare("INSERT INTO characters (id, project_id, name) VALUES ('c1','p1','ABC')").run();
    await write('人物/甲.md', '# 甲\n## 性格层次\n- 表面：冷静。');
    const repo = new ObsidianImportRepo(db);
    setPath();
    const chars = await candidatesOf(repo, 'character');
    const res = await repo.commit({
      projectId: 'p1', operationId: 'op', selections: [
        selOf(chars[0], { characterOverrides: [{ sourceName: '甲', name: 'ＡＢＣ', overwrite: false }] }),
      ],
      layerChoices: keepChoices(),
    });
    expect(res.success).toBe(false);
    expect(res.error).toContain('重名');
  });
});
