import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../../src/main/db/migrations';

function columns(db: Database.Database, table: string): string[] {
  return db.prepare(`PRAGMA table_info(${table})`).all()
    .map(row => (row as { name: string }).name);
}

function tableExists(db: Database.Database, table: string): boolean {
  return Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(table));
}

function createV17DecisionTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE _migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE projects (id TEXT PRIMARY KEY);
    CREATE TABLE chapters (id TEXT PRIMARY KEY, project_id TEXT NOT NULL);
    CREATE TABLE characters (id TEXT PRIMARY KEY, project_id TEXT NOT NULL);
    CREATE TABLE conversation_threads (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE TABLE conversation_messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      FOREIGN KEY (thread_id) REFERENCES conversation_threads(id) ON DELETE CASCADE
    );
    CREATE TABLE story_facts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      chapter_id TEXT,
      fact_type TEXT NOT NULL,
      subject TEXT NOT NULL DEFAULT '',
      predicate TEXT NOT NULL DEFAULT '',
      object TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      superseded_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE character_knowledge (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      character_id TEXT,
      character_name TEXT NOT NULL DEFAULT '',
      fact_description TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '',
      learned_at_chapter_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE narrative_hooks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      chapter_id TEXT,
      hook_type TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      intensity INTEGER NOT NULL DEFAULT 3,
      status TEXT NOT NULL DEFAULT 'open',
      resolved_in_chapter_id TEXT,
      due_chapter_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE narrative_debts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      chapter_id TEXT,
      description TEXT NOT NULL DEFAULT '',
      debt_type TEXT NOT NULL,
      promised_by_chapter INTEGER,
      status TEXT NOT NULL DEFAULT 'unpaid',
      paid_in_chapter_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const markApplied = db.prepare('INSERT INTO _migrations (version) VALUES (?)');
  for (let version = 1; version <= 17; version += 1) markApplied.run(version);
}

describe('创作决策迁移 v18', () => {
  const databases: Database.Database[] = [];

  afterEach(() => {
    databases.splice(0).forEach(db => db.close());
  });

  it('创建决策账本、效果表和四类目标表来源列', () => {
    const db = new Database(':memory:');
    databases.push(db);

    runMigrations(db);

    expect(db.prepare('SELECT version FROM _migrations WHERE version = 18').get())
      .toEqual({ version: 18 });
    expect(tableExists(db, 'creative_decisions')).toBe(true);
    expect(tableExists(db, 'creative_decision_effects')).toBe(true);
    expect(columns(db, 'story_facts')).toEqual(expect.arrayContaining([
      'source_decision_id', 'source_kind',
    ]));
    expect(columns(db, 'character_knowledge')).toEqual(expect.arrayContaining([
      'source_decision_id', 'source_kind', 'status', 'superseded_by',
    ]));
    expect(columns(db, 'narrative_hooks')).toContain('source_decision_id');
    expect(columns(db, 'narrative_debts')).toContain('source_decision_id');
  });

  it('迁移保留旧事实并标记为兼容来源', () => {
    const db = new Database(':memory:');
    databases.push(db);
    createV17DecisionTables(db);
    db.prepare('INSERT INTO projects (id) VALUES (?)').run('project-a');
    db.prepare(`
      INSERT INTO story_facts (
        id, project_id, fact_type, subject, predicate, object, description
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('legacy-fact', 'project-a', 'event', '主角', '发现', '密室', '主角发现密室');

    runMigrations(db);

    expect(db.prepare(
      'SELECT description, source_kind AS sourceKind FROM story_facts WHERE id = ?',
    ).get('legacy-fact')).toEqual({
      description: '主角发现密室',
      sourceKind: 'legacy',
    });
  });
});
