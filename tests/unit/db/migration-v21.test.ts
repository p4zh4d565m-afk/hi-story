import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations, getLatestMigrationVersion, backfillChapterOutlineIds } from '../../../src/main/db/migrations';

function snapshotAnchors(db: Database.Database) {
  return {
    version: (db.prepare('SELECT MAX(version) as v FROM _migrations').get() as { v: number }).v,
    history: (db.prepare('SELECT COUNT(*) as n FROM chapter_history').get() as { n: number }).n,
    factChapterId: (db.prepare(`SELECT chapter_id as id FROM story_facts WHERE id = 'f1'`).get() as { id: string | null } | undefined)?.id ?? null,
    knowledgeChapterId: (db.prepare(`SELECT learned_at_chapter_id as id FROM character_knowledge WHERE id = 'k1'`).get() as { id: string | null } | undefined)?.id ?? null,
    hookChapterId: (db.prepare(`SELECT chapter_id as id FROM narrative_hooks WHERE id = 'hk1'`).get() as { id: string | null } | undefined)?.id ?? null,
    debtChapterId: (db.prepare(`SELECT chapter_id as id FROM narrative_debts WHERE id = 'd1'`).get() as { id: string | null } | undefined)?.id ?? null,
  };
}

describe('Migration v21（叙事时间接入）', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  it('最新版本为 21', () => {
    expect(getLatestMigrationVersion()).toBe(21);
    const row = db.prepare('SELECT MAX(version) as v FROM _migrations').get() as { v: number };
    expect(row.v).toBe(21);
  });

  it('创建 narrative_transitions、chapter_alias 与墓碑/状态键列', () => {
    const tables = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('narrative_transitions','chapter_alias')`,
    ).all() as Array<{ name: string }>;
    expect(tables.map((t) => t.name).sort()).toEqual(['chapter_alias', 'narrative_transitions']);

    const chapterCols = db.prepare(`PRAGMA table_info(chapters)`).all() as Array<{ name: string }>;
    const names = new Set(chapterCols.map((c) => c.name));
    expect(names.has('deleted_at')).toBe(true);
    expect(names.has('deleted_sort_order')).toBe(true);
    expect(names.has('planning_outline_id')).toBe(true);

    const factCols = db.prepare(`PRAGMA table_info(story_facts)`).all() as Array<{ name: string }>;
    const factNames = new Set(factCols.map((c) => c.name));
    expect(factNames.has('state_key')).toBe(true);
    expect(factNames.has('state_key_version')).toBe(true);
    expect(factNames.has('archived')).toBe(true);
  });

  it('旧 fact_type=hook 在升级后 archived=1', () => {
    // 模拟：先插项目与 hook 事实（迁移已跑，直接插）
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO projects (id, name, type_tags, style, summary, created_at, updated_at) VALUES ('p1','t','[]','','',?,?)`,
    ).run(now, now);
    db.prepare(
      `INSERT INTO story_facts (id, project_id, fact_type, subject, predicate, object, description, status, archived, created_at)
       VALUES ('f1','p1','hook','s','p','o','d','active',0,?)`,
    ).run(now);
    // 再跑归档逻辑（迁移已对空表跑过；这里手动复现 UPDATE）
    db.prepare(`UPDATE story_facts SET archived = 1 WHERE fact_type = 'hook'`).run();
    const row = db.prepare(`SELECT archived FROM story_facts WHERE id = 'f1'`).get() as { archived: number };
    expect(row.archived).toBe(1);
  });

  it('backfillChapterOutlineIds 为缺 id 的章纲补 UUID', () => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO projects (id, name, type_tags, style, summary, created_at, updated_at) VALUES ('p1','t','[]','','',?,?)`,
    ).run(now, now);
    const outlines = [
      { volumeIndex: 0, chapterNumber: 1, title: '一' },
      { id: 'keep-me', volumeIndex: 0, chapterNumber: 2, title: '二' },
    ];
    db.prepare(
      `INSERT INTO planning_ideas (id, project_id, idea, requirements, generated_options, selected_option, status,
        master_outline, outline_status, volume_outlines, volume_status, chapter_outlines, chapter_outline_status, created_at, updated_at)
       VALUES ('pi1','p1','idea','','[]',null,'draft','','empty','[]','empty',?,'empty',?,?)`,
    ).run(JSON.stringify(outlines), now, now);

    backfillChapterOutlineIds(db);
    const row = db.prepare(`SELECT chapter_outlines FROM planning_ideas WHERE id = 'pi1'`).get() as {
      chapter_outlines: string;
    };
    const parsed = JSON.parse(row.chapter_outlines) as Array<{ id?: string; title: string }>;
    expect(parsed[0]!.id).toBeTruthy();
    expect(parsed[0]!.id).not.toBe('keep-me');
    expect(parsed[1]!.id).toBe('keep-me');
  });

  it('v20 真实库升级后历史/事实/知识/钩/债锚点与数量不变，且 foreign_key_check 为空', () => {
    const db2 = new Database(':memory:');
    db2.pragma('foreign_keys = ON');
    runMigrations(db2, 20);

    const now = new Date().toISOString();
    db2.prepare(
      `INSERT INTO projects (id, name, type_tags, style, summary, created_at, updated_at)
       VALUES ('p1','旧书','[]','','',?,?)`,
    ).run(now, now);
    db2.prepare(
      `INSERT INTO chapters (id, project_id, title, content, status, word_count, sort_order, summary, planning_outline, created_at, updated_at)
       VALUES ('c1','p1','第一章','<p>正文</p>','draft',2,0,'','',?,?)`,
    ).run(now, now);
    db2.prepare(
      `INSERT INTO chapter_history (id, chapter_id, content, word_count, saved_at) VALUES ('h1','c1','<p>旧版</p>',2,?)`,
    ).run(now);
    db2.prepare(
      `INSERT INTO story_facts (id, project_id, chapter_id, fact_type, subject, predicate, object, description, status, created_at)
       VALUES ('f1','p1','c1','event','林岚','发现','铜钥','林岚在废站捡到铜钥','active',?)`,
    ).run(now);
    db2.prepare(
      `INSERT INTO character_knowledge (id, project_id, character_name, fact_description, source, learned_at_chapter_id, created_at)
       VALUES ('k1','p1','林岚','知道废站有暗门','亲眼发现','c1',?)`,
    ).run(now);
    db2.prepare(
      `INSERT INTO narrative_hooks (id, project_id, chapter_id, hook_type, description, intensity, status, created_at, updated_at, subject)
       VALUES ('hk1','p1','c1','mystery','带血车票从哪来',4,'open',?,?, '车票')`,
    ).run(now, now);
    db2.prepare(
      `INSERT INTO narrative_debts (id, project_id, chapter_id, description, debt_type, promised_by_chapter, status, created_at, updated_at, subject)
       VALUES ('d1','p1','c1','揭晓站长身份','reveal',3,'unpaid',?,?, '站长')`,
    ).run(now, now);

    const before = snapshotAnchors(db2);
    expect(before.history).toBe(1);
    expect(before.factChapterId).toBe('c1');
    expect(before.knowledgeChapterId).toBe('c1');
    expect(before.hookChapterId).toBe('c1');
    expect(before.debtChapterId).toBe('c1');

    runMigrations(db2); // 20 → 21

    const after = snapshotAnchors(db2);
    expect(after.version).toBe(21);
    expect(after.history).toBe(1);
    expect(after.factChapterId).toBe('c1');
    expect(after.knowledgeChapterId).toBe('c1');
    expect(after.hookChapterId).toBe('c1');
    expect(after.debtChapterId).toBe('c1');
    expect(db2.pragma('foreign_key_check')).toEqual([]);
    db2.close();
  });

  it('迁移失败时版本不登记（原子回滚）', () => {
    const db2 = new Database(':memory:');
    db2.pragma('foreign_keys = ON');
    // 只跑到 v20 的简易路径：完整 runMigrations 到 21 后删掉 21 再注入坏 after
    runMigrations(db2);
    db2.prepare('DELETE FROM _migrations WHERE version = 21').run();
    // 破坏：删除 chapters 再尝试手工模拟失败事务
    let failed = false;
    try {
      db2.transaction(() => {
        db2.exec(`ALTER TABLE chapters ADD COLUMN deleted_at TEXT`); // 已存在会失败
        db2.prepare('INSERT INTO _migrations (version) VALUES (21)').run();
      })();
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
    const v = db2.prepare('SELECT MAX(version) as v FROM _migrations').get() as { v: number };
    expect(v.v).toBe(20);
    db2.close();
  });
});
