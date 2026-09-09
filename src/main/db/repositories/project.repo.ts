import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { Project, CreateProjectInput, UpdateProjectInput, PaginatedResult, IpcResult } from '../../../renderer/types';

export class ProjectRepo {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  create(input: CreateProjectInput): IpcResult<Project> {
    const now = new Date().toISOString();
    const id = uuidv4();
    const tags = JSON.stringify(input.typeTags ?? []);
    const style = input.style ?? '';
    const summary = input.summary ?? '';
    const obsidianPath = input.obsidianPath ?? '';

    const stmt = this.db.prepare(`
      INSERT INTO projects (id, name, type_tags, style, summary, obsidian_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(id, input.name, tags, style, summary, obsidianPath, now, now);

    return this.findById(id);
  }

  findById(id: string): IpcResult<Project> {
    const row = this.db.prepare(
      'SELECT * FROM projects WHERE id = ?'
    ).get(id) as Record<string, unknown> | undefined;

    if (!row) {
      return { success: false, error: 'Project not found' };
    }

    return { success: true, data: this.rowToProject(row) };
  }

  findAll(limit = 50, offset = 0): IpcResult<PaginatedResult<Project>> {
    const total = (this.db.prepare(
      'SELECT COUNT(*) as count FROM projects'
    ).get() as { count: number }).count;

    const rows = this.db.prepare(
      'SELECT * FROM projects ORDER BY updated_at DESC LIMIT ? OFFSET ?'
    ).all(limit, offset) as Record<string, unknown>[];

    return {
      success: true,
      data: {
        items: rows.map(r => this.rowToProject(r)),
        total,
      },
    };
  }

  update(input: UpdateProjectInput): IpcResult<Project> {
    const existing = this.findById(input.id);
    if (!existing.success || !existing.data) {
      return { success: false, error: 'Project not found' };
    }

    const project = existing.data;
    const now = new Date().toISOString();
    const name = input.name ?? project.name;
    const typeTags = input.typeTags !== undefined
      ? JSON.stringify(input.typeTags)
      : JSON.stringify(project.typeTags);
    const style = input.style ?? project.style;
    const summary = input.summary ?? project.summary;
    const obsidianPath = input.obsidianPath ?? project.obsidianPath;

    this.db.prepare(`
      UPDATE projects
      SET name = ?, type_tags = ?, style = ?, summary = ?, obsidian_path = ?, updated_at = ?
      WHERE id = ?
    `).run(name, typeTags, style, summary, obsidianPath, now, input.id);

    return this.findById(input.id);
  }

  remove(id: string): IpcResult<void> {
    const existing = this.findById(id);
    if (!existing.success) {
      return { success: false, error: 'Project not found' };
    }

    this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    return { success: true };
  }

  private rowToProject(row: Record<string, unknown>): Project {
    return {
      id: row.id as string,
      name: row.name as string,
      typeTags: JSON.parse(row.type_tags as string) as string[],
      style: row.style as string,
      summary: row.summary as string,
      obsidianPath: (row.obsidian_path as string | undefined) ?? '',
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }
}
