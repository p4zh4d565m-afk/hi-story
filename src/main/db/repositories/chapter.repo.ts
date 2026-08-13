import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { Chapter, IpcResult } from '../../../renderer/types';
import type { ChapterHistorySnapshot } from '../../../renderer/types';

export interface CreateChapterInput {
  projectId: string;
  title?: string;
  content?: string;
}

export interface UpdateChapterInput {
  id: string;
  title?: string;
  content?: string;
  status?: 'draft' | 'final';
  wordCount?: number;
  summary?: string;
}

export interface ReorderChaptersInput {
  projectId: string;
  chapterIds: string[];
}

export class ChapterRepo {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  create(input: CreateChapterInput): IpcResult<Chapter> {
    const now = new Date().toISOString();
    const id = uuidv4();
    const title = input.title ?? '未命名章节';
    const content = input.content ?? '';

    const maxSort = this.db.prepare(
      'SELECT COALESCE(MAX(sort_order), -1) as max_sort FROM chapters WHERE project_id = ?'
    ).get(input.projectId) as { max_sort: number };

    this.db.prepare(`
      INSERT INTO chapters (id, project_id, title, content, status, word_count, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?)
    `).run(id, input.projectId, title, content, 0, maxSort.max_sort + 1, now, now);

    return this.findById(id);
  }

  /** 在指定章节之后插入新章节，自动调整后续章节的排序 */
  insertAfter(afterChapterId: string, title: string): IpcResult<Chapter> {
    const afterChapter = this.findById(afterChapterId);
    if (!afterChapter.success || !afterChapter.data) {
      return { success: false, error: '目标章节不存在' };
    }

    const chapter = afterChapter.data;
    const now = new Date().toISOString();
    const id = uuidv4();

    // 在事务中完成：把排在后面的章节顺移一位 + 插入新章节
    const tx = this.db.transaction(() => {
      // 将所有 sort_order > afterChapter.sortOrder 的章节后移
      this.db.prepare(`
        UPDATE chapters SET sort_order = sort_order + 1, updated_at = ?
        WHERE project_id = ? AND sort_order > ?
      `).run(now, chapter.projectId, chapter.sortOrder);

      // 插入新章节到 afterChapter 之后
      this.db.prepare(`
        INSERT INTO chapters (id, project_id, title, content, status, word_count, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, '', 'draft', 0, ?, ?, ?)
      `).run(id, chapter.projectId, title, chapter.sortOrder + 1, now, now);
    });

    tx();
    return this.findById(id);
  }

  findById(id: string): IpcResult<Chapter> {
    const row = this.db.prepare(
      'SELECT * FROM chapters WHERE id = ?'
    ).get(id) as Record<string, unknown> | undefined;

    if (!row) {
      return { success: false, error: 'Chapter not found' };
    }

    return { success: true, data: this.rowToChapter(row) };
  }

  findByProject(projectId: string): IpcResult<Chapter[]> {
    const rows = this.db.prepare(
      'SELECT * FROM chapters WHERE project_id = ? ORDER BY sort_order ASC'
    ).all(projectId) as Record<string, unknown>[];

    return {
      success: true,
      data: rows.map(r => this.rowToChapter(r)),
    };
  }

  update(input: UpdateChapterInput): IpcResult<Chapter> {
    const existing = this.findById(input.id);
    if (!existing.success || !existing.data) {
      return { success: false, error: 'Chapter not found' };
    }

    const chapter = existing.data;
    // 如果内容有变化，先保存历史快照
    if (input.content !== undefined && input.content !== chapter.content) {
      ChapterHistoryRepo.addSnapshot(this.db, chapter.id, chapter.content, chapter.wordCount);
    }

    const now = new Date().toISOString();
    const title = input.title ?? chapter.title;
    const content = input.content ?? chapter.content;
    const status = input.status ?? chapter.status;
    const wordCount = input.wordCount !== undefined ? input.wordCount : chapter.wordCount;
    const summary = input.summary !== undefined ? input.summary : (chapter as any).summary ?? '';

    this.db.prepare(`
      UPDATE chapters
      SET title = ?, content = ?, status = ?, word_count = ?, summary = ?, updated_at = ?
      WHERE id = ?
    `).run(title, content, status, wordCount, summary, now, input.id);

    return this.findById(input.id);
  }

  remove(id: string): IpcResult<void> {
    const existing = this.findById(id);
    if (!existing.success) {
      return { success: false, error: 'Chapter not found' };
    }
    // 删除章节时，历史快照通过 ON DELETE CASCADE 自动清理
    this.db.prepare('DELETE FROM chapters WHERE id = ?').run(id);
    return { success: true };
  }

  /** 恢复已删除的章节（保留原始 ID） */
  restore(chapterData: Chapter): IpcResult<Chapter> {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO chapters (id, project_id, title, content, status, word_count, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      chapterData.id, chapterData.projectId, chapterData.title, chapterData.content,
      chapterData.status, chapterData.wordCount, chapterData.sortOrder,
      chapterData.createdAt, now
    );
    return this.findById(chapterData.id);
  }

