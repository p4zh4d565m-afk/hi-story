import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from 'electron';
import { getDb } from '../db/connection';
import { ProjectRepo } from '../db/repositories/project.repo';
import { scanObsidianVault } from '../obsidian/markdown-vault';
import type { IpcResult, ObsidianScanResult } from '../../renderer/types';

export function registerObsidianIpc(): void {
  ipcMain.handle('obsidian:chooseDirectory', async (event): Promise<IpcResult<string | null>> => {
    try {
      const options: OpenDialogOptions = {
        title: '选择 Obsidian 仓库或小说项目目录',
        properties: ['openDirectory'],
      };
      const owner = BrowserWindow.fromWebContents(event.sender);
      const result = owner
        ? await dialog.showOpenDialog(owner, options)
        : await dialog.showOpenDialog(options);
      return { success: true, data: result.canceled ? null : result.filePaths[0] ?? null };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('obsidian:scan', async (_event, projectId: string): Promise<IpcResult<ObsidianScanResult>> => {
    try {
      const projectResult = new ProjectRepo(getDb()).findById(projectId);
      if (!projectResult.success || !projectResult.data) {
        return { success: false, error: projectResult.error || '项目不存在' };
      }
      const data = await scanObsidianVault(projectResult.data.obsidianPath);
      return { success: true, data };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });
}
