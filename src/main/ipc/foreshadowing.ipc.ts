import { ipcMain } from 'electron';
import { getDb } from '../db/connection';
import { ForeshadowingRepo } from '../db/repositories/foreshadowing.repo';
import type { IpcResult } from '../../renderer/types';

export function registerForeshadowingIpc(): void {
  /** 获取项目的所有伏笔 */
  ipcMain.handle('db:foreshadowing:findByProject', (_event, projectId: string): IpcResult => {
    try {
      const data = ForeshadowingRepo.findByProject(projectId);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  /** 根据 ID 查找 */
  ipcMain.handle('db:foreshadowing:findById', (_event, id: string): IpcResult => {
    try {
      const data = ForeshadowingRepo.findById(id);
      if (!data) return { success: false, error: '伏笔不存在' };
      return { success: true, data };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  /** 创建伏笔 */
  ipcMain.handle('db:foreshadowing:create', (_event, input: any): IpcResult => {
    try {
      const data = ForeshadowingRepo.create(input);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  /** 更新伏笔 */
  ipcMain.handle('db:foreshadowing:update', (_event, id: string, input: any): IpcResult => {
    try {
      const data = ForeshadowingRepo.update(id, input);
      if (!data) return { success: false, error: '伏笔不存在' };
      return { success: true, data };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  /** 删除伏笔 */
  ipcMain.handle('db:foreshadowing:remove', (_event, id: string): IpcResult => {
    try {
      ForeshadowingRepo.remove(id);
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  /** 改变伏笔状态 */
  ipcMain.handle('db:foreshadowing:updateStatus', (_event, id: string, status: string, resolvedChapterId?: string): IpcResult => {
    try {
      const data = ForeshadowingRepo.updateStatus(id, status as any, resolvedChapterId || null);
      if (!data) return { success: false, error: '伏笔不存在' };
      return { success: true, data };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });
}
