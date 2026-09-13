import { describe, it, expect, vi } from 'vitest';
import type { PlanningIdea } from '../../src/renderer/types';
import type { SavePlanningIdeaInput } from '../../src/main/db/repositories/planning.repo';
import { persistPlanning } from '../../src/renderer/services/planning-persistence';
import { capturePlanningWriteEpoch, reservePlanningWrite, isPlanningWriteCurrent } from '../../src/renderer/services/planning-write-epoch';

function mkPlanning(): PlanningIdea {
  return {
    id: 'p1', projectId: 'p1', idea: 'idea', requirements: '', generatedOptions: [], selectedOption: null,
    status: 'draft', masterOutline: null, outlineStatus: 'empty', volumeOutlines: [], volumeStatus: 'empty',
    chapterOutlines: [], chapterOutlineStatus: 'empty', createdAt: '', updatedAt: '',
  };
}

function input(over: Partial<SavePlanningIdeaInput> = {}): Omit<SavePlanningIdeaInput, 'projectId'> {
  return { idea: 'idea', ...over };
}

describe('persistPlanning（reserve 后发 IPC）', () => {
  it('普通保存成功返回 saved + 完整 planning', async () => {
    const invoke = vi.fn(async () => ({ success: true, data: mkPlanning() }));
    const out = await persistPlanning(invoke, 'p1', input());
    expect(out.kind).toBe('saved');
    if (out.kind === 'saved') {
      expect(out.planning.idea).toBe('idea');
      expect(isPlanningWriteCurrent('p1', out.token)).toBe(true);
    }
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('旧 AI 在用户 save 已 reserve 但 IPC 未回时直接 superseded，不发 IPC', async () => {
    const aiEpoch = capturePlanningWriteEpoch('p1'); // AI 启动捕获 0
    reservePlanningWrite('p1'); // 用户保存，epoch 前进到 1，IPC 尚未返回
    const invoke = vi.fn(async () => ({ success: true, data: mkPlanning() }));
    const out = await persistPlanning(invoke, 'p1', input(), { expectedEpoch: aiEpoch });
    expect(out.kind).toBe('superseded');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('两个旧 AI 只一个发 IPC', async () => {
    const epoch = capturePlanningWriteEpoch('p1'); // 两个 AI 都捕获 0
    const invoke = vi.fn(async () => ({ success: true, data: mkPlanning() }));
    const first = await persistPlanning(invoke, 'p1', input(), { expectedEpoch: epoch });
    const second = await persistPlanning(invoke, 'p1', input(), { expectedEpoch: epoch });
    expect(first.kind).toBe('saved');
    expect(second.kind).toBe('superseded');
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('success 但缺 data 是 failed', async () => {
    const invoke = vi.fn(async () => ({ success: true, data: null }));
    const out = await persistPlanning(invoke, 'p1', input());
    expect(out.kind).toBe('failed');
    if (out.kind === 'failed') expect(out.error).toBe('保存策划内容失败');
  });

  it('success:false 是 failed', async () => {
    const invoke = vi.fn(async () => ({ success: false, error: '坏了' }));
    const out = await persistPlanning(invoke, 'p1', input());
    expect(out.kind).toBe('failed');
    if (out.kind === 'failed') expect(out.error).toBe('坏了');
  });

  it('reject 是 failed', async () => {
    const invoke = vi.fn(async () => { throw new Error('网络炸'); });
    const out = await persistPlanning(invoke, 'p1', input());
    expect(out.kind).toBe('failed');
    if (out.kind === 'failed') expect(out.error).toBe('网络炸');
  });

  it('迟到 saved 的回执 token 已非 current', async () => {
    const pid = 'persist-late';
    const invoke = vi.fn(async () => ({ success: true, data: mkPlanning() }));
    // 用受控 Promise 制造「写库期间又有更新」：先发一次，再在它未返回时触发第二次 reserve
    let resolve!: (v: unknown) => void;
    const slowInvoke = vi.fn(() => new Promise(r => { resolve = r; }));
    const slow = persistPlanning(slowInvoke, pid, input());
    reservePlanningWrite(pid); // 写库期间用户又保存
    resolve({ success: true, data: mkPlanning() });
    const out = await slow;
    expect(out.kind).toBe('saved');
    if (out.kind === 'saved') expect(isPlanningWriteCurrent(pid, out.token)).toBe(false);
    // 调用方据此不更新 UI；这里证明 token 已失效
    expect(invoke).not.toHaveBeenCalled();
  });

  it('失败不回滚 token', async () => {
    const pid = 'persist-no-rollback';
    const captured = capturePlanningWriteEpoch(pid);
    const invoke = vi.fn(async () => ({ success: false, error: 'boom' }));
    const out = await persistPlanning(invoke, pid, input(), { expectedEpoch: captured });
    expect(out.kind).toBe('failed');
    if (out.kind === 'failed') {
      expect(out.token).toBe(captured + 1);
      expect(capturePlanningWriteEpoch(pid)).toBe(out.token);
      expect(isPlanningWriteCurrent(pid, out.token)).toBe(true);
    }
  });
});
