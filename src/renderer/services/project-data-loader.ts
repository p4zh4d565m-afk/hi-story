import type { Chapter, Character, OutlineNode, WorldEntry } from '../types';

export interface ProjectRelation {
  id: string;
  sourceId: string;
  targetId: string;
  relationType: string;
  arrowDirection: string;
}

export interface ProjectDataSnapshot {
  projectId: string;
  chapters: Chapter[];
  outlineNodes: OutlineNode[];
  characters: Character[];
  worldEntries: WorldEntry[];
  relations: ProjectRelation[];
}

type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;
type LoadStatus = 'applied' | 'stale' | 'failed';

export interface ProjectSelectionTicket {
  projectId: string | null;
  generation: number;
}

export function createProjectSelectionGuard() {
  let current: ProjectSelectionTicket = { projectId: null, generation: 0 };
  return {
    select: (projectId: string | null): ProjectSelectionTicket => {
      current = { projectId, generation: current.generation + 1 };
      return current;
    },
    snapshot: (): ProjectSelectionTicket => current,
    currentProjectId: () => current.projectId,
    isCurrent: (ticket: ProjectSelectionTicket) => (
      ticket.projectId === current.projectId && ticket.generation === current.generation
    ),
  };
}

interface ProjectDataLoaderOptions {
  invoke: Invoke;
  onApply: (snapshot: ProjectDataSnapshot) => void;
  onError?: (projectId: string, error: unknown) => void;
  onLoadingChange?: (projectId: string, loading: boolean) => void;
  isProjectCurrent?: (projectId: string) => boolean;
}

interface IpcArrayResult {
  success?: boolean;
  data?: unknown;
  error?: string;
}

async function loadArray(invoke: Invoke, channel: string, projectId: string): Promise<any[]> {
  const result = await invoke(channel, projectId) as IpcArrayResult;
  if (!result?.success || !Array.isArray(result.data)) {
    throw new Error(result?.error || `${channel} 加载失败`);
  }
  return result.data;
}

async function fetchProjectData(invoke: Invoke, projectId: string): Promise<ProjectDataSnapshot> {
  const [chapters, outlineNodes, characters, worldEntries, relationRows] = await Promise.all([
    loadArray(invoke, 'db:chapter:findByProject', projectId),
    loadArray(invoke, 'db:outline:findByProject', projectId),
    loadArray(invoke, 'db:character:findByProject', projectId),
    loadArray(invoke, 'db:worldEntry:findByProject', projectId),
    loadArray(invoke, 'db:referenceLink:findAllCharacterRelations', projectId),
  ]);

  return {
    projectId,
    chapters,
    outlineNodes,
    characters,
    worldEntries,
    relations: relationRows.map(row => ({
      id: row.id,
      sourceId: row.sourceId,
      targetId: row.targetId,
      relationType: row.relationType,
      arrowDirection: row.arrowDirection || 'none',
    })),
  };
}

export function createProjectDataLoader(options: ProjectDataLoaderOptions) {
  let generation = 0;
  let currentProjectId: string | null = null;

  const isCurrent = (projectId: string, requestGeneration = generation) => (
    currentProjectId === projectId
    && generation === requestGeneration
    && (options.isProjectCurrent?.(projectId) ?? true)
  );

  return {
    isCurrent: (projectId: string) => isCurrent(projectId),
    invalidate: () => {
      generation += 1;
      currentProjectId = null;
    },
    load: async (projectId: string): Promise<LoadStatus> => {
      if (options.isProjectCurrent && !options.isProjectCurrent(projectId)) return 'stale';
      const requestGeneration = ++generation;
      currentProjectId = projectId;
      options.onLoadingChange?.(projectId, true);
      try {
        const snapshot = await fetchProjectData(options.invoke, projectId);
        if (!isCurrent(projectId, requestGeneration)) return 'stale';
        options.onApply(snapshot);
        return 'applied';
      } catch (error) {
        if (!isCurrent(projectId, requestGeneration)) return 'stale';
        options.onError?.(projectId, error);
        return 'failed';
      } finally {
        if (isCurrent(projectId, requestGeneration)) {
          options.onLoadingChange?.(projectId, false);
        }
      }
    },
  };
}
