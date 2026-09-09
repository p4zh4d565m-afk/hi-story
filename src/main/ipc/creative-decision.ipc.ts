import { ipcMain } from 'electron';
import { getDb } from '../db/connection';
import { CreativeDecisionRepo } from '../db/repositories/creative-decision.repo';
import type {
  ConfirmCreativeDecisionsInput,
  CreateCreativeDecisionProposalsInput,
  CreateCreativeDecisionRevisionInput,
  UpdateCreativeDecisionProposalInput,
} from '../../renderer/types';

function getRepo(): CreativeDecisionRepo {
  return new CreativeDecisionRepo(getDb());
}

export function registerCreativeDecisionIpc(): void {
  ipcMain.handle(
    'db:creativeDecisions:createProposals',
    (_event, input: CreateCreativeDecisionProposalsInput) => {
      try { return getRepo().createProposals(input); }
      catch (error) { return { success: false, error: (error as Error).message }; }
    },
  );
  ipcMain.handle('db:creativeDecisions:findByProject', (_event, projectId: string) => {
    try { return getRepo().findByProject(projectId); }
    catch (error) { return { success: false, error: (error as Error).message }; }
  });
  ipcMain.handle(
    'db:creativeDecisions:updateProposal',
    (_event, input: UpdateCreativeDecisionProposalInput) => {
      try { return getRepo().updateProposal(input); }
      catch (error) { return { success: false, error: (error as Error).message }; }
    },
  );
  ipcMain.handle(
    'db:creativeDecisions:reject',
    (_event, projectId: string, decisionId: string) => {
      try { return getRepo().reject(projectId, decisionId); }
      catch (error) { return { success: false, error: (error as Error).message }; }
    },
  );
  ipcMain.handle(
    'db:creativeDecisions:confirmMany',
    (_event, input: ConfirmCreativeDecisionsInput) => {
      try { return getRepo().confirmMany(input); }
      catch (error) { return { success: false, error: (error as Error).message }; }
    },
  );
  ipcMain.handle(
    'db:creativeDecisions:createRevision',
    (_event, input: CreateCreativeDecisionRevisionInput) => {
      try { return getRepo().createRevision(input); }
      catch (error) { return { success: false, error: (error as Error).message }; }
    },
  );
}
