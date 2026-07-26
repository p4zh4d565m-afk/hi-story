import { getRepo } from './repo-factory';
import type { Foreshadowing, CreateForeshadowingInput, UpdateForeshadowingInput } from '../types';

/**
 * 伏笔追踪 — 数据访问层
 * 管理 foreshadowings 表 CRUD
 */
export class ForeshadowingRepo {
  /** 获取项目的所有伏笔 */
  static findByProject(projectId: string): Foreshadowing[] {
    const db = getRepo();
    return db.prepare(`
      SELECT * FROM foreshadowings WHERE project_id = ? ORDER BY created_at DESC
    `).all(projectId) as Foreshadowing[];
  }

  /** 根据 ID 查找 */
  static findById(id: string): Foreshadowing | undefined {
    const db = getRepo();
    return db.prepare('SELECT * FROM foreshadowings WHERE id = ?').get(id) as Foreshadowing | undefined;
  }

  /** 创建新伏笔 */
  static create(input: CreateForeshadowingInput): Foreshadowing {
    const db = getRepo();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO foreshadowings (id, project_id, title, description, status, planted_chapter_id, related_characters, related_outline_nodes, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.projectId,
      input.title || '',
      input.description || '',
      input.status || 'planted',
      input.plantedChapterId || null,
      JSON.stringify(input.relatedCharacters || []),
      JSON.stringify(input.relatedOutlineNodes || []),
      input.note || '',
      now,
      now,
    );
    return this.findById(id)!;
  }

  /** 更新伏笔 */
  static update(id: string, input: Partial<UpdateForeshadowingInput>): Foreshadowing | undefined {
    const db = getRepo();
    const existing = this.findById(id);
    if (!existing) return undefined;

    const now = new Date().toISOString();
    const title = input.title !== undefined ? input.title : existing.title;
    const description = input.description !== undefined ? input.description : existing.description;
    const status = input.status !== undefined ? input.status : existing.status;
    const plantedChapterId = input.plantedChapterId !== undefined ? input.plantedChapterId : existing.planted_chapter_id;
    const resolvedChapterId = input.resolvedChapterId !== undefined ? input.resolvedChapterId : existing.resolved_chapter_id;
    const relatedCharacters = input.relatedCharacters !== undefined
      ? JSON.stringify(input.relatedCharacters)
      : existing.related_characters;
    const relatedOutlineNodes = input.relatedOutlineNodes !== undefined
      ? JSON.stringify(input.relatedOutlineNodes)
      : existing.related_outline_nodes;
    const note = input.note !== undefined ? input.note : existing.note;

    db.prepare(`
      UPDATE foreshadowings
      SET title = ?, description = ?, status = ?, planted_chapter_id = ?, resolved_chapter_id = ?,
          related_characters = ?, related_outline_nodes = ?, note = ?, updated_at = ?
      WHERE id = ?
    `).run(title, description, status, plantedChapterId, resolvedChapterId, relatedCharacters, relatedOutlineNodes, note, now, id);

    return this.findById(id)!;
  }

  /** 删除伏笔 */
  static remove(id: string): void {
    const db = getRepo();
    db.prepare('DELETE FROM foreshadowings WHERE id = ?').run(id);
  }

  /** 改变伏笔状态 */
  static updateStatus(id: string, status: Foreshadowing['status'], resolvedChapterId?: string | null): Foreshadowing | undefined {
    return this.update(id, { status, resolvedChapterId: resolvedChapterId || undefined });
  }
}
