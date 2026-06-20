import { ipcMain } from 'electron';
import { getDb } from '../db/connection';
import { ProjectRepo } from '../db/repositories/project.repo';
import type { CreateProjectInput, UpdateProjectInput, IpcResult, Project, PaginatedResult } from '../../renderer/types';

function getRepo(): ProjectRepo {
  return new ProjectRepo(getDb());
}

export function registerProjectIpc(): void {
  ipcMain.handle('db:project:create', (_event, input: CreateProjectInput): IpcResult<Project> => {
    try {
      return getRepo().create(input);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('db:project:findAll', (_event, limit?: number, offset?: number): IpcResult<PaginatedResult<Project>> => {
    try {
      return getRepo().findAll(limit, offset);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('db:project:findById', (_event, id: string): IpcResult<Project> => {
    try {
      return getRepo().findById(id);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('db:project:update', (_event, input: UpdateProjectInput): IpcResult<Project> => {
    try {
      return getRepo().update(input);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('db:project:remove', (_event, id: string): IpcResult<void> => {
    try {
      return getRepo().remove(id);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });
}
