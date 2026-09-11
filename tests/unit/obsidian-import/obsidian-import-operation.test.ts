import { describe, expect, it } from 'vitest';
import { createOperationRegistry, hashCanonicalCommitInput, INVALID_INPUT_FINGERPRINT } from '../../../src/main/ipc/obsidian-import.ipc';

describe('operationId 进程内幂等', () => {
  it('相同 operationId + 同指纹并发只执行一次并返回同一结果', async () => {
    const reg = createOperationRegistry();
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const run = async () => { calls++; await gate; return { success: true as const, data: { n: calls } }; };
    const first = reg.execute('p1', 'op-x', 'hash-a', run);
    const second = reg.execute('p1', 'op-x', 'hash-a', run);
    release();
    const [r1, r2] = await Promise.all([first, second]);
    expect(r1).toEqual(r2);
    expect(calls).toBe(1);
  });

  it('相同 operationId 但指纹不同被拒绝', async () => {
    const reg = createOperationRegistry();
    const first = await reg.execute('p1', 'same', 'hash-a', async () => ({ success: true as const, data: 1 }));
    const second = await reg.execute('p1', 'same', 'hash-b', async () => ({ success: true as const, data: 2 }));
    expect(first.success).toBe(true);
    expect(second).toEqual({ success: false, error: 'operationId 已用于不同的导入内容' });
  });

  it('不同项目相同 operationId 分别执行', async () => {
    const reg = createOperationRegistry();
    let calls = 0;
    const run = async () => { calls++; return { success: true as const, data: calls }; };
    await reg.execute('p1', 'op', 'h', run);
    await reg.execute('p2', 'op', 'h', run);
    expect(calls).toBe(2);
  });
});

describe('hashCanonicalCommitInput', () => {
  it('对象键顺序不同得到同一指纹', () => {
    const a = hashCanonicalCommitInput({ b: 1, a: 2 } as any);
    const b = hashCanonicalCommitInput({ a: 2, b: 1 } as any);
    expect(a).toBe(b);
  });
  it('数组顺序不同得到不同指纹', () => {
    const a = hashCanonicalCommitInput({ arr: [1, 2] } as any);
    const b = hashCanonicalCommitInput({ arr: [2, 1] } as any);
    expect(a).not.toBe(b);
  });
  it('非法输入返回 invalid_input', () => {
    const circular: any = {};
    circular.self = circular;
    expect(hashCanonicalCommitInput(circular)).toBe(INVALID_INPUT_FINGERPRINT);
  });
  it('嵌套循环引用（数组/对象内环）返回 invalid_input', () => {
    const circular: any = { arr: [] };
    circular.arr.push(circular);
    expect(hashCanonicalCommitInput(circular)).toBe(INVALID_INPUT_FINGERPRINT);
  });
  it('超预算输入返回 invalid_input', () => {
    // 单个字段超过 64 MiB 预算
    const huge: any = { selections: [{ relativePath: 'a.md', hash: 'h', slots: ['master'], defaultVolumeIndex: null, characterOverrides: [{ sourceName: 'x'.repeat(70 * 1024 * 1024), name: 'x', overwrite: false }], worldOverrides: [] }] };
    expect(hashCanonicalCommitInput(huge)).toBe(INVALID_INPUT_FINGERPRINT);
  });
  it('合法输入仍得到稳定指纹（不误伤）', () => {
    const valid: any = { projectId: 'p1', operationId: 'op', selections: [{ relativePath: 'a.md', hash: 'a'.repeat(64), slots: ['master'], defaultVolumeIndex: null, characterOverrides: [], worldOverrides: [] }], layerChoices: { master: { action: 'keep', unlockLocked: false }, volumes: { action: 'keep', unlockLocked: false }, chapters: { action: 'keep', unlockLocked: false } } };
    const h = hashCanonicalCommitInput(valid);
    expect(h).not.toBe(INVALID_INPUT_FINGERPRINT);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
  it('共享引用（非环 DAG）得到稳定指纹而非 invalid_input', () => {
    const decision = { action: 'keep', unlockLocked: false };
    const input: any = {
      projectId: 'p', operationId: 'op', selections: [],
      layerChoices: { master: decision, volumes: decision, chapters: decision },
    };
    const h = hashCanonicalCommitInput(input);
    expect(h).not.toBe(INVALID_INPUT_FINGERPRINT);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
  it('真实循环（回到祖先对象）仍返回 invalid_input', () => {
    const a: any = { name: 'a' };
    a.child = a;
    expect(hashCanonicalCommitInput(a)).toBe(INVALID_INPUT_FINGERPRINT);
  });
});
