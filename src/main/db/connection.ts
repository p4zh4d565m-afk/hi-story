import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';

let db: Database.Database | null = null;
let litDb: Database.Database | null = null;

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

/**
 * Attach the literary database for cross-database querying.
 * The literary DB contains FTS5 indexes for the 5-layer library.
 */
export function attachLiteraryDb(): void {
  const litDbPath = getLiteraryDbPath();
  if (!fs.existsSync(litDbPath)) {
    console.warn('Literary database not found at:', litDbPath);
    console.warn('Run: python scripts/download_literary_data.py');
    return;
  }
  try {
    const mainDb = getDb();
    // Attach as 'lit' so we can query: SELECT ... FROM lit.fts_dictionary ...
    mainDb.prepare(`ATTACH DATABASE ? AS lit`).run(litDbPath);
    console.log('Literary database attached:', litDbPath);
  } catch (err) {
    console.error('Failed to attach literary DB:', err);
  }
}

export function getLiteraryDbPath(): string {
  // Check in user data dir first (where the download script puts it)
  const userDataPath = app.getPath('userData');
  const userPath = path.join(userDataPath, 'data', 'literary.db');
  if (fs.existsSync(userPath)) return userPath;

  // Fallback: check in resources (bundled with app)
  if (app.isPackaged) {
    const resourcePath = path.join(process.resourcesPath, 'literary.db');
    if (fs.existsSync(resourcePath)) return resourcePath;
  }

  // Default to user data dir
  return userPath;
}

export function getLiteraryDb(): Database.Database {
  if (litDb) return litDb;

  const litDbPath = getLiteraryDbPath();
  if (!fs.existsSync(litDbPath)) return null!;

  litDb = new Database(litDbPath, { readonly: true });
  return litDb;
}

export function closeDb(): void {
  if (litDb) {
    litDb.close();
    litDb = null;
  }
  if (db) {
    db.close();
    db = null;
  }
}
