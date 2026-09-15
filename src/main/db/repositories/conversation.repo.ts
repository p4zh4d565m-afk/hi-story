import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type {
  AppendConversationMessageInput,
  ConversationMessage,
  ConversationSnapshot,
  ConversationThread,
  CreateConversationThreadInput,
  IpcResult,
  LegacyConversationData,
  LegacyMigrationResult,
} from '../../../renderer/types';

const LEGACY_MIGRATION_KEY = 'ai_threads_localstorage_v1';
const VALID_CATEGORIES = new Set<ConversationThread['category']>(['character', 'plot', 'world', 'general']);
const VALID_ROLES = new Set<ConversationMessage['role']>(['user', 'assistant', 'system']);

/** 软删 / 清空批次结果（Task 3 再上移共享类型） */
export type ConversationCleanupResult = {
  batchId: string | null;
  threadId: string;
  deletedMessageIds: string[];
  deletedAt: string | null;
  noop: boolean;
};

/** 按批次恢复结果 */
export type ConversationRestoreResult = {
  batchId: string;
  threadId: string;
  restoredMessageIds: string[];
};

export class ConversationRepo {
  constructor(private db: Database.Database) {}

  findByProject(projectId: string): IpcResult<ConversationSnapshot> {
    try {
      const threadRows = this.db.prepare(`
        SELECT * FROM conversation_threads
        WHERE project_id = ?
        ORDER BY updated_at ASC, created_at ASC, id ASC
      `).all(projectId) as Record<string, unknown>[];
      const threads = threadRows.map(rowToThread);
      const messages: Record<string, ConversationMessage[]> = {};
      const messageStatement = this.db.prepare(`
        SELECT * FROM conversation_messages
        WHERE thread_id = ? AND deleted_at IS NULL
        ORDER BY sort_order ASC, timestamp ASC, id ASC
      `);
      for (const thread of threads) {
        const rows = messageStatement.all(thread.id) as Record<string, unknown>[];
        messages[thread.id] = rows.map(rowToMessage);
      }
      return { success: true, data: { threads, messages } };
    } catch (error) {
      return failure(error);
    }
  }

