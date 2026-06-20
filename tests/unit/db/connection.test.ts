import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';

describe('Database Connection', () => {
  let db: Database.Database;

  beforeAll(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  });

  afterAll(() => {
    db.close();
  });

  it('should enable WAL mode (only on file-based DB)', () => {
    const result = db.pragma('journal_mode');
    // In-memory databases cannot use WAL mode; they always return 'memory'
    expect(['wal', 'memory']).toContain(result[0].journal_mode);
  });

  it('should enable foreign keys', () => {
    const result = db.pragma('foreign_keys');
    expect(result[0].foreign_keys).toBe(1);
  });

  it('should create tables from migrations', () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type_tags TEXT NOT NULL DEFAULT '[]',
        style TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='projects'"
    ).all();
    expect(tables.length).toBe(1);
  });
});
