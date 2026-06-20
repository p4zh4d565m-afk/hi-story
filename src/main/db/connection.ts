import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';

let db: Database.Database | null = null;

export function getDbPath(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'hi-story.db');
}

export function getDb(): Database.Database {
  if (db) return db;

  const dbPath = getDbPath();

  db = new Database(dbPath);

  // WAL 模式 — 支持并发读，写入性能更好
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
