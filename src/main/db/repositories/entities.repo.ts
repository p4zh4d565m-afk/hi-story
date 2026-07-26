import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { Character, IpcResult, WorldEntry } from '../../../renderer/types';

// ===== Character Repo =====
export interface CreateCharacterInput {
  projectId: string;
  name?: string;
  aliases?: string;
  appearance?: string;
  personality?: string;
  background?: string;
  arc?: string;
}

export interface UpdateCharacterInput {
  id: string;
  name?: string;
  aliases?: string;
  appearance?: string;
  personality?: string;
  background?: string;
  arc?: string;
  profileOutline?: string; // JSON 树: [{id, text, children}]
}

export class CharacterRepo {
  private db: Database.Database;
  constructor(db: Database.Database) { this.db = db; }

  create(input: CreateCharacterInput): IpcResult<Character> {
    const now = new Date().toISOString();
    const id = uuidv4();
    const maxSort = (this.db.prepare(
      'SELECT COALESCE(MAX(sort_order), -1) as m FROM characters WHERE project_id = ?'
    ).get(input.projectId) as { m: number }).m;

    this.db.prepare(`
      INSERT INTO characters (id, project_id, name, aliases, appearance, personality, background, arc, profile_outline, sort_order, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(id, input.projectId, input.name ?? '新角色', input.aliases ?? '', input.appearance ?? '',
           input.personality ?? '', input.background ?? '', input.arc ?? '', '[]', maxSort + 1, now, now);
    return this.findById(id);
  }

  findById(id: string): IpcResult<Character> {
    const row = this.db.prepare('SELECT * FROM characters WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return { success: false, error: 'Character not found' };
    return { success: true, data: rowToCharacter(row) };
  }

  findByProject(projectId: string): IpcResult<Character[]> {
    const rows = this.db.prepare('SELECT * FROM characters WHERE project_id = ? ORDER BY sort_order ASC').all(projectId) as Record<string, unknown>[];
    return { success: true, data: rows.map(rowToCharacter) };
  }

  update(input: UpdateCharacterInput): IpcResult<Character> {
    const ex = this.findById(input.id);
    if (!ex.success || !ex.data) return { success: false, error: 'Character not found' };
    const ch = ex.data; const now = new Date().toISOString();
    this.db.prepare(`UPDATE characters SET name=?, aliases=?, appearance=?, personality=?, background=?, arc=?, profile_outline=?, updated_at=? WHERE id=?`)
      .run(input.name ?? ch.name, input.aliases ?? ch.aliases, input.appearance ?? ch.appearance,
           input.personality ?? ch.personality, input.background ?? ch.background, input.arc ?? ch.arc,
           input.profileOutline !== undefined ? input.profileOutline : (ch as any).profileOutline ?? '[]', now, input.id);
    return this.findById(input.id);
  }

  remove(id: string): IpcResult<void> {
    if (!this.findById(id).success) return { success: false, error: 'Character not found' };
    this.db.prepare('DELETE FROM characters WHERE id = ?').run(id);
    return { success: true };
  }

  /** 恢复已删除的角色（保留原始 ID） */
  restore(ch: Character): IpcResult<Character> {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO characters (id, project_id, name, aliases, appearance, personality, background, arc, profile_outline, sort_order, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(ch.id, ch.projectId, ch.name, ch.aliases, ch.appearance,
           ch.personality, ch.background, ch.arc, (ch as any).profileOutline || '[]',
           ch.sortOrder, ch.createdAt, now);
    return this.findById(ch.id);
  }
}

function rowToCharacter(row: Record<string, unknown>): Character {
  return { id: row.id as string, projectId: row.project_id as string, name: row.name as string,
    aliases: row.aliases as string, appearance: row.appearance as string, personality: row.personality as string,
    background: row.background as string, arc: row.arc as string, profileOutline: (row.profile_outline as string) || '[]',
    sortOrder: row.sort_order as number,
    createdAt: row.created_at as string, updatedAt: row.updated_at as string };
}

// ===== WorldEntry Repo =====
export interface CreateWorldEntryInput {
  projectId: string;
  parentId?: string | null;
  category: WorldEntry['category'];
  name?: string;
  description?: string;
}

export interface UpdateWorldEntryInput {
  id: string;
  name?: string;
  description?: string;
  category?: WorldEntry['category'];
  parentId?: string | null;
}

export class WorldEntryRepo {
  private db: Database.Database;
  constructor(db: Database.Database) { this.db = db; }

  create(input: CreateWorldEntryInput): IpcResult<WorldEntry> {
    const now = new Date().toISOString(); const id = uuidv4();
    const pid = input.parentId ?? null;
    const maxSort = (this.db.prepare(
      "SELECT COALESCE(MAX(sort_order), -1) as m FROM world_entries WHERE project_id = ? AND parent_id IS ?"
    ).get(input.projectId, pid) as { m: number }).m;

    this.db.prepare(`INSERT INTO world_entries (id, project_id, parent_id, category, name, description, sort_order, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(id, input.projectId, pid, input.category, input.name ?? '新条目', input.description ?? '', maxSort + 1, now, now);
    return this.findById(id);
  }

  findById(id: string): IpcResult<WorldEntry> {
    const row = this.db.prepare('SELECT * FROM world_entries WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return { success: false, error: 'World entry not found' };
    return { success: true, data: rowToEntry(row) };
  }

  findByProject(projectId: string): IpcResult<WorldEntry[]> {
    const rows = this.db.prepare('SELECT * FROM world_entries WHERE project_id = ? ORDER BY sort_order ASC').all(projectId) as Record<string, unknown>[];
    return { success: true, data: rows.map(rowToEntry) };
  }

  update(input: UpdateWorldEntryInput): IpcResult<WorldEntry> {
    const ex = this.findById(input.id);
    if (!ex.success || !ex.data) return { success: false, error: 'World entry not found' };
    const e = ex.data; const now = new Date().toISOString();
    this.db.prepare(`UPDATE world_entries SET name=?, description=?, category=?, parent_id=?, updated_at=? WHERE id=?`)
      .run(input.name ?? e.name, input.description ?? e.description, input.category ?? e.category,
           input.parentId !== undefined ? input.parentId : e.parentId, now, input.id);
    return this.findById(input.id);
  }

  remove(id: string): IpcResult<void> {
    if (!this.findById(id).success) return { success: false, error: 'World entry not found' };
    this.db.prepare('DELETE FROM world_entries WHERE id = ?').run(id);
    return { success: true };
  }

  /** 恢复已删除的世界观条目（保留原始 ID） */
  restore(entry: WorldEntry): IpcResult<WorldEntry> {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO world_entries (id, project_id, parent_id, category, name, description, sort_order, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(entry.id, entry.projectId, entry.parentId, entry.category, entry.name, entry.description, entry.sortOrder, entry.createdAt, now);
    return this.findById(entry.id);
  }
}

function rowToEntry(row: Record<string, unknown>): WorldEntry {
  return { id: row.id as string, projectId: row.project_id as string, parentId: row.parent_id as string | null,
    category: row.category as WorldEntry['category'], name: row.name as string, description: row.description as string,
    sortOrder: row.sort_order as number, createdAt: row.created_at as string };
}

// ===== ReferenceLink Repo =====
export interface CreateReferenceLinkInput {
  sourceType: string;
  sourceId: string;
  targetType: string;
  targetId: string;
  relationType: string;
  arrowDirection?: string; // 'forward' | 'backward' | 'both' | 'none'
}

export class ReferenceLinkRepo {
  private db: Database.Database;
  constructor(db: Database.Database) { this.db = db; }

  create(input: CreateReferenceLinkInput): IpcResult<any> {
    const id = uuidv4(); const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO reference_links (id, source_type, source_id, target_type, target_id, relation_type, arrow_direction, created_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(id, input.sourceType, input.sourceId, input.targetType, input.targetId, input.relationType, input.arrowDirection || 'none', now);
    const row = this.db.prepare('SELECT * FROM reference_links WHERE id = ?').get(id) as Record<string, unknown>;
    return { success: true, data: { id: row.id, sourceType: row.source_type, sourceId: row.source_id,
      targetType: row.target_type, targetId: row.target_id, relationType: row.relation_type, arrowDirection: row.arrow_direction || 'none', createdAt: row.created_at } };
  }

  findBySource(sourceType: string, sourceId: string): IpcResult<any[]> {
    const rows = this.db.prepare('SELECT * FROM reference_links WHERE source_type = ? AND source_id = ? ORDER BY created_at DESC').all(sourceType, sourceId) as Record<string, unknown>[];
    return { success: true, data: rows.map(r => ({ id: r.id, sourceType: r.source_type, sourceId: r.source_id, targetType: r.target_type, targetId: r.target_id, relationType: r.relation_type, arrowDirection: r.arrow_direction || 'none', createdAt: r.created_at })) };
  }

  findByTarget(targetType: string, targetId: string): IpcResult<any[]> {
    const rows = this.db.prepare('SELECT * FROM reference_links WHERE target_type = ? AND target_id = ? ORDER BY created_at DESC').all(targetType, targetId) as Record<string, unknown>[];
    return { success: true, data: rows.map(r => ({ id: r.id, sourceType: r.source_type, sourceId: r.source_id, targetType: r.target_type, targetId: r.target_id, relationType: r.relation_type, arrowDirection: r.arrow_direction || 'none', createdAt: r.created_at })) };
  }

  findAllForEntity(entityType: string, entityId: string): IpcResult<any[]> {
    const rows = this.db.prepare(`SELECT * FROM reference_links WHERE (source_type = ? AND source_id = ?) OR (target_type = ? AND target_id = ?) ORDER BY created_at DESC`)
      .all(entityType, entityId, entityType, entityId) as Record<string, unknown>[];
    return { success: true, data: rows.map(r => ({ id: r.id, sourceType: r.source_type, sourceId: r.source_id, targetType: r.target_type, targetId: r.target_id, relationType: r.relation_type, arrowDirection: r.arrow_direction || 'none', createdAt: r.created_at })) };
  }

  findAllCharacterRelations(projectId: string): IpcResult<any[]> {
    const rows = this.db.prepare(`SELECT rl.* FROM reference_links rl WHERE rl.source_type = 'character' AND rl.target_type = 'character'
      AND rl.source_id IN (SELECT id FROM characters WHERE project_id = ?)`)
      .all(projectId) as Record<string, unknown>[];
    return { success: true, data: rows.map(r => ({ id: r.id, sourceType: r.source_type, sourceId: r.source_id, targetType: r.target_type, targetId: r.target_id, relationType: r.relation_type, arrowDirection: r.arrow_direction || 'none', createdAt: r.created_at })) };
  }

  remove(id: string): IpcResult<void> {
    const row = this.db.prepare('SELECT id FROM reference_links WHERE id = ?').get(id);
    if (!row) return { success: false, error: 'Reference link not found' };
    this.db.prepare('DELETE FROM reference_links WHERE id = ?').run(id);
    return { success: true };
  }

  /** 恢复已删除的关系链接（保留原始 ID） */
  restore(data: { id: string; sourceType: string; sourceId: string; targetType: string; targetId: string; relationType: string; arrowDirection?: string; createdAt: string }): IpcResult<any> {
    this.db.prepare(`
      INSERT INTO reference_links (id, source_type, source_id, target_type, target_id, relation_type, arrow_direction, created_at)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(data.id, data.sourceType, data.sourceId, data.targetType, data.targetId, data.relationType, data.arrowDirection || 'none', data.createdAt);
    const row = this.db.prepare('SELECT * FROM reference_links WHERE id = ?').get(data.id) as Record<string, unknown>;
    return { success: true, data: { id: row.id, sourceType: row.source_type, sourceId: row.source_id,
      targetType: row.target_type, targetId: row.target_id, relationType: row.relation_type, arrowDirection: row.arrow_direction || 'none', createdAt: row.created_at } };
  }
}
