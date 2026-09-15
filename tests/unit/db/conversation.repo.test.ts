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

  it('deleteTurn 软删 user 至下一 user 前的回复且可按 batch 恢复', () => {
    const thread = repo.createThread({ projectId: 'project-a', title: 't', category: 'general' }).data!;
    const u1 = repo.appendMessage({ projectId: 'project-a', threadId: thread.id, role: 'user', content: 'Q1', contextType: 'chat' }).data!;
    const a1 = repo.appendMessage({ projectId: 'project-a', threadId: thread.id, role: 'assistant', content: 'A1', contextType: 'chat' }).data!;
    const u2 = repo.appendMessage({ projectId: 'project-a', threadId: thread.id, role: 'user', content: 'Q2', contextType: 'chat' }).data!;
    const a2 = repo.appendMessage({ projectId: 'project-a', threadId: thread.id, role: 'assistant', content: 'A2', contextType: 'chat' }).data!;

    const del = repo.deleteTurn('project-a', thread.id, u1.id);
    expect(del.success).toBe(true);
    expect(del.data?.noop).toBe(false);
    expect(del.data?.batchId).toBeTruthy();
    expect(new Set(del.data!.deletedMessageIds)).toEqual(new Set([u1.id, a1.id]));

    const visible = repo.findByProject('project-a').data!.messages[thread.id].map(m => m.id);
    expect(visible).toEqual([u2.id, a2.id]);

    const restored = repo.restoreBatch('project-a', thread.id, del.data!.batchId!);
    expect(restored.success).toBe(true);
    expect(repo.findByProject('project-a').data!.messages[thread.id].map(m => m.id))
      .toEqual([u1.id, a1.id, u2.id, a2.id]);
  });

  it('clearThread 无活跃消息时 noop 且不改库', () => {
    const thread = repo.createThread({ projectId: 'project-a', title: 'empty', category: 'general' }).data!;
    const before = db.prepare('SELECT updated_at FROM conversation_threads WHERE id = ?').get(thread.id);
    const res = repo.clearThread('project-a', thread.id);
    expect(res).toMatchObject({
      success: true,
      data: { noop: true, batchId: null, deletedMessageIds: [], deletedAt: null },
    });
    const after = db.prepare('SELECT updated_at FROM conversation_threads WHERE id = ?').get(thread.id);
    expect(after).toEqual(before);
  });

  it('restoreBatch 拒绝跨项目或空 batchId', () => {
    expect(repo.restoreBatch('project-a', 'nope', '').success).toBe(false);
    expect(repo.restoreBatch('project-a', 'nope', 'batch-missing').success).toBe(false);
  });

  it('clearThread 有活跃消息时整批软删', () => {
    const thread = repo.createThread({ projectId: 'project-a', title: 'full', category: 'general' }).data!;
    const u1 = repo.appendMessage({ projectId: 'project-a', threadId: thread.id, role: 'user', content: 'Q1', contextType: 'chat' }).data!;
    const a1 = repo.appendMessage({ projectId: 'project-a', threadId: thread.id, role: 'assistant', content: 'A1', contextType: 'chat' }).data!;

    const res = repo.clearThread('project-a', thread.id);
    expect(res.success).toBe(true);
    expect(res.data?.noop).toBe(false);
    expect(res.data?.batchId).toBeTruthy();
    expect(new Set(res.data!.deletedMessageIds)).toEqual(new Set([u1.id, a1.id]));
    expect(repo.findByProject('project-a').data!.messages[thread.id] ?? []).toEqual([]);

    const softDeleted = db.prepare(`
      SELECT COUNT(*) AS c FROM conversation_messages
      WHERE thread_id = ? AND deleted_at IS NOT NULL AND deletion_batch_id = ?
    `).get(thread.id, res.data!.batchId) as { c: number };
    expect(softDeleted.c).toBe(2);
  });

  it('deleteTurn 锚点非活跃 user 时失败', () => {
    const thread = repo.createThread({ projectId: 'project-a', title: 't', category: 'general' }).data!;
    const user = repo.appendMessage({
      projectId: 'project-a', threadId: thread.id, role: 'user', content: 'Q', contextType: 'chat',
    }).data!;
    const assistant = repo.appendMessage({
      projectId: 'project-a', threadId: thread.id, role: 'assistant', content: 'A', contextType: 'chat',
    }).data!;

    expect(repo.deleteTurn('project-a', thread.id, assistant.id).success).toBe(false);

    db.prepare(`
      UPDATE conversation_messages SET deleted_at = ?, deletion_batch_id = ? WHERE id = ?
    `).run('2026-09-15T00:00:00.000Z', 'batch-x', user.id);
    expect(repo.deleteTurn('project-a', thread.id, user.id).success).toBe(false);
  });

  it('软删后 appendMessage 的 sort_order 仍按全表 MAX+1 单调', () => {
    const thread = repo.createThread({ projectId: 'project-a', title: 't', category: 'general' }).data!;
    const u1 = repo.appendMessage({ projectId: 'project-a', threadId: thread.id, role: 'user', content: 'Q1', contextType: 'chat' }).data!;
    const a1 = repo.appendMessage({ projectId: 'project-a', threadId: thread.id, role: 'assistant', content: 'A1', contextType: 'chat' }).data!;
    expect(a1.sortOrder).toBe(1);

    const del = repo.deleteTurn('project-a', thread.id, u1.id);
    expect(del.success).toBe(true);

    const u2 = repo.appendMessage({ projectId: 'project-a', threadId: thread.id, role: 'user', content: 'Q2', contextType: 'chat' }).data!;
    expect(u2.sortOrder).toBe(2);

    const maxIncludingDeleted = db.prepare(`
      SELECT MAX(sort_order) AS m FROM conversation_messages WHERE thread_id = ?
    `).get(thread.id) as { m: number };
    expect(maxIncludingDeleted.m).toBe(2);
  });
});
