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

  it('不同候选并发 reparse 都生效（候选级代次互不干扰）', async () => {
    const pending = new Map<string, (v: any) => void>();
    const invoke = vi.fn((_ch: string, input: any) => new Promise(res => pending.set(input.relativePath, res)));
    const guard = createObsidianImportGuard({ invoke, onApply: vi.fn(), onError: vi.fn() });
    const rA = guard.reparse({ projectId: 'p', relativePath: 'a.md', hash: 'h', slots: ['master'] });
    const rB = guard.reparse({ projectId: 'p', relativePath: 'b.md', hash: 'h', slots: ['master'] });
    pending.get('b.md')!({ success: true, data: { drafts: { master: { premise: 'B' }, volumes: [], chapters: [], characters: [], worlds: [] }, issues: [] } });
    pending.get('a.md')!({ success: true, data: { drafts: { master: { premise: 'A' }, volumes: [], chapters: [], characters: [], worlds: [] }, issues: [] } });
    const [a, b] = await Promise.all([rA, rB]);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect((a as any).drafts.master.premise).toBe('A');
    expect((b as any).drafts.master.premise).toBe('B');
  });

  it('同一候选快速连续 reparse 只保留最后一次', async () => {
    const pending = new Map<number, (v: any) => void>();
    let n = 0;
    const invoke = vi.fn((_ch: string, _input: any) => new Promise(res => pending.set(++n, res)));
    const guard = createObsidianImportGuard({ invoke, onApply: vi.fn(), onError: vi.fn() });
    const r1 = guard.reparse({ projectId: 'p', relativePath: 'a.md', hash: 'h', slots: ['master'] });
    const r2 = guard.reparse({ projectId: 'p', relativePath: 'a.md', hash: 'h', slots: ['master'] });
    // 第一次先返回，但应被忽略（代次已推进到第二次）
    pending.get(1)!({ success: true, data: { drafts: { master: { premise: '旧' }, volumes: [], chapters: [], characters: [], worlds: [] }, issues: [] } });
    const stale = await r1;
    expect(stale).toBeNull();
    pending.get(2)!({ success: true, data: { drafts: { master: { premise: '新' }, volumes: [], chapters: [], characters: [], worlds: [] }, issues: [] } });
    const fresh = await r2;
    expect((fresh as any).drafts.master.premise).toBe('新');
  });
});
