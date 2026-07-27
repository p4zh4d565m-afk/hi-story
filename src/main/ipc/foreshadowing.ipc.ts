import { ipcMain } from 'electron';
import { getDb } from '../db/connection';
import { ForeshadowingRepo, type CreateForeshadowingInput, type UpdateForeshadowingInput } from '../db/repositories/foreshadowing.repo';

function getRepo(): ForeshadowingRepo {
  return new ForeshadowingRepo(getDb());
}

export function registerForeshadowingIpc(): void {
  /** 获取项目的所有伏笔 */
  ipcMain.handle('db:foreshadowing:findByProject', (_event, projectId: string) => {
    try {
      return getRepo().findByProject(projectId);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  /** 根据 ID 查找 */
  ipcMain.handle('db:foreshadowing:findById', (_event, id: string) => {
    try {
      return getRepo().findById(id);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  /** 创建伏笔 */
  ipcMain.handle('db:foreshadowing:create', (_event, input: CreateForeshadowingInput) => {
    try {
      return getRepo().create(input);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  /** 更新伏笔 */
  ipcMain.handle('db:foreshadowing:update', (_event, id: string, input: UpdateForeshadowingInput) => {
    try {
      return getRepo().update(id, input);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  /** 删除伏笔 */
  ipcMain.handle('db:foreshadowing:remove', (_event, id: string) => {
    try {
      return getRepo().remove(id);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  /** 改变伏笔状态 */
  ipcMain.handle('db:foreshadowing:updateStatus', (_event, id: string, status: string, resolvedChapterId?: string) => {
    try {
      return getRepo().updateStatus(id, status, resolvedChapterId || null);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });
}
