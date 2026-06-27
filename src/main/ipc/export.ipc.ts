import { ipcMain, dialog, app } from 'electron';
import fs from 'fs';
import { getDb, getDbPath } from '../db/connection';
import { ProjectRepo } from '../db/repositories/project.repo';
import { ChapterRepo } from '../db/repositories/chapter.repo';
import { OutlineNodeRepo } from '../db/repositories/outline.repo';
import { CharacterRepo, WorldEntryRepo, ReferenceLinkRepo } from '../db/repositories/entities.repo';
import type { IpcResult } from '../../renderer/types';

interface ExportProjectData {
  exportedAt: string;
  appVersion: string;
  project: {
    name: string;
    typeTags: string[];
    style: string;
    summary: string;
  };
  chapters: Array<{ title: string; content: string; wordCount: number; status: string; sortOrder: number }>;
  outlineNodes: Array<{ title: string; summary: string; parentId: string | null; sortOrder: number }>;
  characters: Array<{ name: string; aliases: string; appearance: string; personality: string; background: string; arc: string }>;
  worldEntries: Array<{ name: string; description: string; category: string; parentId: string | null }>;
  relations: Array<{ sourceId: string; targetId: string; relationType: string; sourceName: string; targetName: string }>;
}

export function registerExportIpc(): void {
  // ===== Export project as JSON =====
  ipcMain.handle('export:project-json', async (_event, projectId: string): Promise<IpcResult<string>> => {
    try {
      const db = getDb();
      const projectRepo = new ProjectRepo(db);
      const chapterRepo = new ChapterRepo(db);
      const outlineRepo = new OutlineNodeRepo(db);
      const charRepo = new CharacterRepo(db);
      const worldRepo = new WorldEntryRepo(db);
      const linkRepo = new ReferenceLinkRepo(db);

      const projResult = projectRepo.findById(projectId);
      if (!projResult.success || !projResult.data) {
        return { success: false, error: 'Project not found' };
      }
      const proj = projResult.data;

      const chResult = chapterRepo.findByProject(projectId);
      const olResult = outlineRepo.findByProject(projectId);
      const charResult = charRepo.findByProject(projectId);
      const weResult = worldRepo.findByProject(projectId);
      const relResult = linkRepo.findAllCharacterRelations(projectId);

      const data: ExportProjectData = {
        exportedAt: new Date().toISOString(),
        appVersion: app.getVersion(),
        project: {
          name: proj.name,
          typeTags: proj.typeTags,
          style: proj.style,
          summary: proj.summary,
        },
        chapters: (chResult.success && chResult.data ? chResult.data : []).map(ch => ({
          title: ch.title,
          content: ch.content,
          wordCount: ch.wordCount,
          status: ch.status,
          sortOrder: ch.sortOrder,
        })),
        outlineNodes: (olResult.success && olResult.data ? olResult.data : []).map(n => ({
          title: n.title,
          summary: n.summary,
          parentId: n.parentId,
          sortOrder: n.sortOrder,
        })),
        characters: (charResult.success && charResult.data ? charResult.data : []).map(c => ({
          name: c.name,
          aliases: c.aliases,
          appearance: c.appearance,
          personality: c.personality,
          background: c.background,
          arc: c.arc,
        })),
        worldEntries: (weResult.success && weResult.data ? weResult.data : []).map(w => ({
          name: w.name,
          description: w.description,
          category: w.category,
          parentId: w.parentId,
        })),
        relations: (relResult.success && relResult.data ? relResult.data : []).map((r: any) => {
          const srcChar = charResult.success && charResult.data ? charResult.data.find((c: any) => c.id === r.sourceId) : null;
          const tgtChar = charResult.success && charResult.data ? charResult.data.find((c: any) => c.id === r.targetId) : null;
          return {
            sourceId: r.sourceId,
            targetId: r.targetId,
            relationType: r.relationType,
            sourceName: srcChar?.name || '未知',
            targetName: tgtChar?.name || '未知',
          };
        }),
      };

      // Show save dialog
      const fileName = `${data.project.name.replace(/[<>:"/\\|?*]/g, '_')}_导出_${new Date().toISOString().slice(0,10)}.json`;
      const result = await dialog.showSaveDialog({
        title: '导出项目 JSON',
        defaultPath: fileName,
        filters: [{ name: 'JSON 文件', extensions: ['json'] }],
      });

      if (result.canceled || !result.filePath) {
        return { success: false, error: 'User cancelled' };
      }

      fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2), 'utf-8');
      return { success: true, data: result.filePath };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // ===== Backup entire database =====
  ipcMain.handle('export:backup-db', async (): Promise<IpcResult<string>> => {
    try {
      const dbPath = getDbPath();
      if (!fs.existsSync(dbPath)) {
        return { success: false, error: 'Database file not found' };
      }

      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const defaultName = `hi-story-backup-${ts}.db`;

      const result = await dialog.showSaveDialog({
        title: '备份数据库',
        defaultPath: defaultName,
        filters: [{ name: 'SQLite 数据库', extensions: ['db'] }],
      });

      if (result.canceled || !result.filePath) {
        return { success: false, error: 'User cancelled' };
      }

      // Force WAL checkpoint before copying
      const db = getDb();
      db.pragma('wal_checkpoint(TRUNCATE)');

      fs.copyFileSync(dbPath, result.filePath);
      return { success: true, data: result.filePath };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // ===== Export all projects as JSON =====
  ipcMain.handle('export:all-projects-json', async (): Promise<IpcResult<string>> => {
    try {
      const db = getDb();
      const projectRepo = new ProjectRepo(db);
      const chapterRepo = new ChapterRepo(db);
      const outlineRepo = new OutlineNodeRepo(db);
      const charRepo = new CharacterRepo(db);
      const worldRepo = new WorldEntryRepo(db);
      const linkRepo = new ReferenceLinkRepo(db);

      const projResult = projectRepo.findAll(1000, 0);
      if (!projResult.success || !projResult.data) {
        return { success: false, error: 'Failed to fetch projects' };
      }

      const allData = [];
      for (const proj of projResult.data.items) {
        const chResult = chapterRepo.findByProject(proj.id);
        const olResult = outlineRepo.findByProject(proj.id);
        const charResult = charRepo.findByProject(proj.id);
        const weResult = worldRepo.findByProject(proj.id);
        const relResult = linkRepo.findAllCharacterRelations(proj.id);

        allData.push({
          project: { name: proj.name, typeTags: proj.typeTags, style: proj.style, summary: proj.summary },
          chapters: (chResult.success && chResult.data ? chResult.data : []).map(ch => ({
            title: ch.title, content: ch.content, wordCount: ch.wordCount, status: ch.status,
          })),
          outlineNodes: (olResult.success && olResult.data ? olResult.data : []).map(n => ({
            title: n.title, summary: n.summary, parentId: n.parentId,
          })),
          characters: (charResult.success && charResult.data ? charResult.data : []).map(c => ({
            name: c.name, aliases: c.aliases, appearance: c.appearance, personality: c.personality, background: c.background, arc: c.arc,
          })),
          worldEntries: (weResult.success && weResult.data ? weResult.data : []).map(w => ({
            name: w.name, description: w.description, category: w.category,
          })),
          relations: (relResult.success && relResult.data ? relResult.data : []).map((r: any) => ({
            sourceId: r.sourceId, targetId: r.targetId, relationType: r.relationType,
          })),
        });
      }

      const exportData = {
        exportedAt: new Date().toISOString(),
        appVersion: app.getVersion(),
        projects: allData,
      };

      const fileName = `hi-story-all-projects_${new Date().toISOString().slice(0,10)}.json`;
      const result = await dialog.showSaveDialog({
        title: '导出全部项目 JSON',
        defaultPath: fileName,
        filters: [{ name: 'JSON 文件', extensions: ['json'] }],
      });

      if (result.canceled || !result.filePath) {
        return { success: false, error: 'User cancelled' };
      }

      fs.writeFileSync(result.filePath, JSON.stringify(exportData, null, 2), 'utf-8');
      return { success: true, data: result.filePath };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });
}
