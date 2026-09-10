import type {
  ObsidianImportPrepareResult, ObsidianImportReparseInput, ObsidianImportReparseResult,
  ObsidianCommitInput, ObsidianImportSummary,
} from '../types';

type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;

interface ObsidianImportGuardOptions {
  invoke: Invoke;
  onApply: (projectId: string, result: ObsidianImportPrepareResult) => void;
  onError?: (projectId: string, error: unknown) => void;
  onLoadingChange?: (projectId: string, loading: boolean) => void;
}

/**
 * 项目 ID + 请求代次守卫，封装 prepare / reparse / commit 三条异步路径。
 * 只有 projectId 与 generation 同时匹配时才允许提交状态；commit 额外匹配 operationId。
 */
export function createObsidianImportGuard(options: ObsidianImportGuardOptions) {
  let generation = 0;
  let currentProjectId: string | null = null;
  let currentOperationId: string | null = null;

  const isCurrent = (projectId: string, requestGeneration: number) => (
    generation === requestGeneration && currentProjectId === projectId
  );

  const isCurrentOp = (projectId: string, requestGeneration: number, operationId: string) => (
    isCurrent(projectId, requestGeneration) && currentOperationId === operationId
  );

  return {
    invalidate: () => {
      generation += 1;
      currentProjectId = null;
      currentOperationId = null;
    },
    markEdited: () => {
      // 编辑后作废可复用 operationId
      currentOperationId = null;
    },
    prepare: async (projectId: string): Promise<void> => {
      const requestGeneration = ++generation;
      currentProjectId = projectId;
      options.onLoadingChange?.(projectId, true);
      try {
        const response = await options.invoke('obsidian:preparePlanningImport', projectId) as { success?: boolean; data?: ObsidianImportPrepareResult; error?: string };
        if (!isCurrent(projectId, requestGeneration)) return;
        if (!response?.success || !response.data) throw new Error(response?.error || 'Obsidian 导入准备失败');
        options.onApply(projectId, response.data);
      } catch (error) {
        if (!isCurrent(projectId, requestGeneration)) return;
        options.onError?.(projectId, error);
      } finally {
        if (isCurrent(projectId, requestGeneration)) options.onLoadingChange?.(projectId, false);
      }
    },
    reparse: async (input: ObsidianImportReparseInput): Promise<ObsidianImportReparseResult | null> => {
      const requestGeneration = ++generation;
      currentProjectId = input.projectId;
      const response = await options.invoke('obsidian:reparsePlanningImport', input) as { success?: boolean; data?: ObsidianImportReparseResult; error?: string };
      if (!isCurrent(input.projectId, requestGeneration)) return null;
      if (!response?.success || !response.data) {
        options.onError?.(input.projectId, new Error(response?.error || '重新解析失败'));
        return null;
      }
      return response.data;
    },
    commit: async (input: ObsidianCommitInput): Promise<ObsidianImportSummary | null> => {
      const requestGeneration = ++generation;
      currentProjectId = input.projectId;
      currentOperationId = input.operationId;
      const response = await options.invoke('obsidian:commitPlanningImport', input) as { success?: boolean; data?: ObsidianImportSummary; error?: string };
      if (!isCurrentOp(input.projectId, requestGeneration, input.operationId)) return null;
      if (!response?.success || !response.data) {
        options.onError?.(input.projectId, new Error(response?.error || '导入失败'));
        return null;
      }
      return response.data;
    },
  };
}
