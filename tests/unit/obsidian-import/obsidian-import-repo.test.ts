import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { ObsidianImportRepo } from '../../../src/main/db/repositories/obsidian-import.repo';
import { runMigrations } from '../../../src/main/db/migrations';

describe('Obsidian 导入事务', () => {
  let db: Database.Database; let vault: string;
  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    db.prepare("INSERT INTO projects (id, name, created_at, updated_at) VALUES ('p1', '测试项目', 't', 't')").run();
    vault = await mkdtemp(path.join(tmpdir(), 'hi-story-import-repo-'));
  });
  afterEach(async () => { db.close(); await rm(vault, { recursive: true, force: true }); });

  const write = async (p: string, c: string) => { const f = path.join(vault, p); await mkdir(path.dirname(f), { recursive: true }); await writeFile(f, c); };
  const setPath = () => db.prepare('UPDATE projects SET obsidian_path = ? WHERE id = ?').run(vault, 'p1');

  const selectFrom = (repo: ObsidianImportRepo, prep: any, slot: string) => {
    const cand = prep.candidates.find((c: any) => c.slots.includes(slot))!;
    return { relativePath: cand.relativePath, hash: cand.hash, slots: cand.slots, drafts: cand.drafts };
  };

  it('导入总纲创建 Obsidian 导入方案，三处同步写', async () => {
    await write('完整大纲.md', '# 完整大纲\n## 一、作品定位\n- 类型：BL\n- 结局：开放式结局\n## 二、三卷大纲索引\n1. [卷 1 陆昭线（第 1-50 章）](卷1.md)');
    const repo = new ObsidianImportRepo(db);
    setPath();
    const prep = await repo.prepare('p1');
    expect(prep.success).toBe(true);
    const sel = selectFrom(repo, prep.data, 'master');
    const commitRes = await repo.commit({
      projectId: 'p1', operationId: 'op-1', selections: [sel],
      layerChoices: {
        master: { action: 'fill', unlockLocked: false },
        volumes: { action: 'keep', unlockLocked: false },
        chapters: { action: 'keep', unlockLocked: false },
      },
    });
    expect(commitRes.success).toBe(true);
    const row = db.prepare('SELECT * FROM planning_ideas WHERE project_id = ?').get('p1') as any;
    expect(JSON.parse(row.generated_options)).toHaveLength(1);
    expect(row.selected_option).toBe(0);
    expect(row.status).toBe('confirmed');
    expect(JSON.parse(row.master_outline).ending).toBe('开放式结局');
  });

  it('缺少上游依赖的章纲导入被拒绝', async () => {
    await write('章节细纲.md', '## 卷 1（第 1-50 章）\n\n| 章 | 标题 | 核心事件 |\n|---|---|---|\n| 1 | 初见 | 宴会。 |');
    const repo = new ObsidianImportRepo(db);
    setPath();
    const prep = await repo.prepare('p1');
    const sel = selectFrom(repo, prep.data, 'chapter');
    const commitRes = await repo.commit({
      projectId: 'p1', operationId: 'op-2', selections: [sel],
      layerChoices: {
        master: { action: 'keep', unlockLocked: false },
        volumes: { action: 'keep', unlockLocked: false },
        chapters: { action: 'fill', unlockLocked: false },
      },
    });
    expect(commitRes.success).toBe(false);
    expect(commitRes.error).toContain('分卷纲');
    expect(db.prepare('SELECT COUNT(*) AS n FROM planning_ideas').get()).toEqual({ n: 0 });
  });

  it('覆盖同名人物保留 profileOutline 与 id', async () => {
    db.prepare("INSERT INTO characters (id, project_id, name, profile_outline, sort_order, created_at, updated_at) VALUES ('c1','p1','沈屿','[{\"id\":\"a\"}]',0,'t','t')").run();
    await write('人物/沈屿.md', '# 沈屿\n## 性格层次\n- 表面：高智商。');
    const repo = new ObsidianImportRepo(db);
    setPath();
    const prep = await repo.prepare('p1');
    const sel = selectFrom(repo, prep.data, 'character');
    sel.drafts.characters[0].overwrite = true;
    const commitRes = await repo.commit({
      projectId: 'p1', operationId: 'op-3', selections: [sel],
      layerChoices: {
        master: { action: 'keep', unlockLocked: false },
        volumes: { action: 'keep', unlockLocked: false },
        chapters: { action: 'keep', unlockLocked: false },
      },
    });
    expect(commitRes.success).toBe(true);
    const row = db.prepare("SELECT * FROM characters WHERE name = '沈屿'").get() as any;
    expect(row.id).toBe('c1');
    expect(row.profile_outline).toBe('[{"id":"a"}]');
    expect(row.personality).toContain('高智商');
  });

  it('项目存在多条策划记录时，策划导入被拒绝（A1），但人物导入不受影响', async () => {
    db.prepare("INSERT INTO planning_ideas (id, project_id) VALUES ('pl1','p1')").run();
    db.prepare("INSERT INTO planning_ideas (id, project_id) VALUES ('pl2','p1')").run();
    await write('完整大纲.md', '# 完整大纲\n## 一、作品定位\n- 类型：BL');
    await write('人物/沈屿.md', '# 沈屿\n## 性格层次\n- 表面：高智商。');
    const repo = new ObsidianImportRepo(db);
    setPath();
    const prep = await repo.prepare('p1');
    expect(prep.data!.target.planningRecordCount).toBe(2);

    const masterSel = selectFrom(repo, prep.data, 'master');
    const masterCommit = await repo.commit({
      projectId: 'p1', operationId: 'op-m', selections: [masterSel],
      layerChoices: {
        master: { action: 'fill', unlockLocked: false },
        volumes: { action: 'keep', unlockLocked: false },
        chapters: { action: 'keep', unlockLocked: false },
      },
    });
    expect(masterCommit.success).toBe(false);
    expect(masterCommit.error).toContain('多条');

    const charSel = selectFrom(repo, prep.data, 'character');
    const charCommit = await repo.commit({
      projectId: 'p1', operationId: 'op-c', selections: [charSel],
      layerChoices: {
        master: { action: 'keep', unlockLocked: false },
        volumes: { action: 'keep', unlockLocked: false },
        chapters: { action: 'keep', unlockLocked: false },
      },
    });
    expect(charCommit.success).toBe(true);
    expect(db.prepare("SELECT COUNT(*) AS n FROM characters WHERE name = '沈屿'").get()).toEqual({ n: 1 });
  });
});
