import { describe, expect, it } from 'vitest';
import { computeLayerFinalState } from '../../../src/main/obsidian/layer-actions';
import type { ImportLayerChoices } from '../../../src/renderer/types';

const layers = {
  master: { exists: true, locked: true },
  volumes: { exists: true, locked: false },
  chapters: { exists: true, locked: false },
};

const choices = (over: Partial<ImportLayerChoices> = {}): ImportLayerChoices => ({
  master: { action: 'keep', unlockLocked: false },
  volumes: { action: 'keep', unlockLocked: false },
  chapters: { action: 'keep', unlockLocked: false },
  ...over,
});

describe('computeLayerFinalState：UI 与主进程共享的动作语义', () => {
  it('keep 保留所有层，无原因', () => {
    const r = computeLayerFinalState(layers, choices(), { master: false, volumes: false, chapters: false });
    expect(r.final).toEqual({ master: true, volumes: true, chapters: true });
    expect(r.reasons).toEqual([]);
  });

  it('clear 锁定层未解锁产生原因', () => {
    const r = computeLayerFinalState(layers, choices({ master: { action: 'clear', unlockLocked: false } }), { master: false, volumes: false, chapters: false });
    expect(r.reasons.some(s => s.includes('锁定'))).toBe(true);
  });

  it('replace 无来源产生原因', () => {
    const r = computeLayerFinalState(layers, choices({ master: { action: 'replace', unlockLocked: true } }), { master: false, volumes: false, chapters: false });
    expect(r.reasons.some(s => s.includes('没有'))).toBe(true);
  });

  it('fill 目标空且无来源产生原因', () => {
    const emptyLayers = { master: { exists: false, locked: false }, volumes: { exists: false, locked: false }, chapters: { exists: false, locked: false } };
    const r = computeLayerFinalState(emptyLayers, choices({ master: { action: 'fill', unlockLocked: false } }), { master: false, volumes: false, chapters: false });
    expect(r.reasons.some(s => s.includes('没有'))).toBe(true);
  });

  it('清空总纲但保留分卷纲 → 分卷纲不变量原因', () => {
    const r = computeLayerFinalState(layers, choices({ master: { action: 'clear', unlockLocked: true }, volumes: { action: 'keep', unlockLocked: false } }), { master: false, volumes: false, chapters: false });
    expect(r.reasons.some(s => s.includes('分卷纲'))).toBe(true);
  });

  it('替换总纲但分卷 keep → 上下游约束原因', () => {
    const r = computeLayerFinalState(layers, choices({ master: { action: 'replace', unlockLocked: true }, volumes: { action: 'keep', unlockLocked: false } }), { master: true, volumes: false, chapters: false });
    expect(r.reasons.some(s => s.includes('分卷纲'))).toBe(true);
  });

  it('clear 后章纲仍指向卷 → 章纲不变量原因', () => {
    const r = computeLayerFinalState(layers, choices({ volumes: { action: 'clear', unlockLocked: true }, chapters: { action: 'keep', unlockLocked: false } }), { master: false, volumes: false, chapters: false });
    expect(r.reasons.some(s => s.includes('章纲'))).toBe(true);
  });
});
