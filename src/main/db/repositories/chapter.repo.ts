import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { Chapter, ChapterOutline, IpcResult } from '../../../renderer/types';
import type { ChapterHistorySnapshot } from '../../../renderer/types';
import {
  type ChapterPosition,
  normalizeChapterOrder,
  deleteChapter as deleteChapterOrder,
  restoreChapter as restoreChapterOrder,
} from '../../ai/narrative-time-order';

export interface CreateChapterInput {
  projectId: string;
  title?: string;
  content?: string;
  planningOutline?: ChapterOutline | null;
  planningOutlineId?: string | null;
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

function toPositions(
  rows: Array<{ id: string; project_id: string; sort_order: number | null; deleted_sort_order: number | null }>,
): ChapterPosition[] {
  return rows.map((r) => ({
    id: r.id,
    projectId: r.project_id,
    sortOrder: r.sort_order,
    deletedSortOrder: r.deleted_sort_order,
  }));
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
    const wordCount = content.replace(/<[^>]*>/g, '').replace(/\s+/g, '').length;

    const maxSort = this.db.prepare(
      `SELECT COALESCE(MAX(sort_order), -1) as max_sort FROM chapters
       WHERE project_id = ? AND deleted_at IS NULL`,
    ).get(input.projectId) as { max_sort: number };

    this.db.prepare(`
      INSERT INTO chapters (
        id, project_id, title, content, status, word_count, sort_order,
        planning_outline, planning_outline_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.projectId,
      title,
      content,
      wordCount,
      maxSort.max_sort + 1,
      input.planningOutline ? JSON.stringify(input.planningOutline) : '',
      input.planningOutlineId ?? input.planningOutline?.id ?? null,
      now,
      now,
    );

    return this.findById(id);
  }

  insertAfter(afterChapterId: string, title: string): IpcResult<Chapter> {
    const afterChapter = this.findById(afterChapterId);
    if (!afterChapter.success || !afterChapter.data) {
      return { success: false, error: '目标章节不存在' };
    }

    const chapter = afterChapter.data;
    const now = new Date().toISOString();
    const id = uuidv4();

    try {
      const tx = this.db.transaction(() => {
        this.db.prepare(`
          UPDATE chapters SET sort_order = sort_order + 1, updated_at = ?
          WHERE project_id = ? AND deleted_at IS NULL AND sort_order > ?
        `).run(now, chapter.projectId, chapter.sortOrder);

        this.db.prepare(`
          INSERT INTO chapters (id, project_id, title, content, status, word_count, sort_order, created_at, updated_at)
          VALUES (?, ?, ?, '', 'draft', 0, ?, ?, ?)
        `).run(id, chapter.projectId, title, chapter.sortOrder + 1, now, now);
      });
      tx();
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }

    return this.findById(id);
  }

  findById(id: string): IpcResult<Chapter> {
    const row = this.db.prepare(
      `SELECT * FROM chapters WHERE id = ? AND deleted_at IS NULL`,
    ).get(id) as Record<string, unknown> | undefined;

    if (!row) {
      return { success: false, error: 'Chapter not found' };
    }

    return { success: true, data: this.rowToChapter(row) };
  }

  /** 含墓碑；供 restore / as-of 内部使用 */
  findByIdIncludingDeleted(id: string): IpcResult<Chapter & { deletedAt?: string | null; deletedSortOrder?: number | null }> {
    const row = this.db.prepare(`SELECT * FROM chapters WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return { success: false, error: 'Chapter not found' };
    return { success: true, data: this.rowToChapterIncludingDeleted(row) };
  }

  findByProject(projectId: string): IpcResult<Chapter[]> {
    const rows = this.db.prepare(
      `SELECT * FROM chapters WHERE project_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC`,
    ).all(projectId) as Record<string, unknown>[];

    return {
      success: true,
      data: rows.map((r) => this.rowToChapter(r)),
    };
  }

  update(input: UpdateChapterInput): IpcResult<Chapter> {
    const existing = this.findById(input.id);
    if (!existing.success || !existing.data) {
      return { success: false, error: 'Chapter not found' };
    }

    const chapter = existing.data;
    if (input.content !== undefined && input.content !== chapter.content) {
      ChapterHistoryRepo.addSnapshot(this.db, chapter.id, chapter.content, chapter.wordCount);
    }

    const now = new Date().toISOString();
    const title = input.title ?? chapter.title;
    const content = input.content ?? chapter.content;
    const status = input.status ?? chapter.status;
    const wordCount = input.wordCount !== undefined ? input.wordCount : chapter.wordCount;
    const summary = input.summary !== undefined ? input.summary : chapter.summary ?? '';

    this.db.prepare(`
      UPDATE chapters
      SET title = ?, content = ?, status = ?, word_count = ?, summary = ?, updated_at = ?
      WHERE id = ? AND deleted_at IS NULL
    `).run(title, content, status, wordCount, summary, now, input.id);

    return this.findById(input.id);
  }

  /** 软删为墓碑；保留历史与叙事锚 */
  remove(id: string): IpcResult<void> {
    try {
      const tx = this.db.transaction(() => {
        const row = this.db.prepare(`SELECT * FROM chapters WHERE id = ?`).get(id) as
          | Record<string, unknown>
          | undefined;
        if (!row) throw new Error('Chapter not found');
        if (row.deleted_at != null) throw new Error('章节已是墓碑');

        const projectId = row.project_id as string;
        const all = this.db.prepare(
          `SELECT id, project_id, sort_order, deleted_sort_order FROM chapters WHERE project_id = ?`,
        ).all(projectId) as Array<{
          id: string;
          project_id: string;
          sort_order: number | null;
          deleted_sort_order: number | null;
        }>;

        const next = deleteChapterOrder(toPositions(all), id);
        this.persistPositions(projectId, next);
      });
      tx();
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  /**
   * 恢复：优先唤醒原 ID 墓碑；若行不存在则兼容旧 Undo 的 INSERT 路径。
   */
  restore(chapterData: Chapter): IpcResult<Chapter> {
    try {
      const tx = this.db.transaction(() => {
        const existing = this.db.prepare(`SELECT * FROM chapters WHERE id = ?`).get(chapterData.id) as
          | Record<string, unknown>
          | undefined;

        if (existing) {
          if (existing.deleted_at == null) {
            throw new Error('章节未删除，无需恢复');
          }
          const projectId = existing.project_id as string;
          const all = this.db.prepare(
            `SELECT id, project_id, sort_order, deleted_sort_order FROM chapters WHERE project_id = ?`,
          ).all(projectId) as Array<{
            id: string;
            project_id: string;
            sort_order: number | null;
            deleted_sort_order: number | null;
          }>;
          const next = restoreChapterOrder(toPositions(all), chapterData.id);
          this.persistPositions(projectId, next);
          this.db.prepare(`UPDATE chapters SET deleted_at = NULL, updated_at = ? WHERE id = ?`).run(
            new Date().toISOString(),
            chapterData.id,
          );
          return;
        }

        // 兼容：旧硬删 Undo 仍可能 INSERT
        const now = new Date().toISOString();
        const maxSort = this.db.prepare(
          `SELECT COALESCE(MAX(sort_order), -1) as max_sort FROM chapters
           WHERE project_id = ? AND deleted_at IS NULL`,
        ).get(chapterData.projectId) as { max_sort: number };
        const insertAt = Math.min(chapterData.sortOrder ?? maxSort.max_sort + 1, maxSort.max_sort + 1);

        this.db.prepare(`
          UPDATE chapters SET sort_order = sort_order + 1, updated_at = ?
          WHERE project_id = ? AND deleted_at IS NULL AND sort_order >= ?
        `).run(now, chapterData.projectId, insertAt);

        this.db.prepare(`
          INSERT INTO chapters (
            id, project_id, title, content, status, word_count, sort_order,
            planning_outline, planning_outline_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          chapterData.id,
          chapterData.projectId,
          chapterData.title,
          chapterData.content,
          chapterData.status,
          chapterData.wordCount,
          insertAt,
          chapterData.planningOutline ? JSON.stringify(chapterData.planningOutline) : '',
          chapterData.planningOutlineId ?? chapterData.planningOutline?.id ?? null,
          chapterData.createdAt,
          now,
        );
      });
      tx();
      return this.findById(chapterData.id);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  reorder(input: ReorderChaptersInput): IpcResult<void> {
    try {
      const tx = this.db.transaction(() => {
        const active = this.db.prepare(
          `SELECT id FROM chapters WHERE project_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC`,
        ).all(input.projectId) as Array<{ id: string }>;
        const activeIds = active.map((r) => r.id).sort();
        const incoming = [...input.chapterIds].sort();
        if (
          activeIds.length !== incoming.length ||
          activeIds.some((id, i) => id !== incoming[i])
        ) {
          throw new Error('reorder 必须恰好覆盖全部活跃章节且无跨项目/重复');
        }
        // 校验每条都属于本项目活跃
        for (const id of input.chapterIds) {
          const row = this.db.prepare(
            `SELECT project_id, deleted_at FROM chapters WHERE id = ?`,
          ).get(id) as { project_id: string; deleted_at: string | null } | undefined;
          if (!row || row.project_id !== input.projectId || row.deleted_at != null) {
            throw new Error('reorder 含非法章节');
          }
        }

        const now = new Date().toISOString();
        const stmt = this.db.prepare(
          `UPDATE chapters SET sort_order = ?, updated_at = ? WHERE id = ? AND project_id = ? AND deleted_at IS NULL`,
        );
        input.chapterIds.forEach((id, index) => {
          stmt.run(index, now, id, input.projectId);
        });
      });
      tx();
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  countByProject(projectId: string): number {
    const row = this.db.prepare(
      `SELECT COUNT(*) as count FROM chapters WHERE project_id = ? AND deleted_at IS NULL`,
    ).get(projectId) as { count: number };
    return row.count;
  }

  totalWordsByProject(projectId: string): number {
    const row = this.db.prepare(
      `SELECT COALESCE(SUM(word_count), 0) as total FROM chapters WHERE project_id = ? AND deleted_at IS NULL`,
    ).get(projectId) as { total: number };
    return row.total;
  }

  private persistPositions(projectId: string, positions: ChapterPosition[]): void {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE chapters
      SET sort_order = ?, deleted_sort_order = ?, deleted_at = CASE
        WHEN ? IS NULL THEN COALESCE(deleted_at, ?)
        ELSE NULL
      END,
      updated_at = ?
      WHERE id = ? AND project_id = ?
    `);
    // 更清晰：分活跃与墓碑写
    for (const p of positions) {
      if (p.projectId !== projectId) throw new Error('跨项目章节不可规范化');
      if (p.sortOrder === null) {
        this.db.prepare(`
          UPDATE chapters
          SET sort_order = NULL, deleted_sort_order = ?, deleted_at = COALESCE(deleted_at, ?), updated_at = ?
          WHERE id = ? AND project_id = ?
        `).run(p.deletedSortOrder, now, now, p.id, projectId);
      } else {
        this.db.prepare(`
          UPDATE chapters
          SET sort_order = ?, deleted_sort_order = NULL, deleted_at = NULL, updated_at = ?
          WHERE id = ? AND project_id = ?
        `).run(p.sortOrder, now, p.id, projectId);
      }
    }
    void stmt;
    void normalizeChapterOrder;
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
      planningOutline: (() => {
        try {
          return row.planning_outline ? JSON.parse(String(row.planning_outline)) : null;
        } catch {
          return null;
        }
      })(),
      planningOutlineId: (row.planning_outline_id as string | null | undefined) ?? null,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  private rowToChapterIncludingDeleted(
    row: Record<string, unknown>,
  ): Chapter & { deletedAt?: string | null; deletedSortOrder?: number | null } {
    return {
      ...this.rowToChapter({
        ...row,
        sort_order: row.sort_order ?? row.deleted_sort_order ?? 0,
      }),
      deletedAt: (row.deleted_at as string | null) ?? null,
      deletedSortOrder: (row.deleted_sort_order as number | null) ?? null,
    };
  }
}

// ============================================================
// 章节历史版本
// ============================================================

const MAX_SNAPSHOTS_PER_CHAPTER = 30;

export class ChapterHistoryRepo {
  static addSnapshot(db: Database.Database, chapterId: string, content: string, wordCount: number): void {
    if (!content || content.trim().length === 0) return;

    const id = uuidv4();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO chapter_history (id, chapter_id, content, word_count, saved_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, chapterId, content, wordCount, now);

    const count = (db.prepare(
      'SELECT COUNT(*) as cnt FROM chapter_history WHERE chapter_id = ?',
    ).get(chapterId) as { cnt: number }).cnt;

    if (count > MAX_SNAPSHOTS_PER_CHAPTER) {
      db.prepare(`
        DELETE FROM chapter_history WHERE id IN (
          SELECT id FROM chapter_history WHERE chapter_id = ? ORDER BY saved_at ASC LIMIT ?
        )
      `).run(chapterId, count - MAX_SNAPSHOTS_PER_CHAPTER);
    }
  }

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
        data: rows.map((r) => ({
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

  static restoreSnapshot(db: Database.Database, snapshotId: string): IpcResult<Chapter> {
    try {
      const snapshot = db.prepare(
        'SELECT * FROM chapter_history WHERE id = ?',
      ).get(snapshotId) as Record<string, unknown> | undefined;

      if (!snapshot) {
        return { success: false, error: '快照不存在' };
      }

      const chapterId = snapshot.chapter_id as string;
      const content = snapshot.content as string;
      const wordCount = snapshot.word_count as number;
      const now = new Date().toISOString();

      const current = db.prepare(
        'SELECT content, word_count FROM chapters WHERE id = ? AND deleted_at IS NULL',
      ).get(chapterId) as { content: string; word_count: number } | undefined;
      if (current) {
        ChapterHistoryRepo.addSnapshot(db, chapterId, current.content, current.word_count);
      }

      db.prepare(
        'UPDATE chapters SET content = ?, word_count = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
      ).run(content, wordCount, now, chapterId);

      const row = db.prepare(
        'SELECT * FROM chapters WHERE id = ? AND deleted_at IS NULL',
      ).get(chapterId) as Record<string, unknown> | undefined;
      if (!row) return { success: false, error: 'Chapter not found' };

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
          planningOutline: (() => {
            try {
              return row.planning_outline ? JSON.parse(String(row.planning_outline)) : null;
            } catch {
              return null;
            }
          })(),
          planningOutlineId: (row.planning_outline_id as string | null | undefined) ?? null,
          createdAt: row.created_at as string,
          updatedAt: row.updated_at as string,
        },
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }
}
