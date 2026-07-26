import { ipcMain, dialog, BrowserWindow } from 'electron';
import { importNovel, chunkText } from '../importer';
import { ReferenceRepo, type CreateReferenceDocInput } from '../db/repositories/reference.repo';
import { getDb } from '../db/connection';

function getRefRepo(): ReferenceRepo {
  return new ReferenceRepo(getDb());
}

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

  // 导入到参考库（新的导入目标）
  ipcMain.handle('import:toReference', (_event, filePath: string) => {
    try {
      const result = importNovel(filePath);

      // 将解析结果转换为分块
      const allChunks: { content: string; wordCount: number }[] = [];
      for (const ch of result.chapters) {
        // 将 HTML 内容转为纯文本后分块
        const plainText = ch.content
          .replace(/<[^>]*>/g, '')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&nbsp;/g, ' ');
        const chChunks = chunkText(plainText);
        allChunks.push(...chChunks);
      }

      const input: CreateReferenceDocInput = {
        title: result.title,
        author: result.author,
        format: result.format,
        totalWords: result.totalWords,
        sourceFile: filePath,
        chunks: allChunks,
      };

      const createRes = getRefRepo().create(input);
      if (!createRes.success) {
        return createRes;
      }

      return {
        success: true,
        data: {
          doc: createRes.data,
          chapterCount: result.chapters.length,
          chunkCount: allChunks.length,
          warnings: result.warnings,
        },
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // ── 批量导入（多选文件）──
  ipcMain.handle('import:selectFiles', async () => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return { success: false, error: 'No window' };

    const result = await dialog.showOpenDialog(win, {
      title: '批量导入小说',
      filters: [
        { name: '文本文件', extensions: ['txt', 'epub', 'md', 'markdown'] },
      ],
      properties: ['openFile', 'multiSelections'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, error: 'User cancelled' };
    }

    return { success: true, data: result.filePaths };
  });

  // ── 批量导入到参考库（解析 + 查重 + 跳过/覆盖）──
  ipcMain.handle('import:batchToReference', (_event, filePaths: string[], mode: 'skip' | 'overwrite') => {
    const refRepo = getRefRepo();
    const results: Array<{
      file: string;
      status: 'imported' | 'skipped' | 'error';
      title?: string;
      chunkCount?: number;
      existingTitle?: string;
      error?: string;
    }> = [];

    for (const fp of filePaths) {
      try {
        // 检查是否已导入过（按 source_file 查重）
        const existing = refRepo.findBySourceFile(fp);
        if (existing) {
          if (mode === 'skip') {
            results.push({
              file: fp,
              status: 'skipped',
              existingTitle: existing.title,
            });
            continue;
          } else {
            // 覆盖模式：删除旧文档
            refRepo.remove(existing.id);
          }
        }

        // 解析文件
        const result = importNovel(fp);

        // 将解析结果转换为分块
        const allChunks: { content: string; wordCount: number }[] = [];
        for (const ch of result.chapters) {
          const plainText = ch.content
            .replace(/<[^>]*>/g, '')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&nbsp;/g, ' ');
          const chChunks = chunkText(plainText);
          allChunks.push(...chChunks);
        }

        const input: CreateReferenceDocInput = {
          title: result.title,
          author: result.author,
          format: result.format,
          totalWords: result.totalWords,
          sourceFile: fp,
          chunks: allChunks,
        };

        const createRes = refRepo.create(input, true); // skipFtsRebuild = true，批量导完再统一重建
        if (!createRes.success) {
          results.push({
            file: fp,
            status: 'error',
            error: createRes.error || '创建文档失败',
          });
          continue;
        }

        results.push({
          file: fp,
          status: 'imported',
          title: result.title,
          chunkCount: allChunks.length,
        });
      } catch (err) {
        results.push({
          file: fp,
          status: 'error',
          error: (err as Error).message,
        });
      }
    }

    // 全部导入完成后统一重建 FTS5 索引（一次性，避免每本都 rebuild 卡死）
    if (results.filter(r => r.status === 'imported').length > 0) {
      refRepo.rebuildFts();
    }

    return {
      success: true,
      data: {
        results,
        summary: {
          total: filePaths.length,
          imported: results.filter(r => r.status === 'imported').length,
          skipped: results.filter(r => r.status === 'skipped').length,
          errors: results.filter(r => r.status === 'error').length,
        },
      },
    };
  });
}
