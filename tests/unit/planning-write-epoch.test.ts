import { describe, it, expect, beforeEach, vi } from 'vitest';

// epoch 是模块级单例 Map，测试必须隔离：每个用例重新 import 拿到全新 Map。
type EpochApi = typeof import('../../src/renderer/services/planning-write-epoch');

async function loadEpoch(): Promise<EpochApi> {
  vi.resetModules();
  return import('../../src/renderer/services/planning-write-epoch');
}

describe('planning-write-epoch（per-project 写库代数）', () => {
  beforeEach(() => { vi.resetModules(); });

  it('初始 epoch 为 0', async () => {
    const { capturePlanningWriteEpoch } = await loadEpoch();
    expect(capturePlanningWriteEpoch('p1')).toBe(0);
  });

  it('无条件 reserve 递增 token', async () => {
    const { capturePlanningWriteEpoch, reservePlanningWrite } = await loadEpoch();
    expect(reservePlanningWrite('p1')).toBe(1);
    expect(capturePlanningWriteEpoch('p1')).toBe(1);
    expect(reservePlanningWrite('p1')).toBe(2);
  });

  it('A 的 reserve 不影响 B', async () => {
    const { capturePlanningWriteEpoch, reservePlanningWrite } = await loadEpoch();
    reservePlanningWrite('p1');
    expect(capturePlanningWriteEpoch('p2')).toBe(0);
  });

  it('两个相同 captured epoch 只有第一个能 reserve', async () => {
    const { capturePlanningWriteEpoch, reservePlanningWrite } = await loadEpoch();
    const epoch = capturePlanningWriteEpoch('p1'); // 0
    expect(reservePlanningWrite('p1', epoch)).toBe(1);
    expect(reservePlanningWrite('p1', epoch)).toBeNull();
  });

  it('用户保存尚未返回时旧 AI 已失效', async () => {
    const { capturePlanningWriteEpoch, reservePlanningWrite } = await loadEpoch();
    const aiEpoch = capturePlanningWriteEpoch('p1'); // AI 长任务启动捕获 0
    reservePlanningWrite('p1'); // 用户在 AI 运行期间保存，epoch 前进到 1
    expect(reservePlanningWrite('p1', aiEpoch)).toBeNull(); // AI 用旧 epoch reserve → 过期
  });

  it('新 reserve 后旧 token 不再 current', async () => {
    const { reservePlanningWrite, isPlanningWriteCurrent } = await loadEpoch();
    const token1 = reservePlanningWrite('p1');
    expect(isPlanningWriteCurrent('p1', token1)).toBe(true);
    const token2 = reservePlanningWrite('p1');
    expect(isPlanningWriteCurrent('p1', token1)).toBe(false);
    expect(isPlanningWriteCurrent('p1', token2)).toBe(true);
  });

  it('过期 reserve 返回 null 且不回滚 token', async () => {
    const { capturePlanningWriteEpoch, reservePlanningWrite } = await loadEpoch();
    const current = capturePlanningWriteEpoch('p1'); // 0
    const token = reservePlanningWrite('p1'); // 1
    expect(reservePlanningWrite('p1', current)).toBeNull(); // 已是 1，用 0 过期
    expect(capturePlanningWriteEpoch('p1')).toBe(token); // 仍 1，不回滚
  });
});
