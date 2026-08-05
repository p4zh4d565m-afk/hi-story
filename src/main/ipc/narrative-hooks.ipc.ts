import { ipcMain } from 'electron';
import { getDb } from '../db/connection';
import { NarrativeHooksRepo, type CreateHookInput, type UpdateHookInput, type CreateDebtInput, type UpdateDebtInput } from '../db/repositories/narrative-hooks.repo';

function getRepo(): NarrativeHooksRepo {
  return new NarrativeHooksRepo(getDb());
}

export function registerNarrativeHooksIpc(): void {
  // ── Hooks ──

  ipcMain.handle('db:narrativeHooks:create', (_event, input: CreateHookInput) => {
    try {
      return getRepo().create(input);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('db:narrativeHooks:findByProject', (_event, projectId: string) => {
    try {
      return getRepo().findByProject(projectId);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('db:narrativeHooks:findOpenHooks', (_event, projectId: string) => {
    try {
      return getRepo().findOpenHooks(projectId);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('db:narrativeHooks:update', (_event, id: string, input: UpdateHookInput) => {
    try {
      return getRepo().update(id, input);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('db:narrativeHooks:resolve', (_event, id: string, chapterId: string) => {
    try {
      return getRepo().resolve(id, chapterId);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('db:narrativeHooks:remove', (_event, id: string) => {
    try {
      return getRepo().remove(id);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // ── Debts ──

  ipcMain.handle('db:narrativeDebts:create', (_event, input: CreateDebtInput) => {
    try {
      return getRepo().createDebt(input);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('db:narrativeDebts:findUnpaid', (_event, projectId: string) => {
    try {
      return getRepo().findUnpaidDebts(projectId);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('db:narrativeDebts:update', (_event, id: string, input: UpdateDebtInput) => {
    try {
      return getRepo().updateDebt(id, input);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('db:narrativeDebts:pay', (_event, id: string, chapterId: string) => {
    try {
      return getRepo().payDebt(id, chapterId);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('db:narrativeDebts:remove', (_event, id: string) => {
    try {
      return getRepo().removeDebt(id);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // ── 综合上下文（写章前注入） ──

  ipcMain.handle('db:narrativeHooks:getContext', (_event, projectId: string) => {
    try {
      const ctx = getRepo().getHooksAndDebtsContext(projectId);
      return { success: true, data: ctx };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });
}
