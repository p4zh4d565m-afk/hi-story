import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConversationRepo } from '../../../src/main/db/repositories/conversation.repo';
import type { LegacyConversationData } from '../../../src/renderer/types';

describe('ConversationRepo', () => {
  let db: Database.Database;
  let repo: ConversationRepo;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
      );
      CREATE TABLE conversation_threads (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '新对话',
        category TEXT NOT NULL DEFAULT 'general',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE TABLE conversation_messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
        content TEXT NOT NULL DEFAULT '',
        provider_id TEXT,
        timestamp TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        context_type TEXT NOT NULL DEFAULT 'chat',
        deleted_at TEXT,
        deletion_batch_id TEXT,
        FOREIGN KEY (thread_id) REFERENCES conversation_threads(id) ON DELETE CASCADE
      );
      CREATE TABLE data_migration_state (
        project_id TEXT NOT NULL,
        migration_key TEXT NOT NULL,
        completed_at TEXT NOT NULL,
        PRIMARY KEY (project_id, migration_key),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
    `);
    db.prepare('INSERT INTO projects (id, name) VALUES (?, ?)').run('project-a', '项目 A');
    db.prepare('INSERT INTO projects (id, name) VALUES (?, ?)').run('project-b', '项目 B');
    repo = new ConversationRepo(db);
  });

  afterEach(() => db.close());

  it('创建会话并按项目读取', () => {
    const created = repo.createThread({ projectId: 'project-a', title: '角色讨论', category: 'character' });

    expect(created.success).toBe(true);
    expect(created.data).toMatchObject({ projectId: 'project-a', title: '角色讨论', category: 'character' });
    expect(repo.findByProject('project-a').data?.threads).toHaveLength(1);
  });

  it('不同项目的会话和消息严格隔离', () => {
    const threadA = repo.createThread({ projectId: 'project-a', title: 'A 对话', category: 'general' }).data!;
    const threadB = repo.createThread({ projectId: 'project-b', title: 'B 对话', category: 'plot' }).data!;
    repo.appendMessage({ projectId: 'project-a', threadId: threadA.id, role: 'user', content: 'A 消息', contextType: 'chat' });
    repo.appendMessage({ projectId: 'project-b', threadId: threadB.id, role: 'user', content: 'B 消息', contextType: 'chat' });

    const snapshotA = repo.findByProject('project-a').data!;
    expect(snapshotA.threads.map(thread => thread.title)).toEqual(['A 对话']);
    expect(snapshotA.messages[threadA.id].map(message => message.content)).toEqual(['A 消息']);
    expect(snapshotA.messages[threadB.id]).toBeUndefined();
    expect(repo.appendMessage({ projectId: 'project-b', threadId: threadA.id, role: 'user', content: '越权消息', contextType: 'chat' }).success).toBe(false);
  });

  it('相同时间戳的消息仍按追加顺序稳定读取', () => {
    const thread = repo.createThread({ projectId: 'project-a', title: '顺序测试', category: 'general' }).data!;
    const timestamp = '2026-09-09T08:00:00.000Z';
    repo.appendMessage({ projectId: 'project-a', threadId: thread.id, role: 'user', content: '第一条', contextType: 'chat', createdAt: timestamp });
    repo.appendMessage({ projectId: 'project-a', threadId: thread.id, role: 'assistant', content: '第二条', contextType: 'chat', createdAt: timestamp });

    const messages = repo.findByProject('project-a').data!.messages[thread.id];
    expect(messages.map(message => [message.sortOrder, message.content])).toEqual([[0, '第一条'], [1, '第二条']]);
  });

  it('追加消息会更新会话时间并保存上下文类型', () => {
    const thread = repo.createThread({ projectId: 'project-a', title: '续写', category: 'plot' }).data!;
    const later = '2026-09-09T09:00:00.000Z';
    const message = repo.appendMessage({
      projectId: 'project-a', threadId: thread.id, role: 'assistant', content: '续写结果',
      providerId: 'openai', contextType: 'continue', createdAt: later,
    }).data!;

    expect(message).toMatchObject({ providerId: 'openai', contextType: 'continue', createdAt: later, updatedAt: later });
    expect(repo.findByProject('project-a').data!.threads[0].updatedAt).toBe(later);
  });

  it('旧 localStorage 数据只导入一次', () => {
    const legacy: LegacyConversationData = {
      threads: [{ id: 'legacy-thread', name: '旧对话', category: 'world', createdAt: '2026-01-01T00:00:00.000Z' }],
      messages: {
        'legacy-thread': [
          { id: 'legacy-user', role: 'user', content: '旧问题', timestamp: '2026-01-01T00:01:00.000Z' },
          { id: 'legacy-ai', role: 'assistant', content: '旧回答', timestamp: '2026-01-01T00:02:00.000Z' },
        ],
      },
    };

    expect(repo.migrateLegacy('project-a', legacy).data?.status).toBe('imported');
    expect(repo.migrateLegacy('project-a', legacy).data?.status).toBe('already_migrated');
    const snapshot = repo.findByProject('project-a').data!;
    expect(snapshot.threads).toHaveLength(1);
    expect(snapshot.messages['legacy-thread']).toHaveLength(2);
  });

  it('findByProject 不返回已软删消息', () => {
    const thread = repo.createThread({ projectId: 'project-a', title: 't', category: 'general' }).data!;
    const user = repo.appendMessage({
      projectId: 'project-a', threadId: thread.id, role: 'user', content: '可见前', contextType: 'chat',
    }).data!;
    db.prepare(`
      UPDATE conversation_messages SET deleted_at = ?, deletion_batch_id = ? WHERE id = ?
    `).run('2026-09-15T00:00:00.000Z', 'batch-1', user.id);

    const msgs = repo.findByProject('project-a').data!.messages[thread.id] ?? [];
    expect(msgs.map(m => m.id)).not.toContain(user.id);
    const raw = db.prepare('SELECT COUNT(*) AS c FROM conversation_messages WHERE id = ?').get(user.id) as { c: number };
    expect(raw.c).toBe(1);
  });

  it('旧数据导入失败时事务回滚且不记录完成状态', () => {
    const invalidLegacy = {
      threads: [{ id: 'broken-thread', name: '损坏对话', category: 'general', createdAt: '2026-01-01T00:00:00.000Z' }],
      messages: {
        'broken-thread': [{ id: 'broken-message', role: 'tool', content: '非法角色', timestamp: '2026-01-01T00:01:00.000Z' }],
      },
    } as unknown as LegacyConversationData;

    const result = repo.migrateLegacy('project-a', invalidLegacy);

    expect(result.success).toBe(false);
    expect(repo.findByProject('project-a').data?.threads).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS count FROM data_migration_state').get()).toEqual({ count: 0 });
  });
});
