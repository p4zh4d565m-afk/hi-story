import { describe, expect, it } from 'vitest';
import { isAiChatVisible, isRightAuxOpen, splitOpenFlags } from '../../src/renderer/workspace/split-flags';

describe('split-flags（槽展开判断）', () => {
  it('left 跟随 sidebarOpen', () => {
    expect(splitOpenFlags({
      sidebarOpen: true, aiChatOpen: false, aiChatMinimized: false, aiLevel: 'off',
      inspirationOpen: false, referenceOpen: false, namegenOpen: false,
    }).left).toBe(true);
    expect(splitOpenFlags({
      sidebarOpen: false, aiChatOpen: false, aiChatMinimized: false, aiLevel: 'off',
      inspirationOpen: false, referenceOpen: false, namegenOpen: false,
    }).left).toBe(false);
  });

  it('AI 在 off 或最小化时不算展开', () => {
    expect(isAiChatVisible({ aiChatOpen: true, aiChatMinimized: false, aiLevel: 'assist' })).toBe(true);
    expect(isAiChatVisible({ aiChatOpen: true, aiChatMinimized: false, aiLevel: 'off' })).toBe(false);
    expect(isAiChatVisible({ aiChatOpen: true, aiChatMinimized: true, aiLevel: 'assist' })).toBe(false);
    expect(isAiChatVisible({ aiChatOpen: false, aiChatMinimized: false, aiLevel: 'assist' })).toBe(false);
  });

  it('右栏三布尔任一为真即展开', () => {
    expect(isRightAuxOpen({ inspirationOpen: false, referenceOpen: false, namegenOpen: false })).toBe(false);
    expect(isRightAuxOpen({ inspirationOpen: true, referenceOpen: false, namegenOpen: false })).toBe(true);
    expect(isRightAuxOpen({ inspirationOpen: false, referenceOpen: true, namegenOpen: false })).toBe(true);
    expect(isRightAuxOpen({ inspirationOpen: false, referenceOpen: false, namegenOpen: true })).toBe(true);
  });
});
