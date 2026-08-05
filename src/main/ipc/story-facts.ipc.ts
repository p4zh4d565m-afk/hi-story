import { ipcMain } from 'electron';
import { getDb } from '../db/connection';
import { StoryFactsRepo, type CreateStoryFactInput, type BatchUpsertFactsInput, type SupersedeFactInput, type CreateKnowledgeInput, type BatchUpsertKnowledgeInput } from '../db/repositories/story-facts.repo';

function getRepo(): StoryFactsRepo {
  return new StoryFactsRepo(getDb());
}

export function registerStoryFactsIpc(): void {
  // ── Story Facts ──

  /** 批量覆盖某章的事实 */
  ipcMain.handle('db:storyFacts:batchUpsert', (_event, input: BatchUpsertFactsInput) => {
    try {
      return getRepo().batchUpsert(input);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  /** 获取项目最近活跃事实 */
  ipcMain.handle('db:storyFacts:findRecentActive', (_event, projectId: string, limit?: number) => {
    try {
      return getRepo().findRecentActive(projectId, limit ?? 30);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  /** 获取项目所有活跃事实 */
  ipcMain.handle('db:storyFacts:findActiveByProject', (_event, projectId: string) => {
    try {
      return getRepo().findActiveByProject(projectId);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  /** 按类型获取活跃事实 */
  ipcMain.handle('db:storyFacts:findByType', (_event, projectId: string, factType: string) => {
    try {
      return getRepo().findByType(projectId, factType);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  /** 获取分组事实 */
  ipcMain.handle('db:storyFacts:getGroupedFacts', (_event, projectId: string) => {
    try {
      return getRepo().getGroupedFacts(projectId);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  /** 标记事实被取代 */
  ipcMain.handle('db:storyFacts:supersede', (_event, id: string, supersededById: string) => {
    try {
      return getRepo().supersede(id, supersededById);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  /** 标记事实已解决 */
  ipcMain.handle('db:storyFacts:resolve', (_event, id: string) => {
    try {
      return getRepo().resolve(id);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // ── Character Knowledge ──

  /** 批量覆盖某章的角色知识 */
  ipcMain.handle('db:storyFacts:batchUpsertKnowledge', (_event, input: BatchUpsertKnowledgeInput) => {
    try {
      return getRepo().batchUpsertKnowledge(input);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  /** 获取某角色的已知信息 */
  ipcMain.handle('db:storyFacts:findKnowledgeByCharacter', (_event, projectId: string, characterName: string) => {
    try {
      return getRepo().findByCharacter(projectId, characterName);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  /** 获取项目所有角色知识 */
  ipcMain.handle('db:storyFacts:findAllKnowledgeByProject', (_event, projectId: string) => {
    try {
      return getRepo().findAllKnowledgeByProject(projectId);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });
}
