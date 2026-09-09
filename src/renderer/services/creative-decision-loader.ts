import type { CreativeDecision, IpcResult } from '../types';

type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;
type LoadStatus = 'applied' | 'stale' | 'failed';

interface CreativeDecisionLoaderOptions {
  invoke: Invoke;
  getCurrentProjectId: () => string | null;
  onApply: (projectId: string, decisions: CreativeDecision[]) => void;
  onError?: (projectId: string, error: Error) => void;
}

export function createCreativeDecisionLoader(options: CreativeDecisionLoaderOptions) {
  let generation = 0;

  const isCurrent = (projectId: string, requestGeneration: number) => (
    generation === requestGeneration
    && options.getCurrentProjectId() === projectId
  );

  return {
    invalidate(): void {
      generation += 1;
    },

    async load(projectId: string): Promise<LoadStatus> {
      if (options.getCurrentProjectId() !== projectId) return 'stale';
      const requestGeneration = ++generation;
      try {
        const response = await options.invoke(
          'db:creativeDecisions:findByProject', projectId,
        ) as IpcResult<CreativeDecision[]>;
        if (!isCurrent(projectId, requestGeneration)) return 'stale';
        if (!response?.success || !response.data) {
          throw new Error(response?.error || '创作决策读取失败');
        }
        options.onApply(projectId, response.data);
        return 'applied';
      } catch (error) {
        if (!isCurrent(projectId, requestGeneration)) return 'stale';
        options.onError?.(
          projectId,
          error instanceof Error ? error : new Error(String(error)),
        );
        return 'failed';
      }
    },
  };
}
