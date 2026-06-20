import { ipcMain } from 'electron';
import { getDb } from '../db/connection';
import { ChapterRepo, type CreateChapterInput, type UpdateChapterInput, type ReorderChaptersInput } from '../db/repositories/chapter.repo';
import type { IpcResult, Chapter } from '../../renderer/types';

function getRepo(): ChapterRepo {
  return new ChapterRepo(getDb());
}

export function registerChapterIpc(): void {
  ipcMain.handle('db:chapter:create', (_event, input: CreateChapterInput): IpcResult<Chapter> => {
    try {
      return getRepo().create(input);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('db:chapter:findById', (_event, id: string): IpcResult<Chapter> => {
    try {
      return getRepo().findById(id);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('db:chapter:findByProject', (_event, projectId: string): IpcResult<Chapter[]> => {
    try {
      return getRepo().findByProject(projectId);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('db:chapter:update', (_event, input: UpdateChapterInput): IpcResult<Chapter> => {
    try {
      return getRepo().update(input);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('db:chapter:remove', (_event, id: string): IpcResult<void> => {
    try {
      return getRepo().remove(id);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('db:chapter:reorder', (_event, input: ReorderChaptersInput): IpcResult<void> => {
    try {
      return getRepo().reorder(input);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });
}
