import { getDb } from '../db/connection';
import { CharacterRepo, type CreateCharacterInput, type UpdateCharacterInput } from '../db/repositories/entities.repo';
import { WorldEntryRepo, type CreateWorldEntryInput, type UpdateWorldEntryInput } from '../db/repositories/entities.repo';
import { ReferenceLinkRepo, type CreateReferenceLinkInput } from '../db/repositories/entities.repo';
import { SearchEngine } from '../ai/search-engine';
import { v4 as uuidv4 } from 'uuid';

import { ipcMain } from 'electron';

function c() { return new CharacterRepo(getDb()); }
function w() { return new WorldEntryRepo(getDb()); }
function r() { return new ReferenceLinkRepo(getDb()); }
function s() { return new SearchEngine(getDb()); }


export function registerCharacterIpc(): void {
  ipcMain.handle('db:character:create', (_e, i: CreateCharacterInput) => { try { return c().create(i); } catch (err) { return { success: false, error: (err as Error).message }; } });
  ipcMain.handle('db:character:findById', (_e, id: string) => { try { return c().findById(id); } catch (err) { return { success: false, error: (err as Error).message }; } });
  ipcMain.handle('db:character:findByProject', (_e, pid: string) => { try { return c().findByProject(pid); } catch (err) { return { success: false, error: (err as Error).message }; } });
  ipcMain.handle('db:character:update', (_e, i: UpdateCharacterInput) => { try { return c().update(i); } catch (err) { return { success: false, error: (err as Error).message }; } });
  ipcMain.handle('db:character:remove', (_e, id: string) => { try { return c().remove(id); } catch (err) { return { success: false, error: (err as Error).message }; } });
  ipcMain.handle('db:character:restore', (_e, data: any) => { try { return c().restore(data); } catch (err) { return { success: false, error: (err as Error).message }; } });
}

export function registerWorldEntryIpc(): void {
  ipcMain.handle('db:worldEntry:create', (_e, i: CreateWorldEntryInput) => { try { return w().create(i); } catch (err) { return { success: false, error: (err as Error).message }; } });
  ipcMain.handle('db:worldEntry:findById', (_e, id: string) => { try { return w().findById(id); } catch (err) { return { success: false, error: (err as Error).message }; } });
  ipcMain.handle('db:worldEntry:findByProject', (_e, pid: string) => { try { return w().findByProject(pid); } catch (err) { return { success: false, error: (err as Error).message }; } });
  ipcMain.handle('db:worldEntry:update', (_e, i: UpdateWorldEntryInput) => { try { return w().update(i); } catch (err) { return { success: false, error: (err as Error).message }; } });
  ipcMain.handle('db:worldEntry:remove', (_e, id: string) => { try { return w().remove(id); } catch (err) { return { success: false, error: (err as Error).message }; } });
  ipcMain.handle('db:worldEntry:restore', (_e, data: any) => { try { return w().restore(data); } catch (err) { return { success: false, error: (err as Error).message }; } });
}

export function registerReferenceLinkIpc(): void {
  ipcMain.handle('db:referenceLink:create', (_e, i: CreateReferenceLinkInput) => { try { return r().create(i); } catch (err) { return { success: false, error: (err as Error).message }; } });
  ipcMain.handle('db:referenceLink:findBySource', (_e, type: string, id: string) => { try { return r().findBySource(type, id); } catch (err) { return { success: false, error: (err as Error).message }; } });
  ipcMain.handle('db:referenceLink:findByTarget', (_e, type: string, id: string) => { try { return r().findByTarget(type, id); } catch (err) { return { success: false, error: (err as Error).message }; } });
  ipcMain.handle('db:referenceLink:findAllForEntity', (_e, type: string, id: string) => { try { return r().findAllForEntity(type, id); } catch (err) { return { success: false, error: (err as Error).message }; } });
  ipcMain.handle('db:referenceLink:findAllCharacterRelations', (_e, pid: string) => { try { return r().findAllCharacterRelations(pid); } catch (err) { return { success: false, error: (err as Error).message }; } });
  ipcMain.handle('db:referenceLink:remove', (_e, id: string) => { try { return r().remove(id); } catch (err) { return { success: false, error: (err as Error).message }; } });
  ipcMain.handle('db:referenceLink:restore', (_e, data: any) => { try { return r().restore(data); } catch (err) { return { success: false, error: (err as Error).message }; } });
}

