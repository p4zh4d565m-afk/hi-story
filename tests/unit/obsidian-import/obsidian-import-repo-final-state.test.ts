import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { ObsidianImportRepo } from '../../../src/main/db/repositories/obsidian-import.repo';
import { runMigrations } from '../../../src/main/db/migrations';

describe('Obsidian 导入仓储：锁定语义与最终状态', () => {
  let db: Database.Database; let vault: string;
  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    db.prepare("INSERT INTO projects (id, name, created_at, updated_at) VALUES ('p1', '测试项目', 't', 't')").run();
    vault = await mkdtemp(path.join(tmpdir(), 'hi-story-import-repo2-'));
  });
  afterEach(async () => { db.close(); await rm(vault, { recursive: true, force: true }); });

  const write = async (p: string, c: string) => { const f = path.join(vault, p); await mkdir(path.dirname(f), { recursive: true }); await writeFile(f, c); };
  const setPath = () => db.prepare('UPDATE projects SET obsidian_path = ? WHERE id = ?').run(vault, 'p1');

  // 预置一条已锁定总纲 + 分卷纲的策划记录
  const seedLockedPlanning = () => {
    db.prepare(`INSERT INTO planning_ideas (id, project_id, generated_options, selected_option, status, master_outline, outline_status, volume_outlines, volume_status, chapter_outlines, chapter_outline_status)
      VALUES ('pl1','p1','[{"title":"旧","logline":"","targetReader":"","corePromise":"","protagonist":"","centralConflict":"","differentiator":"","endingDirection":""}]',0,'confirmed','{"premise":"旧前提"}','locked','[{"title":"旧卷"}]','locked','[]','empty')`).run();
  };

  const masterSelection = async (repo: ObsidianImportRepo) => {
    const prep = await repo.prepare('p1');
    const cand = prep.data!.candidates.find((c: any) => c.slots.includes('master'))!;
    return { relativePath: cand.relativePath, hash: cand.hash, slots: cand.slots, defaultVolumeIndex: null, characterOverrides: [], worldOverrides: [] };
  };

  it('锁定总纲 replace 未确认解锁时失败', async () => {
    await write('完整大纲.md', '# 完整大纲\n## 一、作品定位\n- 类型：BL');
    seedLockedPlanning();
    const repo = new ObsidianImportRepo(db);
    setPath();
    const sel = await masterSelection(repo);
    const res = await repo.commit({
      projectId: 'p1', operationId: 'op', selections: [sel],
      layerChoices: {
        master: { action: 'replace', unlockLocked: false },
        volumes: { action: 'clear', unlockLocked: true },
        chapters: { action: 'keep', unlockLocked: false },
      },
    });
    expect(res.success).toBe(false);
    expect(res.error).toContain('锁定');
  });

  it('锁定总纲 replace 确认解锁后成功', async () => {
    await write('完整大纲.md', '# 完整大纲\n## 一、作品定位\n- 类型：BL');
    seedLockedPlanning();
    const repo = new ObsidianImportRepo(db);
    setPath();
    const sel = await masterSelection(repo);
    const res = await repo.commit({
      projectId: 'p1', operationId: 'op', selections: [sel],
      layerChoices: {
        master: { action: 'replace', unlockLocked: true },
        volumes: { action: 'clear', unlockLocked: true },
        chapters: { action: 'keep', unlockLocked: false },
      },
    });
    expect(res.success).toBe(true);
    const row = db.prepare('SELECT * FROM planning_ideas WHERE id = ?').get('pl1') as any;
    expect(row.outline_status).toBe('generated');
    expect(JSON.parse(row.master_outline).premise).not.toBe('旧前提');
  });

  it('清空总纲但保留已有分卷纲被拒绝', async () => {
    seedLockedPlanning();
    const repo = new ObsidianImportRepo(db);
    setPath();
    // 无策划来源文件，仅 clear 总纲，分卷保持 keep
    const res = await repo.commit({
      projectId: 'p1', operationId: 'op', selections: [],
      layerChoices: {
        master: { action: 'clear', unlockLocked: true },
        volumes: { action: 'keep', unlockLocked: false },
        chapters: { action: 'keep', unlockLocked: false },
      },
    });
    expect(res.success).toBe(false);
    expect(res.error).toContain('分卷纲');
  });

  it('clear-only 无来源文件也能清空目标层（总纲+分卷一起清空）', async () => {
    seedLockedPlanning();
    const repo = new ObsidianImportRepo(db);
    setPath();
    const res = await repo.commit({
      projectId: 'p1', operationId: 'op', selections: [],
      layerChoices: {
        master: { action: 'clear', unlockLocked: true },
        volumes: { action: 'clear', unlockLocked: true },
        chapters: { action: 'keep', unlockLocked: false },
      },
    });
    expect(res.success).toBe(true);
    const row = db.prepare('SELECT * FROM planning_ideas WHERE id = ?').get('pl1') as any;
    expect(row.outline_status).toBe('empty');
    expect(row.volume_status).toBe('empty');
  });

  it('来源无内容时 replace 被拒绝', async () => {
    // 没有写任何 master 文件，selections 里也没有 master 槽位来源
    seedLockedPlanning();
    const repo = new ObsidianImportRepo(db);
    setPath();
    const res = await repo.commit({
      projectId: 'p1', operationId: 'op', selections: [],
      layerChoices: {
        master: { action: 'replace', unlockLocked: true },
        volumes: { action: 'clear', unlockLocked: true },
        chapters: { action: 'keep', unlockLocked: false },
      },
    });
    expect(res.success).toBe(false);
    expect(res.error).toContain('没有');
  });

  it('渲染端伪造 drafts 不再影响写入结果（selection 已不含 drafts 字段）', async () => {
    await write('完整大纲.md', '# 完整大纲\n## 一、作品定位\n- 类型：BL\n- 结局：开放式结局');
    const repo = new ObsidianImportRepo(db);
    setPath();
    const prep = await repo.prepare('p1');
    const cand = prep.data!.candidates.find((c: any) => c.slots.includes('master'))!;
    // 伪造：即使塞了 drafts，主进程也忽略它，重新解析真实文件
    const sel = { relativePath: cand.relativePath, hash: cand.hash, slots: cand.slots, defaultVolumeIndex: null, characterOverrides: [], worldOverrides: [], drafts: { master: { premise: '伪造内容' }, volumes: [], chapters: [], characters: [], worlds: [] } } as any;
    const res = await repo.commit({
      projectId: 'p1', operationId: 'op', selections: [sel],
      layerChoices: {
        master: { action: 'replace', unlockLocked: false },
        volumes: { action: 'keep', unlockLocked: false },
        chapters: { action: 'keep', unlockLocked: false },
      },
    });
    expect(res.success).toBe(true);
    const row = db.prepare('SELECT * FROM planning_ideas WHERE project_id = ?').get('p1') as any;
    expect(JSON.parse(row.master_outline).premise).not.toBe('伪造内容');
    expect(JSON.parse(row.master_outline).ending).toBe('开放式结局');
  });

  it('空名称（人物/世界观）被拒绝', async () => {
    await write('人物/沈屿.md', '# 沈屿\n## 性格层次\n- 表面：高智商。');
    await write('世界观/主要场景.md', '# 主要场景\n## 星海\n- 开场。');
    const repo = new ObsidianImportRepo(db);
    setPath();
    const prep = await repo.prepare('p1');
    const charCand = prep.data!.candidates.find((c: any) => c.slots.includes('character'))!;
    const worldCand = prep.data!.candidates.find((c: any) => c.slots.includes('world'))!;
    const sel = [
      { relativePath: charCand.relativePath, hash: charCand.hash, slots: charCand.slots, defaultVolumeIndex: null, characterOverrides: [{ sourceName: '沈屿', name: '  ', overwrite: false }], worldOverrides: [] },
      { relativePath: worldCand.relativePath, hash: worldCand.hash, slots: worldCand.slots, defaultVolumeIndex: null, characterOverrides: [], worldOverrides: [{ sourceName: '主要场景', name: '', category: 'place', overwrite: false }] },
    ];
    const res = await repo.commit({
      projectId: 'p1', operationId: 'op', selections: sel,
      layerChoices: { master: { action: 'keep', unlockLocked: false }, volumes: { action: 'keep', unlockLocked: false }, chapters: { action: 'keep', unlockLocked: false } },
    });
    expect(res.success).toBe(false);
    expect(res.error).toContain('不能为空');
    expect(db.prepare('SELECT COUNT(*) AS n FROM characters').get()).toEqual({ n: 0 });
  });

  it('override sourceName 不存在于重建草稿时被拒绝', async () => {
    await write('人物/沈屿.md', '# 沈屿\n## 性格层次\n- 表面：高智商。');
    const repo = new ObsidianImportRepo(db);
    setPath();
    const prep = await repo.prepare('p1');
    const charCand = prep.data!.candidates.find((c: any) => c.slots.includes('character'))!;
    const sel = [{ relativePath: charCand.relativePath, hash: charCand.hash, slots: charCand.slots, defaultVolumeIndex: null, characterOverrides: [{ sourceName: '不存在的人', name: '张三', overwrite: false }], worldOverrides: [] }];
    const res = await repo.commit({
      projectId: 'p1', operationId: 'op', selections: sel,
      layerChoices: { master: { action: 'keep', unlockLocked: false }, volumes: { action: 'keep', unlockLocked: false }, chapters: { action: 'keep', unlockLocked: false } },
    });
    expect(res.success).toBe(false);
    expect(res.error).toContain('不存在');
  });

  it('覆盖世界观保留 parentId', async () => {
    db.prepare("INSERT INTO world_entries (id, project_id, parent_id, category, name, description, sort_order, created_at, updated_at) VALUES ('w1','p1',NULL,'place','主要场景','旧',0,'t','t')").run();
    await write('世界观/主要场景.md', '# 主要场景\n## 星海\n- 开场。');
    const repo = new ObsidianImportRepo(db);
    setPath();
    const prep = await repo.prepare('p1');
    const worldCand = prep.data!.candidates.find((c: any) => c.slots.includes('world'))!;
    const sel = [{ relativePath: worldCand.relativePath, hash: worldCand.hash, slots: worldCand.slots, defaultVolumeIndex: null, characterOverrides: [], worldOverrides: [{ sourceName: '主要场景', name: '主要场景', category: 'place', overwrite: true }] }];
    const res = await repo.commit({
      projectId: 'p1', operationId: 'op', selections: sel,
      layerChoices: { master: { action: 'keep', unlockLocked: false }, volumes: { action: 'keep', unlockLocked: false }, chapters: { action: 'keep', unlockLocked: false } },
    });
    expect(res.success).toBe(true);
    const row = db.prepare("SELECT * FROM world_entries WHERE name = '主要场景'").get() as any;
    expect(row.id).toBe('w1');
    expect(row.parent_id).toBeNull();
    expect(row.description).toContain('星海');
  });

  it('keep/fill 保留 locked 状态与值（分卷纲锁定）', async () => {
    db.prepare(`INSERT INTO planning_ideas (id, project_id, generated_options, selected_option, status, master_outline, outline_status, volume_outlines, volume_status, chapter_outlines, chapter_outline_status)
      VALUES ('pl1','p1','[{"title":"旧","logline":"","targetReader":"","corePromise":"","protagonist":"","centralConflict":"","differentiator":"","endingDirection":""}]',0,'confirmed','{"premise":"旧"}','locked','[{"title":"旧卷"}]','locked','[]','empty')`).run();
    const repo = new ObsidianImportRepo(db);
    setPath();
    // 无来源，keep 分卷纲（锁定）
    const res = await repo.commit({
      projectId: 'p1', operationId: 'op', selections: [],
      layerChoices: { master: { action: 'keep', unlockLocked: false }, volumes: { action: 'keep', unlockLocked: false }, chapters: { action: 'keep', unlockLocked: false } },
    });
    expect(res.success).toBe(true);
    const row = db.prepare('SELECT * FROM planning_ideas WHERE id = ?').get('pl1') as any;
    expect(row.volume_status).toBe('locked');
    expect(JSON.parse(row.volume_outlines)[0].title).toBe('旧卷');
  });
});