  createThread(input: CreateConversationThreadInput): IpcResult<ConversationThread> {
    try {
      if (!VALID_CATEGORIES.has(input.category)) throw new Error('会话分类无效');
      const id = input.id ?? uuidv4();
      const now = input.createdAt ?? new Date().toISOString();
      this.db.prepare(`
        INSERT INTO conversation_threads (id, project_id, title, category, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, input.projectId, input.title || '新对话', input.category, now, now);
      return this.findThread(input.projectId, id);
    } catch (error) {
      return failure(error);
    }
  }

  removeThread(projectId: string, threadId: string): IpcResult<void> {
    try {
      const result = this.db.prepare(
        'DELETE FROM conversation_threads WHERE id = ? AND project_id = ?',
      ).run(threadId, projectId);
      if (result.changes === 0) return { success: false, error: '会话不存在或不属于当前项目' };
      return { success: true };
    } catch (error) {
      return failure(error);
    }
  }

  appendMessage(input: AppendConversationMessageInput): IpcResult<ConversationMessage> {
    try {
      if (!VALID_ROLES.has(input.role)) throw new Error('消息角色无效');
      if (!input.content) throw new Error('消息内容不能为空');
      const append = this.db.transaction(() => {
        const thread = this.db.prepare(
          'SELECT id FROM conversation_threads WHERE id = ? AND project_id = ?',
        ).get(input.threadId, input.projectId);
        if (!thread) throw new Error('会话不存在或不属于当前项目');

        const nextOrder = (this.db.prepare(`
          SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order
          FROM conversation_messages WHERE thread_id = ?
        `).get(input.threadId) as { next_order: number }).next_order;
        const id = input.id ?? uuidv4();
        const now = input.createdAt ?? new Date().toISOString();
        this.db.prepare(`
          INSERT INTO conversation_messages
            (id, thread_id, role, content, provider_id, timestamp, updated_at, sort_order, context_type)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id, input.threadId, input.role, input.content, input.providerId ?? null,
          now, now, nextOrder, input.contextType || 'chat',
        );
        this.db.prepare(
          'UPDATE conversation_threads SET updated_at = ? WHERE id = ? AND project_id = ?',
        ).run(now, input.threadId, input.projectId);
        return id;
      });
      return this.findMessage(input.projectId, input.threadId, append());
    } catch (error) {
      return failure(error);
    }
  }

  deleteTurn(projectId: string, threadId: string, userMessageId: string): IpcResult<ConversationCleanupResult> {
    try {
      const run = this.db.transaction((): ConversationCleanupResult => {
        this.requireThread(projectId, threadId);
        const anchor = this.db.prepare(`
          SELECT id, sort_order FROM conversation_messages
          WHERE id = ? AND thread_id = ? AND role = 'user' AND deleted_at IS NULL
        `).get(userMessageId, threadId) as { id: string; sort_order: number } | undefined;
        if (!anchor) throw new Error('锚点消息不存在、非 user 或不属于当前会话');

        const nextUser = this.db.prepare(`
          SELECT sort_order FROM conversation_messages
          WHERE thread_id = ? AND role = 'user' AND deleted_at IS NULL AND sort_order > ?
          ORDER BY sort_order ASC, timestamp ASC, id ASC
          LIMIT 1
        `).get(threadId, anchor.sort_order) as { sort_order: number } | undefined;

        let candidates: { id: string }[];
        if (nextUser) {
          candidates = this.db.prepare(`
            SELECT id FROM conversation_messages
            WHERE thread_id = ? AND deleted_at IS NULL
              AND (
                id = ?
                OR (sort_order > ? AND sort_order < ?)
              )
            ORDER BY sort_order ASC, timestamp ASC, id ASC
          `).all(threadId, anchor.id, anchor.sort_order, nextUser.sort_order) as { id: string }[];
        } else {
          candidates = this.db.prepare(`
            SELECT id FROM conversation_messages
            WHERE thread_id = ? AND deleted_at IS NULL
              AND (id = ? OR sort_order > ?)
            ORDER BY sort_order ASC, timestamp ASC, id ASC
          `).all(threadId, anchor.id, anchor.sort_order) as { id: string }[];
        }

        if (candidates.length === 0) throw new Error('无可删除的轮次消息');
        return this.softDeleteIds(projectId, threadId, candidates.map(row => row.id));
      });
      return { success: true, data: run() };
    } catch (error) {
      return failure(error);
    }
  }

  clearThread(projectId: string, threadId: string): IpcResult<ConversationCleanupResult> {
    try {
      const run = this.db.transaction((): ConversationCleanupResult => {
        this.requireThread(projectId, threadId);
        const active = this.db.prepare(`
          SELECT id FROM conversation_messages
          WHERE thread_id = ? AND deleted_at IS NULL
          ORDER BY sort_order ASC, timestamp ASC, id ASC
        `).all(threadId) as { id: string }[];

        if (active.length === 0) {
          return {
            batchId: null,
            threadId,
            deletedMessageIds: [],
            deletedAt: null,
            noop: true,
          };
        }
        return this.softDeleteIds(projectId, threadId, active.map(row => row.id));
      });
      return { success: true, data: run() };
    } catch (error) {
      return failure(error);
    }
  }

  restoreBatch(projectId: string, threadId: string, batchId: string): IpcResult<ConversationRestoreResult> {
    try {
      if (!batchId) throw new Error('批次 ID 不能为空');
      const run = this.db.transaction((): ConversationRestoreResult => {
        this.requireThread(projectId, threadId);
        const rows = this.db.prepare(`
          SELECT id FROM conversation_messages
          WHERE thread_id = ? AND deletion_batch_id = ? AND deleted_at IS NOT NULL
          ORDER BY sort_order ASC, timestamp ASC, id ASC
        `).all(threadId, batchId) as { id: string }[];
        if (rows.length === 0) throw new Error('批次不存在或不属于当前会话');

        this.db.prepare(`
          UPDATE conversation_messages
          SET deleted_at = NULL, deletion_batch_id = NULL
          WHERE thread_id = ? AND deletion_batch_id = ? AND deleted_at IS NOT NULL
        `).run(threadId, batchId);

        const now = new Date().toISOString();
        this.db.prepare(
          'UPDATE conversation_threads SET updated_at = ? WHERE id = ? AND project_id = ?',
        ).run(now, threadId, projectId);

        return {
          batchId,
          threadId,
          restoredMessageIds: rows.map(row => row.id),
        };
      });
      return { success: true, data: run() };
    } catch (error) {
      return failure(error);
    }
  }

  migrateLegacy(projectId: string, legacy: LegacyConversationData | null): IpcResult<LegacyMigrationResult> {
    try {
      const migrate = this.db.transaction((): LegacyMigrationResult => {
        const migrated = this.db.prepare(`
          SELECT 1 FROM data_migration_state
          WHERE project_id = ? AND migration_key = ?
        `).get(projectId, LEGACY_MIGRATION_KEY);
        if (migrated) return { status: 'already_migrated', threadCount: 0, messageCount: 0 };

        let threadCount = 0;
        let messageCount = 0;
        if (legacy) {
          validateLegacy(legacy);
          for (const thread of legacy.threads) {
            this.db.prepare(`
              INSERT INTO conversation_threads (id, project_id, title, category, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?)
            `).run(thread.id, projectId, thread.name || '旧对话', thread.category, thread.createdAt, thread.createdAt);
            threadCount += 1;
            const entries = legacy.messages[thread.id] ?? [];
            entries.forEach((message, sortOrder) => {
              this.db.prepare(`
                INSERT INTO conversation_messages
                  (id, thread_id, role, content, provider_id, timestamp, updated_at, sort_order, context_type)
                VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 'chat')
              `).run(message.id, thread.id, message.role, message.content, message.timestamp, message.timestamp, sortOrder);
              messageCount += 1;
            });
            const lastTimestamp = entries.at(-1)?.timestamp ?? thread.createdAt;
            this.db.prepare('UPDATE conversation_threads SET updated_at = ? WHERE id = ?').run(lastTimestamp, thread.id);
          }
        }

        this.db.prepare(`
          INSERT INTO data_migration_state (project_id, migration_key, completed_at)
          VALUES (?, ?, ?)
        `).run(projectId, LEGACY_MIGRATION_KEY, new Date().toISOString());
        return { status: legacy ? 'imported' : 'no_data', threadCount, messageCount };
      });
      return { success: true, data: migrate() };
    } catch (error) {
      return failure(error);
    }
  }

  private findThread(projectId: string, threadId: string): IpcResult<ConversationThread> {
    const row = this.db.prepare(
      'SELECT * FROM conversation_threads WHERE id = ? AND project_id = ?',
    ).get(threadId, projectId) as Record<string, unknown> | undefined;
    return row ? { success: true, data: rowToThread(row) } : { success: false, error: '会话不存在' };
  }

  private requireThread(projectId: string, threadId: string): void {
    const row = this.db.prepare(
      'SELECT id FROM conversation_threads WHERE id = ? AND project_id = ?',
    ).get(threadId, projectId);
    if (!row) throw new Error('会话不存在或不属于当前项目');
  }

  /** 单事务内将给定活跃消息打上同一软删批次，并 touch 线程 */
  private softDeleteIds(projectId: string, threadId: string, messageIds: string[]): ConversationCleanupResult {
    const batchId = uuidv4();
    const deletedAt = new Date().toISOString();
    const update = this.db.prepare(`
      UPDATE conversation_messages
      SET deleted_at = ?, deletion_batch_id = ?
      WHERE id = ? AND thread_id = ? AND deleted_at IS NULL
    `);
    for (const id of messageIds) {
      const result = update.run(deletedAt, batchId, id, threadId);
      if (result.changes === 0) throw new Error('消息状态已变化，无法软删');
    }
    this.db.prepare(
      'UPDATE conversation_threads SET updated_at = ? WHERE id = ? AND project_id = ?',
    ).run(deletedAt, threadId, projectId);
    return {
      batchId,
      threadId,
      deletedMessageIds: messageIds,
      deletedAt,
      noop: false,
    };
  }

  private findMessage(projectId: string, threadId: string, messageId: string): IpcResult<ConversationMessage> {
    const row = this.db.prepare(`
      SELECT message.* FROM conversation_messages message
      JOIN conversation_threads thread ON thread.id = message.thread_id
      WHERE message.id = ? AND message.thread_id = ? AND thread.project_id = ?
        AND message.deleted_at IS NULL
    `).get(messageId, threadId, projectId) as Record<string, unknown> | undefined;
    return row ? { success: true, data: rowToMessage(row) } : { success: false, error: '消息不存在' };
  }
}

