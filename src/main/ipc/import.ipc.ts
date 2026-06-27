import { ipcMain, dialog, BrowserWindow } from 'electron';
import { importNovel } from '../importer';

export function registerImportIpc(): void {
  ipcMain.handle('import:selectFile', async () => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return { success: false, error: 'No window' };

    const result = await dialog.showOpenDialog(win, {
      title: '导入小说',
      filters: [
        { name: '支持的格式', extensions: ['txt', 'epub', 'md', 'markdown'] },
        { name: '文本文件', extensions: ['txt'] },
        { name: 'EPUB 电子书', extensions: ['epub'] },
        { name: 'Markdown', extensions: ['md', 'markdown'] },
      ],
      properties: ['openFile'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, error: 'User cancelled' };
    }

    return { success: true, data: result.filePaths[0] };
  });

  ipcMain.handle('import:parseFile', (_event, filePath: string) => {
    try {
      const result = importNovel(filePath);
      return { success: true, data: result };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });
}
