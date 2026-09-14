import { ipcMain } from 'electron';
import { getDb } from '../db/connection';
import { ChapterRepo, ChapterHistoryRepo, type CreateChapterInput, type UpdateChapterInput, type ReorderChaptersInput } from '../db/repositories/chapter.repo';
import type { IpcResult, Chapter, ChapterHistorySnapshot } from '../../renderer/types';

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

  ipcMain.handle('db:chapter:insertAfter', (_event, afterChapterId: string, title: string): IpcResult<Chapter> => {
    try {
      return getRepo().insertAfter(afterChapterId, title);
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

  ipcMain.handle('db:chapter:remove', (_event, id: string): IpcResult<Chapter[]> => {
    try {
      return getRepo().remove(id);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('db:chapter:restore', (_event, data: Chapter): IpcResult<Chapter[]> => {
    try {
      return getRepo().restore(data);
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

  // ===== 章节历史版本 =====
  ipcMain.handle('db:chapterHistory:list', (_event, chapterId: string): IpcResult<ChapterHistorySnapshot[]> => {
    try {
      return ChapterHistoryRepo.getSnapshots(getDb(), chapterId);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('db:chapterHistory:restore', (_event, snapshotId: string): IpcResult<Chapter> => {
    try {
      return ChapterHistoryRepo.restoreSnapshot(getDb(), snapshotId);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });
}
