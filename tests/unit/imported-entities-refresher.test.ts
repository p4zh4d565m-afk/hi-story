import { describe, expect, it } from 'vitest';
import { createImportedEntitiesRefresher } from '../../src/renderer/services/imported-entities-refresher';

// 与 project-data-loader 测试相同的 deferred 工具，用于控制两条 IPC 回执的先后。
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
}

describe('导入后实体刷新（人物 + 世界观）', () => {
  it('两条 IPC 均成功时返回 true 并回写人物与世界观', async () => {
    let applied: { characters: unknown[]; worldEntries: unknown[] } | null = null;
    const refresh = createImportedEntitiesRefresher({
      invoke: async (channel) => {
        if (channel === 'db:character:findByProject') return { success: true, data: [{ id: 'c1', name: '沈屿' }] };
        if (channel === 'db:worldEntry:findByProject') return { success: true, data: [{ id: 'w1', name: '主要场景' }] };
        throw new Error('未知通道 ' + channel);
      },
      isProjectCurrent: () => true,
      onApply: (characters, worldEntries) => { applied = { characters, worldEntries }; },
    });

    await expect(refresh('p1')).resolves.toBe(true);
    expect(applied).toEqual({
      characters: [{ id: 'c1', name: '沈屿' }],
      worldEntries: [{ id: 'w1', name: '主要场景' }],
    });
  });

  it('任一 IPC 返回 success:false 时返回 false 且不回写', async () => {
    let applied = false;
    const refresh = createImportedEntitiesRefresher({
      invoke: async (channel) => {
        if (channel === 'db:character:findByProject') return { success: false, error: '人物读取失败' };
        if (channel === 'db:worldEntry:findByProject') return { success: true, data: [] };
        throw new Error('未知通道 ' + channel);
      },
      isProjectCurrent: () => true,
      onApply: () => { applied = true; },
    });

    await expect(refresh('p1')).resolves.toBe(false);
    expect(applied).toBe(false);
  });

  it('invoke 直接 reject 时返回 false 且不回写', async () => {
    let applied = false;
    const refresh = createImportedEntitiesRefresher({
      invoke: async () => { throw new Error('桥接断开'); },
      isProjectCurrent: () => true,
      onApply: () => { applied = true; },
    });

    await expect(refresh('p1')).resolves.toBe(false);
    expect(applied).toBe(false);
  });

  it('isProjectCurrent 为 false 时不回写（项目已切换）', async () => {
    let applied = false;
    const refresh = createImportedEntitiesRefresher({
      invoke: async () => ({ success: true, data: [] }),
      isProjectCurrent: () => false,
      onApply: () => { applied = true; },
    });

    await expect(refresh('p1')).resolves.toBe(false);
    expect(applied).toBe(false);
  });
});
