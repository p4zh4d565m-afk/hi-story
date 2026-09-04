import { ipcMain } from 'electron';
import { getDb } from '../db/connection';
import { PlanningRepo, type SavePlanningIdeaInput } from '../db/repositories/planning.repo';

export function registerPlanningIpc(): void {
  ipcMain.handle('db:planning:findByProject', (_event, projectId: string) => {
    try { return new PlanningRepo(getDb()).findByProject(projectId); }
    catch (err) { return { success: false, error: (err as Error).message }; }
  });

  ipcMain.handle('db:planning:save', (_event, input: SavePlanningIdeaInput) => {
    try { return new PlanningRepo(getDb()).save(input); }
    catch (err) { return { success: false, error: (err as Error).message }; }
  });
}
