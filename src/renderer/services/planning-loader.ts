import type { IpcResult, PlanningIdea } from '../types';

type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;
type LoadStatus = 'applied' | 'stale' | 'failed';

interface PlanningLoaderOptions {
  invoke: Invoke;
  onApply: (projectId: string, planning: PlanningIdea | null) => void;
  onError?: (projectId: string, error: unknown) => void;
  onLoadingChange?: (projectId: string, loading: boolean) => void;
  isProjectCurrent?: (projectId: string) => boolean;
}

/**
 * 独立加载策划数据（planning_ideas），失败不阻断项目（A4a）。
 * 与 obsidian-loader 同款 generation + projectId 双重守卫，避免迟到回执污染当前项目。
 * 策划坏 JSON 时 findByProject 返回 success:false，这里保留上次成功快照、不清空章节。
 */
export function createPlanningLoader(options: PlanningLoaderOptions) {
  let generation = 0;
  let currentProjectId: string | null = null;

  const isCurrent = (projectId: string, requestGeneration: number) => (
    generation === requestGeneration
    && currentProjectId === projectId
    && (options.isProjectCurrent?.(projectId) ?? true)
  );

  return {
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
        const response = await options.invoke('db:planning:findByProject', projectId) as IpcResult<PlanningIdea | null>;
        if (!isCurrent(projectId, requestGeneration)) return 'stale';
        if (!response?.success) {
          // 坏 JSON / 读取失败：保留上次成功快照，不抛错阻断项目
          options.onApply(projectId, null);
          return 'failed';
        }
        options.onApply(projectId, response.data ?? null);
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
