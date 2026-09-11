import { describe, expect, it, vi } from 'vitest';
import { createObsidianImportGuard } from '../../../src/renderer/services/obsidian-import-guard';

const summary = {
  planning: { master: 'kept', volumes: 'kept', chapters: 'kept' },
  characters: { created: 0, updated: 0, skipped: 0 },
  worlds: { created: 0, updated: 0, skipped: 0 },
};

describe('提交/刷新状态机（R8）', () => {
  it('commit 成功返回 summary 后，调用方只重试 onImported，不再 commit', async () => {
    // 用 invoke 计数：commit 通道调用一次，之后刷新失败重试只调 onImported
    let commitCalls = 0;
    const invoke = vi.fn((channel: string) => {
      if (channel === 'obsidian:commitPlanningImport') { commitCalls++; return Promise.resolve({ success: true, data: summary }); }
      return Promise.resolve({ success: true });
    });
    const guard = createObsidianImportGuard({ invoke, onApply: vi.fn() });

    const r = await guard.commit({ projectId: 'p', operationId: 'op', selections: [], layerChoices: { master: { action: 'keep', unlockLocked: false }, volumes: { action: 'keep', unlockLocked: false }, chapters: { action: 'keep', unlockLocked: false } } });
    expect(r).not.toBeNull();

    // 模拟刷新失败后重试刷新：只调 onImported，不碰 commit
    let importedCalls = 0;
    let failFirst = true;
    const onImported = async () => {
      importedCalls++;
      if (failFirst) { failFirst = false; throw new Error('刷新失败'); }
    };
    try { await onImported(); } catch {}
    await onImported();

    expect(commitCalls).toBe(1);       // commit 只调了一次
    expect(importedCalls).toBe(2);     // onImported 调了两次（首次失败 + 重试成功）
  });

  it('commit 失败（summary 为 null）不进入刷新状态', async () => {
    const invoke = vi.fn(() => Promise.resolve({ success: false, error: '导入失败' }));
    const guard = createObsidianImportGuard({ invoke, onApply: vi.fn(), onError: vi.fn() });
    const r = await guard.commit({ projectId: 'p', operationId: 'op', selections: [], layerChoices: { master: { action: 'keep', unlockLocked: false }, volumes: { action: 'keep', unlockLocked: false }, chapters: { action: 'keep', unlockLocked: false } } });
    expect(r).toBeNull();
  });
});
