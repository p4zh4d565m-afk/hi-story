import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { ObsidianImportRepo } from '../../../src/main/db/repositories/obsidian-import.repo';
import { runMigrations } from '../../../src/main/db/migrations';

describe('Obsidian 导入：阶段归堆（stage 落库）', () => {
  let db: Database.Database; let vault: string;
  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    db.prepare("INSERT INTO projects (id, name, created_at, updated_at) VALUES ('p1', '测试项目', 't', 't')").run();
    vault = await mkdtemp(path.join(tmpdir(), 'hi-story-import-stage-'));
  });
  afterEach(async () => { db.close(); await rm(vault, { recursive: true, force: true }); });

  const write = async (p: string, c: string) => { const f = path.join(vault, p); await mkdir(path.dirname(f), { recursive: true }); await writeFile(f, c); };
  const setPath = () => db.prepare('UPDATE projects SET obsidian_path = ? WHERE id = ?').run(vault, 'p1');

  const seedVolumes = (volumes: unknown[]) => {
    db.prepare(`INSERT INTO planning_ideas (id, project_id, generated_options, selected_option, status, master_outline, outline_status, volume_outlines, volume_status, chapter_outlines, chapter_outline_status)
      VALUES ('pl1','p1','[{"title":"旧","logline":"","targetReader":"","corePromise":"","protagonist":"","centralConflict":"","differentiator":"","endingDirection":""}]',0,'confirmed','{"premise":"旧"}','generated',?,'generated','[]','empty')`).run(JSON.stringify(volumes));
  };

  const stageSel = async (repo: ObsidianImportRepo) => {
    const prep = await repo.prepare('p1');
    const cand = prep.data!.candidates.find((c: any) => c.slots.includes('stage'))!;
    return { relativePath: cand.relativePath, hash: cand.hash, slots: cand.slots, defaultVolumeIndex: cand.drafts.stages[0]?.volumeIndex ?? null, characterOverrides: [], worldOverrides: [] };
  };

  it('keep 分卷 + 只勾阶段：写库对应卷 stages，touchesPlanning 为真', async () => {
    seedVolumes([{ title: '数据库卷A', chapterRange: '第 1-10 章' }, { title: '数据库卷B', chapterRange: '第 11-20 章' }]);
    await write('分卷大纲/卷一/阶段1.md', '# 阶段1：订婚（第1—5章）\n## 这一阶段做什么\n推进。\n## 关键推进\n- a\n## 主要人物\n- b\n## 调用的世界观\n- c\n## 阶段出口\n出口');
    const repo = new ObsidianImportRepo(db);
    setPath();
    const sel = await stageSel(repo);
    expect(sel.defaultVolumeIndex).toBe(0);
    const res = await repo.commit({
      projectId: 'p1', operationId: 'op', selections: [sel],
      layerChoices: { master: { action: 'keep', unlockLocked: false }, volumes: { action: 'keep', unlockLocked: false }, chapters: { action: 'keep', unlockLocked: false } },
    });
    expect(res.success).toBe(true);
    const row = db.prepare('SELECT volume_outlines FROM planning_ideas WHERE id = ?').get('pl1') as any;
    const parsed = JSON.parse(row.volume_outlines);
    expect(parsed[0].stages).toHaveLength(1);
    expect(parsed[0].stages[0].title).toBe('订婚');
    expect(parsed[1].stages ?? []).toEqual([]); // 空桶保留空
  });

  it('卷层 fill + 未勾阶段：不擦除已有 stages', async () => {
    const existing = [{ title: '数据库卷A', chapterRange: '第 1-10 章', stages: [{ title: '已有阶段', chapterRange: '', goal: '', keyProgressions: [], characters: [], worldRefs: [], exit: '', endingHook: '' }] }];
    seedVolumes(existing);
    await write('大纲_卷1.md', '# 卷 1 开端（第 1-10 章）\n## 本卷目标\n开端'); // 来源卷，无 stages
    const repo = new ObsidianImportRepo(db);
    setPath();
    const prep = await repo.prepare('p1');
    const volCand = prep.data!.candidates.find((c: any) => c.slots.includes('volume'))!;
    const res = await repo.commit({
      projectId: 'p1', operationId: 'op', selections: [
        { relativePath: volCand.relativePath, hash: volCand.hash, slots: volCand.slots, defaultVolumeIndex: null, characterOverrides: [], worldOverrides: [] },
      ],
      layerChoices: { master: { action: 'keep', unlockLocked: false }, volumes: { action: 'fill', unlockLocked: false }, chapters: { action: 'keep', unlockLocked: false } },
    });
    expect(res.success).toBe(true);
    const row = db.prepare('SELECT volume_outlines FROM planning_ideas WHERE id = ?').get('pl1') as any;
    const parsed = JSON.parse(row.volume_outlines);
    expect(parsed[0].stages).toHaveLength(1);
    expect(parsed[0].stages[0].title).toBe('已有阶段');
  });

  it('卷层 clear + 勾阶段：拦截', async () => {
    seedVolumes([{ title: '数据库卷A', chapterRange: '第 1-10 章' }]);
    await write('分卷大纲/卷一/阶段1.md', '# 阶段1：订婚（第1—5章）\n## 这一阶段做什么\n推进');
    const repo = new ObsidianImportRepo(db);
    setPath();
    const sel = await stageSel(repo);
    const res = await repo.commit({
      projectId: 'p1', operationId: 'op', selections: [sel],
      layerChoices: { master: { action: 'keep', unlockLocked: false }, volumes: { action: 'clear', unlockLocked: true }, chapters: { action: 'keep', unlockLocked: false } },
    });
    expect(res.success).toBe(false);
    expect(res.error).toContain('阶段');
  });

  it('分卷纲已锁定且未解锁 + 勾阶段：拦截', async () => {
    // volume_status = locked
    db.prepare(`INSERT INTO planning_ideas (id, project_id, generated_options, selected_option, status, master_outline, outline_status, volume_outlines, volume_status, chapter_outlines, chapter_outline_status)
      VALUES ('pl1','p1','[{"title":"旧","logline":"","targetReader":"","corePromise":"","protagonist":"","centralConflict":"","differentiator":"","endingDirection":""}]',0,'confirmed','{"premise":"旧"}','locked','[{"title":"数据库卷A","chapterRange":"第 1-10 章"}]','locked','[]','empty')`).run();
    await write('分卷大纲/卷一/阶段1.md', '# 阶段1：订婚（第1—5章）\n## 这一阶段做什么\n推进');
    const repo = new ObsidianImportRepo(db);
    setPath();
    const sel = await stageSel(repo);
    const res = await repo.commit({
      projectId: 'p1', operationId: 'op', selections: [sel],
      layerChoices: { master: { action: 'keep', unlockLocked: false }, volumes: { action: 'keep', unlockLocked: false }, chapters: { action: 'keep', unlockLocked: false } },
    });
    expect(res.success).toBe(false);
    expect(res.error).toContain('锁定');
  });

  it('部分勾选阶段：整组替换该卷 stages（不 merge）', async () => {
    const existing = [{
      title: '数据库卷A', chapterRange: '第 1-10 章',
      stages: [
        { title: '旧1', chapterRange: '', goal: '', keyProgressions: [], characters: [], worldRefs: [], exit: '', endingHook: '' },
        { title: '旧2', chapterRange: '', goal: '', keyProgressions: [], characters: [], worldRefs: [], exit: '', endingHook: '' },
      ],
    }];
    seedVolumes(existing);
    await write('分卷大纲/卷一/阶段1.md', '# 阶段1：订婚（第1—5章）\n## 这一阶段做什么\n推进');
    const repo = new ObsidianImportRepo(db);
    setPath();
    const sel = await stageSel(repo);
    const res = await repo.commit({
      projectId: 'p1', operationId: 'op', selections: [sel],
      layerChoices: { master: { action: 'keep', unlockLocked: false }, volumes: { action: 'keep', unlockLocked: false }, chapters: { action: 'keep', unlockLocked: false } },
    });
    expect(res.success).toBe(true);
    const row = db.prepare('SELECT volume_outlines FROM planning_ideas WHERE id = ?').get('pl1') as any;
    const parsed = JSON.parse(row.volume_outlines);
    expect(parsed[0].stages).toHaveLength(1); // 整组替换，非 3
    expect(parsed[0].stages[0].title).toBe('订婚');
  });

  it('卷层 replace + 未勾阶段：不擦除已有 stages', async () => {
    const existing = [{
      title: '数据库卷A', chapterRange: '第 1-10 章',
      stages: [
        { title: '已有阶段', chapterRange: '', goal: '', keyProgressions: [], characters: [], worldRefs: [], exit: '', endingHook: '' },
      ],
    }];
    seedVolumes(existing);
    await write('大纲_卷1.md', '# 卷 1 开端（第 1-10 章）\n## 本卷目标\n开端'); // 来源卷，无 stages
    const repo = new ObsidianImportRepo(db);
    setPath();
    const prep = await repo.prepare('p1');
    const volCand = prep.data!.candidates.find((c: any) => c.slots.includes('volume'))!;
    const res = await repo.commit({
      projectId: 'p1', operationId: 'op', selections: [
        { relativePath: volCand.relativePath, hash: volCand.hash, slots: volCand.slots, defaultVolumeIndex: null, characterOverrides: [], worldOverrides: [] },
      ],
      layerChoices: { master: { action: 'keep', unlockLocked: false }, volumes: { action: 'replace', unlockLocked: true }, chapters: { action: 'keep', unlockLocked: false } },
    });
    expect(res.success).toBe(true);
    const row = db.prepare('SELECT volume_outlines FROM planning_ideas WHERE id = ?').get('pl1') as any;
    const parsed = JSON.parse(row.volume_outlines);
    expect(parsed[0].stages).toHaveLength(1); // replace 未勾阶段仍保留已有 stages
    expect(parsed[0].stages[0].title).toBe('已有阶段');
    expect(parsed[0].title).toBe('卷 1 开端'); // 卷字段本身已被 replace 成来源卷
  });
});
