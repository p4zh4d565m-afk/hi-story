import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { ObsidianImportRepo } from '../../../src/main/db/repositories/obsidian-import.repo';
import { runMigrations } from '../../../src/main/db/migrations';

describe('Obsidian 导入：最终卷策略边界（R3）', () => {
  let db: Database.Database; let vault: string;
  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    db.prepare("INSERT INTO projects (id, name, created_at, updated_at) VALUES ('p1', '测试项目', 't', 't')").run();
    vault = await mkdtemp(path.join(tmpdir(), 'hi-story-import-volumes-'));
  });
  afterEach(async () => { db.close(); await rm(vault, { recursive: true, force: true }); });

  const write = async (p: string, c: string) => { const f = path.join(vault, p); await mkdir(path.dirname(f), { recursive: true }); await writeFile(f, c); };
  const setPath = () => db.prepare('UPDATE projects SET obsidian_path = ? WHERE id = ?').run(vault, 'p1');

  const keepChoices = () => ({ master: { action: 'keep' as const, unlockLocked: false }, volumes: { action: 'keep' as const, unlockLocked: false }, chapters: { action: 'keep' as const, unlockLocked: false } });

  const seedPlanning = (volumes: unknown[]) => {
    db.prepare(`INSERT INTO planning_ideas (id, project_id, generated_options, selected_option, status, master_outline, outline_status, volume_outlines, volume_status, chapter_outlines, chapter_outline_status)
      VALUES ('pl1','p1','[{"title":"旧","logline":"","targetReader":"","corePromise":"","protagonist":"","centralConflict":"","differentiator":"","endingDirection":""}]',0,'confirmed','{"premise":"旧"}','generated',?,'generated','[]','empty')`).run(JSON.stringify(volumes));
  };

  const chapterSel = async (repo: ObsidianImportRepo) => {
    const prep = await repo.prepare('p1');
    const cand = prep.data!.candidates.find((c: any) => c.slots.includes('chapter'))!;
    return { relativePath: cand.relativePath, hash: cand.hash, slots: cand.slots, defaultVolumeIndex: cand.drafts.chapters[0]?.volumeIndex ?? null, characterOverrides: [], worldOverrides: [] };
  };

  it('volumeIndex 等于最终卷数量时失败（keep 保留数据库 1 卷，来源章纲指向卷 2）', async () => {
    seedPlanning([{ title: '数据库卷A', chapterRange: '第 1-10 章' }]);
    await write('章节细纲.md', '## 卷 2（第 11-20 章）\n\n| 章 | 标题 | 核心事件 |\n|---|---|---|\n| 11 | 转折 | 冲突。 |');
    const repo = new ObsidianImportRepo(db);
    setPath();
    const sel = await chapterSel(repo);
    expect(sel.defaultVolumeIndex).toBe(1); // 卷 2 → 下标 1
    const res = await repo.commit({
      projectId: 'p1', operationId: 'op', selections: [sel],
      layerChoices: { master: { action: 'keep', unlockLocked: false }, volumes: { action: 'keep', unlockLocked: false }, chapters: { action: 'fill', unlockLocked: false } },
    });
    expect(res.success).toBe(false);
    expect(res.error).toContain('卷');
    expect(db.prepare('SELECT COUNT(*) AS n FROM planning_ideas').get()).toEqual({ n: 1 });
    expect(JSON.parse((db.prepare('SELECT chapter_outlines FROM planning_ideas WHERE id = ?').get('pl1') as any).chapter_outlines)).toEqual([]);
  });

  it('keep 且数据库无卷时，来源卷不能被章纲引用', async () => {
    // 数据库 seed master 有、卷空；volumes keep → 最终卷空，章纲引用来源卷应被拒绝
    db.prepare(`INSERT INTO planning_ideas (id, project_id, generated_options, selected_option, status, master_outline, outline_status, volume_outlines, volume_status, chapter_outlines, chapter_outline_status)
      VALUES ('pl1','p1','[{"title":"旧","logline":"","targetReader":"","corePromise":"","protagonist":"","centralConflict":"","differentiator":"","endingDirection":""}]',0,'confirmed','{"premise":"旧"}','generated','[]','empty','[]','empty')`).run();
    await write('大纲_卷1.md', '# 卷 1 开端（第 1-10 章）\n## 本卷目标\n开端');
    await write('章节细纲.md', '## 卷 1（第 1-10 章）\n\n| 章 | 标题 | 核心事件 |\n|---|---|---|\n| 1 | 起点 | 开场。 |');
    const repo = new ObsidianImportRepo(db);
    setPath();
    const prep = await repo.prepare('p1');
    const volumeCand = prep.data!.candidates.find((c: any) => c.slots.includes('volume'))!;
    const chapterCand = prep.data!.candidates.find((c: any) => c.slots.includes('chapter'))!;
    const res = await repo.commit({
      projectId: 'p1', operationId: 'op', selections: [
        { relativePath: volumeCand.relativePath, hash: volumeCand.hash, slots: volumeCand.slots, defaultVolumeIndex: null, characterOverrides: [], worldOverrides: [] },
        { relativePath: chapterCand.relativePath, hash: chapterCand.hash, slots: chapterCand.slots, defaultVolumeIndex: 0, characterOverrides: [], worldOverrides: [] },
      ],
      layerChoices: { master: { action: 'keep', unlockLocked: false }, volumes: { action: 'keep', unlockLocked: false }, chapters: { action: 'fill', unlockLocked: false } },
    });
    expect(res.success).toBe(false);
    expect(res.error).toContain('分卷纲');
    expect(db.prepare('SELECT COUNT(*) AS n FROM planning_ideas').get()).toEqual({ n: 1 });
  });

  it('clear 且选择来源卷时，最终卷列表仍为空（来源卷不写入）', async () => {
    seedPlanning([{ title: '数据库卷A', chapterRange: '第 1-10 章' }]);
    await write('大纲_卷1.md', '# 卷 1 开端（第 1-10 章）\n## 本卷目标\n开端');
    const repo = new ObsidianImportRepo(db);
    setPath();
    const prep = await repo.prepare('p1');
    const volumeCand = prep.data!.candidates.find((c: any) => c.slots.includes('volume'))!;
    const res = await repo.commit({
      projectId: 'p1', operationId: 'op', selections: [
        { relativePath: volumeCand.relativePath, hash: volumeCand.hash, slots: volumeCand.slots, defaultVolumeIndex: null, characterOverrides: [], worldOverrides: [] },
      ],
      layerChoices: { master: { action: 'keep', unlockLocked: false }, volumes: { action: 'clear', unlockLocked: true }, chapters: { action: 'keep', unlockLocked: false } },
    });
    expect(res.success).toBe(true);
    const row = db.prepare('SELECT volume_outlines FROM planning_ideas WHERE id = ?').get('pl1') as any;
    // clear 后 volume_outlines 为空字符串（applyPlanning 的 decide clear 分支），表示清空
    const parsed = row.volume_outlines ? JSON.parse(row.volume_outlines) : [];
    expect(parsed).toEqual([]);
  });

  it('两个卷标题相同被拒绝（卷标题独立去重）', async () => {
    await write('大纲_卷1.md', '# 卷 1（第 1-10 章）\n## 本卷目标\n开端');
    await write('大纲_卷2.md', '# 卷 1（第 11-20 章）\n## 本卷目标\n续篇');
    const repo = new ObsidianImportRepo(db);
    setPath();
    const prep = await repo.prepare('p1');
    const volCands = prep.data!.candidates.filter((c: any) => c.slots.includes('volume'));
    expect(volCands.length).toBe(2);
    const res = await repo.commit({
      projectId: 'p1', operationId: 'op',
      selections: volCands.map((c: any) => ({ relativePath: c.relativePath, hash: c.hash, slots: c.slots, defaultVolumeIndex: null, characterOverrides: [], worldOverrides: [] })),
      layerChoices: { master: { action: 'fill', unlockLocked: false }, volumes: { action: 'fill', unlockLocked: false }, chapters: { action: 'keep', unlockLocked: false } },
    });
    expect(res.success).toBe(false);
    expect(res.error).toContain('重复卷标题');
    expect(db.prepare('SELECT COUNT(*) AS n FROM planning_ideas').get()).toEqual({ n: 0 });
  });
});
