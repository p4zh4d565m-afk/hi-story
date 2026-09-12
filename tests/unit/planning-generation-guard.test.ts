import { describe, it, expect } from 'vitest';
import { shouldApplyPlanningResult } from '../../src/renderer/services/planning-generation-guard';

describe('shouldApplyPlanningResult', () => {
  it('同项目 → 允许应用到界面', () => {
    expect(shouldApplyPlanningResult('A', 'A')).toBe(true);
  });

  it('切到另一项目 → 禁止应用到界面', () => {
    expect(shouldApplyPlanningResult('A', 'B')).toBe(false);
  });

  it('当前项目为空（已切走/卸载）→ 禁止应用', () => {
    expect(shouldApplyPlanningResult('A', null)).toBe(false);
  });
});