  reorder(input: ReorderChaptersInput): IpcResult<void> {
    const stmt = this.db.prepare(
      'UPDATE chapters SET sort_order = ?, updated_at = ? WHERE id = ? AND project_id = ?'
    );
    const now = new Date().toISOString();

    const tx = this.db.transaction(() => {
      input.chapterIds.forEach((id, index) => {
        stmt.run(index, now, id, input.projectId);
      });
    });

    tx();
    return { success: true };
  }

  countByProject(projectId: string): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) as count FROM chapters WHERE project_id = ?'
    ).get(projectId) as { count: number };
    return row.count;
  }

  totalWordsByProject(projectId: string): number {
    const row = this.db.prepare(
      'SELECT COALESCE(SUM(word_count), 0) as total FROM chapters WHERE project_id = ?'
    ).get(projectId) as { total: number };
    return row.total;
  }

  private rowToChapter(row: Record<string, unknown>): Chapter {
    return {
      id: row.id as string,
      projectId: row.project_id as string,
      title: row.title as string,
      content: row.content as string,
      status: row.status as 'draft' | 'final',
      wordCount: row.word_count as number,
      sortOrder: row.sort_order as number,
      summary: (row.summary ?? '') as string,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }
}

// ============================================================
// 章节历史版本
// ============================================================

const MAX_SNAPSHOTS_PER_CHAPTER = 30;  // 每章最多保留 30 个快照
const MAX_SNAPSHOT_AGE_DAYS = 7;       // 超过 7 天的自动清理

export class ChapterHistoryRepo {
  /** 在章节更新前保存快照 */
  static addSnapshot(db: Database.Database, chapterId: string, content: string, wordCount: number): void {
    if (!content || content.trim().length === 0) return; // 不保存空白内容

    const id = uuidv4();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO chapter_history (id, chapter_id, content, word_count, saved_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, chapterId, content, wordCount, now);

    // 清理超出上限的旧快照
    const count = (db.prepare(
      'SELECT COUNT(*) as cnt FROM chapter_history WHERE chapter_id = ?'
    ).get(chapterId) as { cnt: number }).cnt;

    if (count > MAX_SNAPSHOTS_PER_CHAPTER) {
      db.prepare(`
        DELETE FROM chapter_history WHERE id IN (
          SELECT id FROM chapter_history WHERE chapter_id = ? ORDER BY saved_at ASC LIMIT ?
        )
      `).run(chapterId, count - MAX_SNAPSHOTS_PER_CHAPTER);
    }

    // 清理过期快照
    const cutoff = new Date(Date.now() - MAX_SNAPSHOT_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('DELETE FROM chapter_history WHERE chapter_id = ? AND saved_at < ?').run(chapterId, cutoff);
  }

  /** 获取章节的所有历史快照（最新的在前） */
  static getSnapshots(db: Database.Database, chapterId: string): IpcResult<ChapterHistorySnapshot[]> {
    try {
      const rows = db.prepare(`
        SELECT id, chapter_id, content, word_count, saved_at
        FROM chapter_history
        WHERE chapter_id = ?
        ORDER BY saved_at DESC
      `).all(chapterId) as Record<string, unknown>[];

      return {
        success: true,
        data: rows.map(r => ({
          id: r.id as string,
          chapterId: r.chapter_id as string,
          content: r.content as string,
          wordCount: r.word_count as number,
          savedAt: r.saved_at as string,
        })),
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  /** 用某个快照的内容恢复章节 */
  static restoreSnapshot(db: Database.Database, snapshotId: string): IpcResult<Chapter> {
    try {
      const snapshot = db.prepare(
        'SELECT * FROM chapter_history WHERE id = ?'
      ).get(snapshotId) as Record<string, unknown> | undefined;

      if (!snapshot) {
        return { success: false, error: '快照不存在' };
      }

      const chapterId = snapshot.chapter_id as string;
      const content = snapshot.content as string;
      const wordCount = snapshot.word_count as number;
      const now = new Date().toISOString();

      // 恢复前先保存当前版本
      const current = db.prepare('SELECT content, word_count FROM chapters WHERE id = ?').get(chapterId) as { content: string; word_count: number } | undefined;
      if (current) {
        ChapterHistoryRepo.addSnapshot(db, chapterId, current.content, current.word_count);
      }

      // 用快照内容更新章节
      db.prepare('UPDATE chapters SET content = ?, word_count = ?, updated_at = ? WHERE id = ?')
        .run(content, wordCount, now, chapterId);

      // 返回更新后的章节
      const row = db.prepare('SELECT * FROM chapters WHERE id = ?').get(chapterId) as Record<string, unknown>;
      return {
        success: true,
        data: {
          id: row.id as string,
          projectId: row.project_id as string,
          title: row.title as string,
          content: row.content as string,
          status: row.status as 'draft' | 'final',
          wordCount: row.word_count as number,
          sortOrder: row.sort_order as number,
          summary: (row.summary as string) || '',
          createdAt: row.created_at as string,
          updatedAt: row.updated_at as string,
        },
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }
}
