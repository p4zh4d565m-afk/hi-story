import { getDb } from '../db/connection';
import { CharacterRepo, type CreateCharacterInput, type UpdateCharacterInput } from '../db/repositories/entities.repo';
import { WorldEntryRepo, type CreateWorldEntryInput, type UpdateWorldEntryInput } from '../db/repositories/entities.repo';
import { ReferenceLinkRepo, type CreateReferenceLinkInput } from '../db/repositories/entities.repo';
import { SearchEngine } from '../ai/search-engine';

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
}

export function registerWorldEntryIpc(): void {
  ipcMain.handle('db:worldEntry:create', (_e, i: CreateWorldEntryInput) => { try { return w().create(i); } catch (err) { return { success: false, error: (err as Error).message }; } });
  ipcMain.handle('db:worldEntry:findById', (_e, id: string) => { try { return w().findById(id); } catch (err) { return { success: false, error: (err as Error).message }; } });
  ipcMain.handle('db:worldEntry:findByProject', (_e, pid: string) => { try { return w().findByProject(pid); } catch (err) { return { success: false, error: (err as Error).message }; } });
  ipcMain.handle('db:worldEntry:update', (_e, i: UpdateWorldEntryInput) => { try { return w().update(i); } catch (err) { return { success: false, error: (err as Error).message }; } });
  ipcMain.handle('db:worldEntry:remove', (_e, id: string) => { try { return w().remove(id); } catch (err) { return { success: false, error: (err as Error).message }; } });
}

export function registerReferenceLinkIpc(): void {
  ipcMain.handle('db:referenceLink:create', (_e, i: CreateReferenceLinkInput) => { try { return r().create(i); } catch (err) { return { success: false, error: (err as Error).message }; } });
  ipcMain.handle('db:referenceLink:findBySource', (_e, type: string, id: string) => { try { return r().findBySource(type, id); } catch (err) { return { success: false, error: (err as Error).message }; } });
  ipcMain.handle('db:referenceLink:findByTarget', (_e, type: string, id: string) => { try { return r().findByTarget(type, id); } catch (err) { return { success: false, error: (err as Error).message }; } });
  ipcMain.handle('db:referenceLink:findAllForEntity', (_e, type: string, id: string) => { try { return r().findAllForEntity(type, id); } catch (err) { return { success: false, error: (err as Error).message }; } });
  ipcMain.handle('db:referenceLink:findAllCharacterRelations', (_e, pid: string) => { try { return r().findAllCharacterRelations(pid); } catch (err) { return { success: false, error: (err as Error).message }; } });
  ipcMain.handle('db:referenceLink:remove', (_e, id: string) => { try { return r().remove(id); } catch (err) { return { success: false, error: (err as Error).message }; } });
}

export function registerSearchIpc(): void {
  ipcMain.handle('search:query', (_e, options: { query: string; layers?: string[]; maxResultsPerLayer?: number }) => {
    try {
      const engine = s();
      return { success: true, data: engine.search(options) };
    } catch (err) { return { success: false, error: (err as Error).message }; }
  });
}
