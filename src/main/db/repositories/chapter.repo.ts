import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { Chapter, IpcResult, PaginatedResult } from '../../../renderer/types';

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
}

export interface ReorderChaptersInput {
  projectId: string;
  chapterIds: string[];  // New order of IDs
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

    // Get max sort_order for project
    const maxSort = this.db.prepare(
      'SELECT COALESCE(MAX(sort_order), -1) as max_sort FROM chapters WHERE project_id = ?'
    ).get(input.projectId) as { max_sort: number };

    this.db.prepare(`
      INSERT INTO chapters (id, project_id, title, content, status, word_count, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?)
    `).run(id, input.projectId, title, content, 0, maxSort.max_sort + 1, now, now);

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
    const now = new Date().toISOString();
    const title = input.title ?? chapter.title;
    const content = input.content ?? chapter.content;
    const status = input.status ?? chapter.status;
    const wordCount = input.wordCount !== undefined ? input.wordCount : chapter.wordCount;

    this.db.prepare(`
      UPDATE chapters
      SET title = ?, content = ?, status = ?, word_count = ?, updated_at = ?
      WHERE id = ?
    `).run(title, content, status, wordCount, now, input.id);

    return this.findById(input.id);
  }

  remove(id: string): IpcResult<void> {
    const existing = this.findById(id);
    if (!existing.success) {
      return { success: false, error: 'Chapter not found' };
    }
    this.db.prepare('DELETE FROM chapters WHERE id = ?').run(id);
    return { success: true };
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
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }
}
