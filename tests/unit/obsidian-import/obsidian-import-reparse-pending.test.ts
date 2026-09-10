import { describe, expect, it, vi } from 'vitest';
import { createObsidianImportGuard } from '../../../src/renderer/services/obsidian-import-guard';

const drafts0 = { master: null, volumes: [], chapters: [], characters: [], worlds: [] };

describe('reparse pending 提交门禁（R4）', () => {
  it('发起 reparse 后 isReparsing 返回 true，成功后返回 false', async () => {
    let release!: (v: any) => void;
    const gate = new Promise<any>(res => { release = res; });
    const invoke = vi.fn(() => gate);
    const guard = createObsidianImportGuard({ invoke, onApply: vi.fn() });

    const p = guard.reparse({ projectId: 'p', relativePath: 'a.md', hash: 'h', slots: ['master'] });
    expect(guard.isReparsing('p', 'a.md')).toBe(true);
    release({ success: true, data: { drafts: drafts0, issues: [] } });
    await p;
    expect(guard.isReparsing('p', 'a.md')).toBe(false);
  });

  it('同候选旧请求晚回不能清除新请求的 pending', async () => {
    const pending = new Map<number, (v: any) => void>();
    let n = 0;
    const invoke = vi.fn((_ch: string, _input: any) => new Promise(res => pending.set(++n, res)));
    const guard = createObsidianImportGuard({ invoke, onApply: vi.fn(), onError: vi.fn() });

    const r1 = guard.reparse({ projectId: 'p', relativePath: 'a.md', hash: 'h', slots: ['master'] });
    const r2 = guard.reparse({ projectId: 'p', relativePath: 'a.md', hash: 'h', slots: ['master'] });

    // 旧请求（1）晚回：不应清除新请求（2）的 pending
    pending.get(1)!({ success: true, data: { drafts: drafts0, issues: [] } });
    await r1;
    expect(guard.isReparsing('p', 'a.md')).toBe(true); // 新请求仍 pending

    pending.get(2)!({ success: true, data: { drafts: drafts0, issues: [] } });
    await r2;
    expect(guard.isReparsing('p', 'a.md')).toBe(false);
  });

  it('不同候选并发互不干扰 pending', async () => {
    const pending = new Map<string, (v: any) => void>();
    const invoke = vi.fn((_ch: string, input: any) => new Promise(res => pending.set(input.relativePath, res)));
    const guard = createObsidianImportGuard({ invoke, onApply: vi.fn(), onError: vi.fn() });

    const rA = guard.reparse({ projectId: 'p', relativePath: 'a.md', hash: 'h', slots: ['master'] });
    const rB = guard.reparse({ projectId: 'p', relativePath: 'b.md', hash: 'h', slots: ['master'] });
    expect(guard.isReparsing('p', 'a.md')).toBe(true);
    expect(guard.isReparsing('p', 'b.md')).toBe(true);

    pending.get('a.md')!({ success: true, data: { drafts: drafts0, issues: [] } });
    await rA;
    expect(guard.isReparsing('p', 'a.md')).toBe(false);
    expect(guard.isReparsing('p', 'b.md')).toBe(true); // b 仍 pending

    pending.get('b.md')!({ success: true, data: { drafts: drafts0, issues: [] } });
    await rB;
    expect(guard.isReparsing('p', 'b.md')).toBe(false);
  });

  it('reparse 失败也结束 pending，且报错', async () => {
    const invoke = vi.fn(() => Promise.resolve({ success: false, error: '解析失败' }));
    const onError = vi.fn();
    const guard = createObsidianImportGuard({ invoke, onApply: vi.fn(), onError });

    const r = await guard.reparse({ projectId: 'p', relativePath: 'a.md', hash: 'h', slots: ['master'] });
    expect(r).toBeNull();
    expect(guard.isReparsing('p', 'a.md')).toBe(false);
    expect(onError).toHaveBeenCalled();
  });

  it('invalidate 清除所有 pending', async () => {
    let release!: (v: any) => void;
    const gate = new Promise<any>(res => { release = res; });
    const invoke = vi.fn(() => gate);
    const guard = createObsidianImportGuard({ invoke, onApply: vi.fn() });

    const p = guard.reparse({ projectId: 'p', relativePath: 'a.md', hash: 'h', slots: ['master'] });
    expect(guard.isReparsing('p', 'a.md')).toBe(true);
    guard.invalidate();
    expect(guard.isReparsing('p', 'a.md')).toBe(false);
    release({ success: true, data: { drafts: drafts0, issues: [] } });
    await p;
  });
});
