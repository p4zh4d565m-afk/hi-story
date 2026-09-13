import { describe, expect, it } from 'vitest';
import {
  isAiChatVisible, isRightAuxOpen, splitOpenFlags,
  horizontalPanelIds, centerPanelIds, verticalPanelIds,
} from '../../src/renderer/workspace/split-flags';

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

describe('panelIds（P2 修复 30c08f1 的回归锚点）', () => {
  it('horizontal：无右栏只有 left+center，有右栏加 right', () => {
    expect(horizontalPanelIds({ left: true, ai: false, rightAux: false })).toEqual(['left', 'center']);
    expect(horizontalPanelIds({ left: true, ai: false, rightAux: true })).toEqual(['left', 'center', 'right']);
  });

  it('center：无 AI 只有 editor，有 AI 加 ai', () => {
    expect(centerPanelIds({ left: true, ai: false, rightAux: false })).toEqual(['editor']);
    expect(centerPanelIds({ left: true, ai: true, rightAux: false })).toEqual(['editor', 'ai']);
  });

  it('vertical：bottom 有面板才挂，否则只 main', () => {
    expect(verticalPanelIds(true)).toEqual(['main', 'bottom']);
    expect(verticalPanelIds(false)).toEqual(['main']);
  });
});