function validateLegacy(legacy: LegacyConversationData): void {
  if (!Array.isArray(legacy.threads) || !legacy.messages || typeof legacy.messages !== 'object') {
    throw new Error('旧会话数据格式无效');
  }
  const knownThreadIds = new Set<string>();
  for (const thread of legacy.threads) {
    if (!thread?.id || !thread.createdAt || !VALID_CATEGORIES.has(thread.category)) throw new Error('旧会话数据格式无效');
    if (knownThreadIds.has(thread.id)) throw new Error('旧会话 ID 重复');
    knownThreadIds.add(thread.id);
    const entries = legacy.messages[thread.id] ?? [];
    if (!Array.isArray(entries)) throw new Error('旧消息数据格式无效');
    for (const message of entries) {
      if (!message?.id || !message.content || !message.timestamp || !VALID_ROLES.has(message.role)) {
        throw new Error('旧消息数据格式无效');
      }
    }
  }
  for (const threadId of Object.keys(legacy.messages)) {
    if (!knownThreadIds.has(threadId)) throw new Error('旧消息引用了不存在的会话');
  }
}

function rowToThread(row: Record<string, unknown>): ConversationThread {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    title: String(row.title),
    category: row.category as ConversationThread['category'],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rowToMessage(row: Record<string, unknown>): ConversationMessage {
  return {
    id: String(row.id),
    threadId: String(row.thread_id),
    role: row.role as ConversationMessage['role'],
    content: String(row.content),
    providerId: row.provider_id === null ? null : String(row.provider_id),
    contextType: String(row.context_type || 'chat'),
    sortOrder: Number(row.sort_order),
    createdAt: String(row.timestamp),
    updatedAt: String(row.updated_at),
  };
}

function failure<T>(error: unknown): IpcResult<T> {
  return { success: false, error: error instanceof Error ? error.message : String(error) };
}
