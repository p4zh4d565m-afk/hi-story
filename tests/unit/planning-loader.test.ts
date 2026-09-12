import { describe, it, expect } from 'vitest';
import { createPlanningLoader } from '../../src/renderer/services/planning-loader';
import type { PlanningIdea } from '../../src/renderer/types';

function mkPlanning(): PlanningIdea {
  return {
    id: 'p1', projectId: 'p1', idea: '', requirements: '', generatedOptions: [], selectedOption: null,
    status: 'confirmed', masterOutline: null, outlineStatus: 'empty', volumeOutlines: [], volumeStatus: 'empty',
    chapterOutlines: [], chapterOutlineStatus: 'empty', createdAt: '', updatedAt: '',
  };
}

describe('createPlanningLoader（代次守卫）', () => {
  it('加载成功应用结果', async () => {
    let applied: string | null = null;
    const loader = createPlanningLoader({
      invoke: async (_c, _p) => ({ success: true, data: mkPlanning() }),
      onApply: (_pid, planning) => { applied = planning?.id ?? null; },
      isProjectCurrent: () => true,
    });
    const status = await loader.load('p1');
    expect(status).toBe('applied');
    expect(applied).toBe('p1');
  });

  it('读失败（坏 JSON）返回 failed，onApply 收到 null 且不抛错', async () => {
    let applied: PlanningIdea | null = mkPlanning();
    const loader = createPlanningLoader({
      invoke: async () => ({ success: false, error: '策划数据损坏' }),
      onApply: (_pid, planning) => { applied = planning; },
      isProjectCurrent: () => true,
    });
    const status = await loader.load('p1');
    expect(status).toBe('failed');
    expect(applied).toBeNull();
  });

  it('迟到回执被代次守卫丢弃（stale）', async () => {
    const resolvers: Array<(v: unknown) => void> = [];
    const appliedProjectIds: string[] = [];
    const loader = createPlanningLoader({
      invoke: () => new Promise(resolve => { resolvers.push(resolve); }),
      onApply: (projectId) => { appliedProjectIds.push(projectId); },
      isProjectCurrent: () => true,
    });
    const first = loader.load('p1'); // 触发加载，未完成
    const second = loader.load('p2'); // 立即切换，代次 +1
    resolvers[1]({ success: true, data: mkPlanning() }); // 先回第二个（当前）
    expect(await second).toBe('applied');
    expect(appliedProjectIds).toEqual(['p2']);
    resolvers[0]({ success: true, data: mkPlanning() }); // 迟到回执
    expect(await first).toBe('stale');
    // 迟到回执未再次触发 onApply
    expect(appliedProjectIds).toEqual(['p2']);
  });
});