export function registerSearchIpc(): void {
  ipcMain.handle('search:query', (_e, options: { query: string; layers?: string[]; maxResultsPerLayer?: number }) => {
    try {
      const engine = s();
      return { success: true, data: engine.search(options) };
    } catch (err) { return { success: false, error: (err as Error).message }; }
  });

  // Material CRUD for user-collected materials
  ipcMain.handle('db:material:create', (_e, input: { projectId?: string; title: string; content: string; sourceLayer?: string; url?: string; tags?: string[] }) => {
    try {
      const db = getDb();
      const id = uuidv4();
      const now = new Date().toISOString();
      const tags = JSON.stringify(input.tags || []);
      db.prepare(`INSERT INTO materials (id, project_id, source_layer, title, content, url, tags, created_at)
        VALUES (?,?,?,?,?,?,?,?)`)
        .run(id, input.projectId || null, input.sourceLayer || 'user', input.title, input.content || '', input.url || null, tags, now);
      const row = db.prepare('SELECT * FROM materials WHERE id = ?').get(id) as Record<string, unknown>;
      return { success: true, data: {
        id: row.id, projectId: row.project_id, sourceLayer: row.source_layer,
        title: row.title, content: row.content, url: row.url,
        tags: JSON.parse(row.tags as string), createdAt: row.created_at,
      }};
    } catch (err) { return { success: false, error: (err as Error).message }; }
  });

  ipcMain.handle('db:material:findByProject', (_e, projectId: string) => {
    try {
      const db = getDb();
      const rows = db.prepare('SELECT * FROM materials WHERE project_id = ? ORDER BY created_at DESC').all(projectId) as Record<string, unknown>[];
      return { success: true, data: rows.map(row => ({
        id: row.id, projectId: row.project_id, sourceLayer: row.source_layer,
        title: row.title, content: row.content, url: row.url,
        tags: JSON.parse(row.tags as string), createdAt: row.created_at,
      })) };
    } catch (err) { return { success: false, error: (err as Error).message }; }
  });

  ipcMain.handle('db:material:findGlobal', () => {
    try {
      const db = getDb();
      const rows = db.prepare('SELECT * FROM materials WHERE project_id IS NULL ORDER BY created_at DESC').all() as Record<string, unknown>[];
      return { success: true, data: rows.map(row => ({
        id: row.id, projectId: row.project_id, sourceLayer: row.source_layer,
        title: row.title, content: row.content, url: row.url,
        tags: JSON.parse(row.tags as string), createdAt: row.created_at,
      })) };
    } catch (err) { return { success: false, error: (err as Error).message }; }
  });

  ipcMain.handle('db:material:update', (_e, id: string, input: { title?: string; content?: string; tags?: string[] }) => {
    try {
      const db = getDb();
      const existing = db.prepare('SELECT * FROM materials WHERE id = ?').get(id) as Record<string, unknown>;
      if (!existing) return { success: false, error: 'Material not found' };
      db.prepare('UPDATE materials SET title=?, content=?, tags=? WHERE id=?')
        .run(input.title ?? existing.title, input.content ?? existing.content,
             JSON.stringify(input.tags ?? JSON.parse(existing.tags as string)), id);
      const row = db.prepare('SELECT * FROM materials WHERE id = ?').get(id) as Record<string, unknown>;
      return { success: true, data: {
        id: row.id, projectId: row.project_id, sourceLayer: row.source_layer,
        title: row.title, content: row.content, url: row.url,
        tags: JSON.parse(row.tags as string), createdAt: row.created_at,
      }};
    } catch (err) { return { success: false, error: (err as Error).message }; }
  });

  ipcMain.handle('db:material:remove', (_e, id: string) => {
    try {
      const db = getDb();
      db.prepare('DELETE FROM materials WHERE id = ?').run(id);
      return { success: true };
    } catch (err) { return { success: false, error: (err as Error).message }; }
  });

  // Pinyin search support — removed (dead code, not called from renderer)
}
