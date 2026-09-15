import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { getLatestMigrationVersion, runMigrations } from '../../../src/main/db/migrations';
import { ConversationRepo } from '../../../src/main/db/repositories/conversation.repo';

function messageColumnNames(db: Database.Database): Set<string> {
  return new Set(
    (db.prepare('PRAGMA table_info(conversation_messages)').all() as Array<{ name: string }>).map(
      (c) => c.name,
    ),
  );
}

function indexExists(db: Database.Database, name: string): boolean {
  return Boolean(
    db.prepare(
      `SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?`,
    ).get(name),
  );
}

function seedProject(db: Database.Database, projectId = 'p1'): string {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO projects (id, name, type_tags, style, summary, created_at, updated_at)
     VALUES (?, '测试书', '[]', '', '', ?, ?)`,
  ).run(projectId, now, now);
  return now;
}

describe('Migration v22（AI 对话消息软删除列）', () => {
  const databases: Database.Database[] = [];

  afterEach(() => {
    databases.splice(0).forEach((db) => db.close());
  });

  it('全量迁移后版本 ≥22，且软删列与批次索引存在', () => {
    const db = new Database(':memory:');
    databases.push(db);
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    expect(getLatestMigrationVersion()).toBeGreaterThanOrEqual(22);
    const v = db.prepare('SELECT MAX(version) AS v FROM _migrations').get() as { v: number };
    expect(v.v).toBeGreaterThanOrEqual(22);

    const cols = messageColumnNames(db);
    expect(cols.has('deleted_at')).toBe(true);
    expect(cols.has('deletion_batch_id')).toBe(true);
    expect(indexExists(db, 'idx_conversation_messages_deletion_batch')).toBe(true);
  });

  it('v21 已有消息升级后 deleted_at / deletion_batch_id 保持 NULL', () => {
    const db = new Database(':memory:');
    databases.push(db);
    db.pragma('foreign_keys = ON');
    runMigrations(db, 21);

    const now = seedProject(db);
    db.prepare(
      `INSERT INTO conversation_threads (id, project_id, title, category, created_at, updated_at)
       VALUES ('t-old', 'p1', '旧会话', 'general', ?, ?)`,
    ).run(now, now);
    db.prepare(
      `INSERT INTO conversation_messages
         (id, thread_id, role, content, provider_id, timestamp, updated_at, sort_order, context_type)
       VALUES ('m-old', 't-old', 'user', '升级前内容', NULL, ?, ?, 0, 'chat')`,
    ).run(now, now);

    const beforeCols = messageColumnNames(db);
    expect(beforeCols.has('deleted_at')).toBe(false);
    expect(beforeCols.has('deletion_batch_id')).toBe(false);

    runMigrations(db);

    const row = db.prepare(
      `SELECT deleted_at, deletion_batch_id FROM conversation_messages WHERE id = 'm-old'`,
    ).get() as { deleted_at: string | null; deletion_batch_id: string | null };
    expect(row.deleted_at).toBeNull();
    expect(row.deletion_batch_id).toBeNull();
  });

  it('v22 登记失败时整笔迁移回滚，软删列仍不存在', () => {
    const db = new Database(':memory:');
    databases.push(db);
    db.pragma('foreign_keys = ON');
    runMigrations(db, 21);
    seedProject(db);

    db.exec(`
      CREATE TRIGGER fail_v22_register BEFORE INSERT ON _migrations
      FOR EACH ROW
      WHEN NEW.version = 22
      BEGIN
        SELECT RAISE(ABORT, 'injected v22 fail');
      END;
    `);

    expect(() => runMigrations(db)).toThrow(/injected v22 fail/);

    expect(db.prepare('SELECT version FROM _migrations WHERE version = 22').get()).toBeUndefined();
    const v = db.prepare('SELECT MAX(version) AS v FROM _migrations').get() as { v: number };
    expect(v.v).toBe(21);

    const cols = messageColumnNames(db);
    expect(cols.has('deleted_at')).toBe(false);
    expect(cols.has('deletion_batch_id')).toBe(false);
    expect(indexExists(db, 'idx_conversation_messages_deletion_batch')).toBe(false);
  });

  it('ConversationRepo.findByProject 过滤软删行，原始 SQL 仍可见', () => {
    const db = new Database(':memory:');
    databases.push(db);
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    const projectId = 'p-filter';
    seedProject(db, projectId);
    const repo = new ConversationRepo(db);

    const threadRes = repo.createThread({
      projectId,
      title: '过滤测试',
      category: 'general',
    });
    expect(threadRes.success).toBe(true);
    const threadId = threadRes.data!.id;

    const activeRes = repo.appendMessage({
      projectId,
      threadId,
      role: 'user',
      content: '仍可见',
    });
    expect(activeRes.success).toBe(true);
    const activeId = activeRes.data!.id;

    const deletedRes = repo.appendMessage({
      projectId,
      threadId,
      role: 'assistant',
      content: '已软删',
    });
    expect(deletedRes.success).toBe(true);
    const deletedId = deletedRes.data!.id;

    const batchId = 'batch-test-1';
    const deletedAt = new Date().toISOString();
    db.prepare(
      `UPDATE conversation_messages
       SET deleted_at = ?, deletion_batch_id = ?
       WHERE id = ?`,
    ).run(deletedAt, batchId, deletedId);

    const snapshot = repo.findByProject(projectId);
    expect(snapshot.success).toBe(true);
    const msgs = snapshot.data!.messages[threadId] ?? [];
    expect(msgs.map((m) => m.id)).toEqual([activeId]);
    expect(msgs[0]!.content).toBe('仍可见');

    const rawCount = (
      db.prepare(
        `SELECT COUNT(*) AS n FROM conversation_messages WHERE thread_id = ?`,
      ).get(threadId) as { n: number }
    ).n;
    expect(rawCount).toBe(2);

    const softRow = db.prepare(
      `SELECT deleted_at, deletion_batch_id FROM conversation_messages WHERE id = ?`,
    ).get(deletedId) as { deleted_at: string; deletion_batch_id: string };
    expect(softRow.deleted_at).toBe(deletedAt);
    expect(softRow.deletion_batch_id).toBe(batchId);
  });
});
