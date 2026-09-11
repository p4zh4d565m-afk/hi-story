import type { Character, WorldEntry } from '../types';

type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;

interface ImportedEntitiesRefresherOptions {
  invoke: Invoke;
  isProjectCurrent: (projectId: string) => boolean;
  onApply: (characters: Character[], worldEntries: WorldEntry[]) => void;
}

/**
 * 实体刷新（人物 + 世界观）：真实调用两个 IPC，任一失败返回 false，成功后回写并返回 true。
 * App 与 UI 集成测试共用，保证测试证明的是与生产一致的刷新链路——IPC 失败沿本函数返回 false，
 * 使 PlanningWorkspace 的 onImported 抛错并让导入面板停留 refreshPending。
 */
export function createImportedEntitiesRefresher(options: ImportedEntitiesRefresherOptions) {
  return async (projectId: string): Promise<boolean> => {
    try {
      const [charRes, worldRes] = await Promise.all([
        options.invoke('db:character:findByProject', projectId),
        options.invoke('db:worldEntry:findByProject', projectId),
      ]) as [any, any];
      if (!options.isProjectCurrent(projectId)) return false;
      if (!charRes?.success || !worldRes?.success) return false;
      options.onApply(charRes.data, worldRes.data);
      return true;
    } catch {
      return false;
    }
  };
}
