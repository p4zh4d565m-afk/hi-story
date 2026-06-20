import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { OutlineNode, IpcResult } from '../../../renderer/types';

export interface CreateOutlineNodeInput {
  projectId: string;
  parentId?: string | null;
  title?: string;
  summary?: string;
}

export interface UpdateOutlineNodeInput {
  id: string;
  title?: string;
  summary?: string;
  parentId?: string | null;
}

export interface ReorderOutlineNodesInput {
  projectId: string;
  nodeIds: string[];  // New order (DFS pre-order)
}

export class OutlineNodeRepo {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  create(input: CreateOutlineNodeInput): IpcResult<OutlineNode> {
    const now = new Date().toISOString();
    const id = uuidv4();
    const title = input.title ?? '新节点';
    const summary = input.summary ?? '';
    const parentId = input.parentId ?? null;

    // Get max sort_order among siblings
    const maxSort = this.db.prepare(
      'SELECT COALESCE(MAX(sort_order), -1) as max_sort FROM outline_nodes WHERE project_id = ? AND parent_id IS ?'
    ).get(input.projectId, parentId) as { max_sort: number };

    this.db.prepare(`
      INSERT INTO outline_nodes (id, project_id, parent_id, title, summary, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.projectId, parentId, title, summary, maxSort.max_sort + 1, now, now);

    return this.findById(id);
  }

  findById(id: string): IpcResult<OutlineNode> {
    const row = this.db.prepare(
      'SELECT * FROM outline_nodes WHERE id = ?'
    ).get(id) as Record<string, unknown> | undefined;

    if (!row) {
      return { success: false, error: 'Outline node not found' };
    }

    return { success: true, data: { ...this.rowToNode(row) } };
  }

  findByProject(projectId: string): IpcResult<OutlineNode[]> {
    const rows = this.db.prepare(
      'SELECT * FROM outline_nodes WHERE project_id = ? ORDER BY sort_order ASC'
    ).all(projectId) as Record<string, unknown>[];

    return {
      success: true,
      data: rows.map(r => this.rowToNode(r)),
    };
  }

  update(input: UpdateOutlineNodeInput): IpcResult<OutlineNode> {
    const existing = this.findById(input.id);
    if (!existing.success || !existing.data) {
      return { success: false, error: 'Outline node not found' };
    }

    const node = existing.data;
    const now = new Date().toISOString();
    const title = input.title ?? node.title;
    const summary = input.summary ?? node.summary;
    const parentId = input.parentId !== undefined ? input.parentId : node.parentId;

    this.db.prepare(`
      UPDATE outline_nodes
      SET title = ?, summary = ?, parent_id = ?, updated_at = ?
      WHERE id = ?
    `).run(title, summary, parentId, now, input.id);

    return this.findById(input.id);
  }

  remove(id: string): IpcResult<void> {
    const existing = this.findById(id);
    if (!existing.success) {
      return { success: false, error: 'Outline node not found' };
    }

    // Move children to parent of removed node, or null (root level)
    const node = existing.data!;
    this.db.prepare(
      'UPDATE outline_nodes SET parent_id = ? WHERE parent_id = ?'
    ).run(node.parentId, id);

    this.db.prepare('DELETE FROM outline_nodes WHERE id = ?').run(id);
    return { success: true };
  }

  /** Remove all nodes belonging to a project (for cascade cleanup) */
  removeByProject(projectId: string): void {
    this.db.prepare('DELETE FROM outline_nodes WHERE project_id = ?').run(projectId);
  }

  reorder(input: ReorderOutlineNodesInput): IpcResult<void> {
    const stmt = this.db.prepare(
      'UPDATE outline_nodes SET sort_order = ?, updated_at = ? WHERE id = ? AND project_id = ?'
    );
    const now = new Date().toISOString();

    const tx = this.db.transaction(() => {
      input.nodeIds.forEach((id, index) => {
        stmt.run(index, now, id, input.projectId);
      });
    });

    tx();
    return { success: true };
  }

  countByProject(projectId: string): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) as count FROM outline_nodes WHERE project_id = ?'
    ).get(projectId) as { count: number };
    return row.count;
  }

  private rowToNode(row: Record<string, unknown>): OutlineNode {
    return {
      id: row.id as string,
      projectId: row.project_id as string,
      parentId: row.parent_id as string | null,
      title: row.title as string,
      summary: row.summary as string,
      sortOrder: row.sort_order as number,
    };
  }
}
