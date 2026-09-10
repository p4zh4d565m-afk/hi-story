import { describe, expect, it, vi } from 'vitest';
import { createObsidianImportGuard } from '../../../src/renderer/services/obsidian-import-guard';

describe('Obsidian 导入 guard 竞态', () => {
  it('旧项目迟到回执被忽略', async () => {
    const pending = new Map<string, (v: any) => void>();
    const invoke = vi.fn((_ch: string, projectId: string) => new Promise(res => pending.set(projectId, res)));
    const onApply = vi.fn();
    const guard = createObsidianImportGuard({ invoke, onApply });
    const pa = guard.prepare('a');
    const pb = guard.prepare('b');
    pending.get('b')!({ success: true, data: { status: 'ready', candidates: [] } });
    pending.get('a')!({ success: true, data: { status: 'ready', candidates: [] } });
    await Promise.all([pa, pb]);
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith('b', expect.anything());
  });

  it('reparse 同项目乱序返回时，旧代次被忽略', async () => {
    const pending = new Map<number, (v: any) => void>();
    let n = 0;
    const invoke = vi.fn((_ch: string, input: any) => new Promise(res => pending.set(++n, res)));
    const onError = vi.fn();
    const guard = createObsidianImportGuard({ invoke, onApply: vi.fn(), onError });
    const r1 = guard.reparse({ projectId: 'p', relativePath: 'a.md', hash: 'h', slots: ['master'] });
    const r2 = guard.reparse({ projectId: 'p', relativePath: 'b.md', hash: 'h', slots: ['master'] });
    // 第二次先返回
    pending.get(2)!({ success: true, data: { drafts: { master: null, volumes: [], chapters: [], characters: [], worlds: [] }, issues: [] } });
    pending.get(1)!({ success: true, data: { drafts: { master: null, volumes: [], chapters: [], characters: [], worlds: [] }, issues: [] } });
    await Promise.all([r1, r2]);
    expect(onError).not.toHaveBeenCalled();
  });
});
