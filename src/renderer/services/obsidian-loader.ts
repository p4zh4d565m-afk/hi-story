import type { IpcResult, ObsidianScanResult } from '../types';

type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;
type LoadStatus = 'applied' | 'stale' | 'failed';

interface ObsidianLoaderOptions {
  invoke: Invoke;
  onApply: (projectId: string, result: ObsidianScanResult) => void;
  onError?: (projectId: string, error: unknown) => void;
  onLoadingChange?: (projectId: string, loading: boolean) => void;
  isProjectCurrent?: (projectId: string) => boolean;
}

export function createObsidianLoader(options: ObsidianLoaderOptions) {
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
        const response = await options.invoke('obsidian:scan', projectId) as IpcResult<ObsidianScanResult>;
        if (!isCurrent(projectId, requestGeneration)) return 'stale';
        if (!response?.success || !response.data) throw new Error(response?.error || 'Obsidian 读取失败');
        options.onApply(projectId, response.data);
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
