import Database from 'better-sqlite3';
import type { IpcResult } from '../../../renderer/types';

// ============================================================
// 伏笔追踪 — 数据访问层
// 管理 foreshadowings 表 CRUD（构造函数注入 db，与其他 repo 保持一致）
// ============================================================

export interface ForeshadowingRow {
  id: string;
  project_id: string;
  title: string;
  description: string;
  status: 'planted' | 'pending' | 'resolved';
  planted_chapter_id: string | null;
  resolved_chapter_id: string | null;
  related_characters: string;       // JSON 数组
  related_outline_nodes: string;    // JSON 数组
  note: string;
  created_at: string;
  updated_at: string;
}

export interface CreateForeshadowingInput {
  projectId: string;
  title?: string;
  description?: string;
  status?: string;
  plantedChapterId?: string | null;
  resolvedChapterId?: string | null;
  relatedCharacters?: string[];
  relatedOutlineNodes?: string[];
  note?: string;
}

export interface UpdateForeshadowingInput {
  title?: string;
  description?: string;
  status?: string;
  plantedChapterId?: string | null;
  resolvedChapterId?: string | null;
  relatedCharacters?: string[];
  relatedOutlineNodes?: string[];
  note?: string;
}

export class ForeshadowingRepo {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /** 获取项目的所有伏笔 */
  findByProject(projectId: string): IpcResult<ForeshadowingRow[]> {
    const rows = this.db.prepare(`
      SELECT * FROM foreshadowings WHERE project_id = ? ORDER BY created_at DESC
    `).all(projectId) as ForeshadowingRow[];
    return { success: true, data: rows };
  }

  /** 根据 ID 查找 */
  findById(id: string): IpcResult<ForeshadowingRow> {
    const row = this.db.prepare('SELECT * FROM foreshadowings WHERE id = ?').get(id) as ForeshadowingRow | undefined;
    if (!row) return { success: false, error: '伏笔不存在' };
    return { success: true, data: row };
  }

  /** 创建新伏笔 */
  create(input: CreateForeshadowingInput): IpcResult<ForeshadowingRow> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO foreshadowings (id, project_id, title, description, status, planted_chapter_id, resolved_chapter_id, related_characters, related_outline_nodes, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.projectId,
      input.title || '',
      input.description || '',
      input.status || 'planted',
      input.plantedChapterId || null,
      input.resolvedChapterId || null,
      JSON.stringify(input.relatedCharacters || []),
      JSON.stringify(input.relatedOutlineNodes || []),
      input.note || '',
      now,
      now,
    );
    return this.findById(id);
  }

  /** 更新伏笔 */
  update(id: string, input: UpdateForeshadowingInput): IpcResult<ForeshadowingRow> {
    const existing = this.findById(id);
    if (!existing.success || !existing.data) return { success: false, error: '伏笔不存在' };

    const row = existing.data;
    const now = new Date().toISOString();
    const title = input.title !== undefined ? input.title : row.title;
    const description = input.description !== undefined ? input.description : row.description;
    const status = input.status !== undefined ? input.status : row.status;
    const plantedChapterId = input.plantedChapterId !== undefined ? input.plantedChapterId : row.planted_chapter_id;
    const resolvedChapterId = input.resolvedChapterId !== undefined ? input.resolvedChapterId : row.resolved_chapter_id;
    const relatedCharacters = input.relatedCharacters !== undefined
      ? JSON.stringify(input.relatedCharacters)
      : row.related_characters;
    const relatedOutlineNodes = input.relatedOutlineNodes !== undefined
      ? JSON.stringify(input.relatedOutlineNodes)
      : row.related_outline_nodes;
    const note = input.note !== undefined ? input.note : row.note;

    this.db.prepare(`
      UPDATE foreshadowings
      SET title = ?, description = ?, status = ?, planted_chapter_id = ?, resolved_chapter_id = ?,
          related_characters = ?, related_outline_nodes = ?, note = ?, updated_at = ?
      WHERE id = ?
    `).run(title, description, status, plantedChapterId, resolvedChapterId, relatedCharacters, relatedOutlineNodes, note, now, id);

    return this.findById(id);
  }

  /** 删除伏笔 */
  remove(id: string): IpcResult<void> {
    const existing = this.findById(id);
    if (!existing.success) return { success: false, error: '伏笔不存在' };
    this.db.prepare('DELETE FROM foreshadowings WHERE id = ?').run(id);
    return { success: true };
  }

  /** 改变伏笔状态 */
  updateStatus(id: string, status: string, resolvedChapterId?: string | null): IpcResult<ForeshadowingRow> {
    return this.update(id, {
      status,
      resolvedChapterId: resolvedChapterId || undefined,
    });
  }
}
