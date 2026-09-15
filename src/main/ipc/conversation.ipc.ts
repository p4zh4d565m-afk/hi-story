import { ipcMain } from 'electron';
import { getDb } from '../db/connection';
import { ConversationRepo } from '../db/repositories/conversation.repo';
import type {
  AppendConversationMessageInput,
  ClearConversationThreadInput,
  CreateConversationThreadInput,
  DeleteConversationTurnInput,
  LegacyConversationData,
  RestoreConversationBatchInput,
} from '../../renderer/types';

function getRepo(): ConversationRepo {
  return new ConversationRepo(getDb());
}

export function registerConversationIpc(): void {
  ipcMain.handle('db:conversation:findByProject', (_event, projectId: string) => {
    try { return getRepo().findByProject(projectId); }
    catch (error) { return { success: false, error: (error as Error).message }; }
  });
  ipcMain.handle('db:conversation:createThread', (_event, input: CreateConversationThreadInput) => {
    try { return getRepo().createThread(input); }
    catch (error) { return { success: false, error: (error as Error).message }; }
  });
  ipcMain.handle('db:conversation:removeThread', (_event, projectId: string, threadId: string) => {
    try { return getRepo().removeThread(projectId, threadId); }
    catch (error) { return { success: false, error: (error as Error).message }; }
  });
  ipcMain.handle('db:conversation:appendMessage', (_event, input: AppendConversationMessageInput) => {
    try { return getRepo().appendMessage(input); }
    catch (error) { return { success: false, error: (error as Error).message }; }
  });
  ipcMain.handle('db:conversation:migrateLegacy', (_event, projectId: string, legacy: LegacyConversationData | null) => {
    try { return getRepo().migrateLegacy(projectId, legacy); }
    catch (error) { return { success: false, error: (error as Error).message }; }
  });
  ipcMain.handle('db:conversation:deleteTurn', (_event, input: DeleteConversationTurnInput) => {
    try {
      return getRepo().deleteTurn(input.projectId, input.threadId, input.userMessageId);
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });
  ipcMain.handle('db:conversation:clearThread', (_event, input: ClearConversationThreadInput) => {
    try {
      return getRepo().clearThread(input.projectId, input.threadId);
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });
  ipcMain.handle('db:conversation:restoreBatch', (_event, input: RestoreConversationBatchInput) => {
    try {
      return getRepo().restoreBatch(input.projectId, input.threadId, input.batchId);
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });
}
