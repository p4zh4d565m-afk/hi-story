import { ipcMain } from 'electron';
import { getDb } from '../db/connection';
import { OutlineNodeRepo, type CreateOutlineNodeInput, type UpdateOutlineNodeInput, type ReorderOutlineNodesInput } from '../db/repositories/outline.repo';
import type { IpcResult, OutlineNode } from '../../renderer/types';

function getRepo(): OutlineNodeRepo {
  return new OutlineNodeRepo(getDb());
}

export function registerOutlineIpc(): void {
  ipcMain.handle('db:outline:create', (_event, input: CreateOutlineNodeInput): IpcResult<OutlineNode> => {
    try {
      return getRepo().create(input);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('db:outline:findById', (_event, id: string): IpcResult<OutlineNode> => {
    try {
      return getRepo().findById(id);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('db:outline:findByProject', (_event, projectId: string): IpcResult<OutlineNode[]> => {
    try {
      return getRepo().findByProject(projectId);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('db:outline:update', (_event, input: UpdateOutlineNodeInput): IpcResult<OutlineNode> => {
    try {
      return getRepo().update(input);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('db:outline:remove', (_event, id: string): IpcResult<void> => {
    try {
      return getRepo().remove(id);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('db:outline:reorder', (_event, input: ReorderOutlineNodesInput): IpcResult<void> => {
    try {
      return getRepo().reorder(input);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });
}
