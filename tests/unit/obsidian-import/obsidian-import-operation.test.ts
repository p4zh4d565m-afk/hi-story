import { describe, expect, it } from 'vitest';
import { createOperationRegistry, hashCanonicalCommitInput } from '../../../src/main/ipc/obsidian-import.ipc';

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
    expect(hashCanonicalCommitInput(circular)).toBe('invalid_input');
  });
});
