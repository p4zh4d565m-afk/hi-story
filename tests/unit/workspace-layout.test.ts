import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAYOUT, DEFAULT_SLOT,
  movePanel, closePanel, setActive, panelSlot, isSlotVisible,
} from '../../src/renderer/workspace/layout-model';
import { parseLayout, serializeLayout } from '../../src/renderer/workspace/layout-storage';

function layoutWith(panelIds: { left?: string[]; right?: string[]; bottom?: string[] }): typeof DEFAULT_LAYOUT {
  const slots = {
    left: { panelIds: panelIds.left ?? [], activeId: null },
    right: { panelIds: panelIds.right ?? [], activeId: null },
    bottom: { panelIds: panelIds.bottom ?? [], activeId: null },
  };
  return { version: 1, slots, floating: [] };
}

describe('layout-model：movePanel', () => {
  it('打开大纲默认进 right，且设为 active', () => {
    const next = movePanel(DEFAULT_LAYOUT, 'outline', DEFAULT_SLOT.outline!);
    expect(next.slots.right.panelIds).toEqual(['outline']);
    expect(next.slots.right.activeId).toBe('outline');
  });

  it('跨槽移动：从 right 移到 bottom，原槽移除', () => {
    const l = movePanel(DEFAULT_LAYOUT, 'outline', 'right');
    const next = movePanel(l, 'outline', 'bottom');
    expect(next.slots.right.panelIds).toEqual([]);
    expect(next.slots.right.activeId).toBeNull();
    expect(next.slots.bottom.panelIds).toEqual(['outline']);
  });

  it('center 目标落到 bottom（写作区不可被占）', () => {
    const next = movePanel(DEFAULT_LAYOUT, 'outline', 'center');
    expect(next.slots.bottom.panelIds).toEqual(['outline']);
  });

  it('sidebar 拒绝进非 left（返回原 layout 不变）', () => {
    const next = movePanel(DEFAULT_LAYOUT, 'sidebar', 'right');
    expect(next).toEqual(DEFAULT_LAYOUT);
  });

  it('aiChat 与写章/审稿/润色（浮动窗）都不走 movePanel', () => {
    const fixed = ['aiChat', 'aiWrite', 'aiReview', 'aiPolish'];
    for (const pid of fixed) {
      for (const target of ['left', 'right', 'bottom', 'center', 'floating'] as const) {
        expect(movePanel(DEFAULT_LAYOUT, pid as any, target)).toEqual(DEFAULT_LAYOUT);
      }
    }
  });

  it('DEFAULT_SLOT：大纲/素材/伏笔/灵感/参考/起名 right（写章/审稿/润色已回浮动窗，无默认槽）', () => {
    expect(DEFAULT_SLOT.outline).toBe('right');
    expect(DEFAULT_SLOT.material).toBe('right');
    expect(DEFAULT_SLOT.foreshadowing).toBe('right');
    expect(DEFAULT_SLOT.inspiration).toBe('right');
    expect(DEFAULT_SLOT.reference).toBe('right');
    expect(DEFAULT_SLOT.namegen).toBe('right');
    expect(DEFAULT_SLOT.aiWrite).toBeUndefined();
    expect(DEFAULT_SLOT.aiReview).toBeUndefined();
    expect(DEFAULT_SLOT.aiPolish).toBeUndefined();
  });

  it('导图之外的面板不接受 floating', () => {
    expect(movePanel(DEFAULT_LAYOUT, 'outline', 'floating')).toEqual(DEFAULT_LAYOUT);
  });
});

describe('layout-model：closePanel / setActive / 查询', () => {
  it('closePanel 清空槽并置 activeId=null', () => {
    const l = movePanel(DEFAULT_LAYOUT, 'outline', 'right');
    const next = closePanel(l, 'outline');
    expect(next.slots.right.panelIds).toEqual([]);
    expect(next.slots.right.activeId).toBeNull();
  });

  it('closePanel 移除槽内某面板时，active 落到剩余面板', () => {
    let l = movePanel(DEFAULT_LAYOUT, 'outline', 'right');
    l = movePanel(l, 'material', 'right');
    const next = closePanel(l, 'outline');
    expect(next.slots.right.panelIds).toEqual(['material']);
    expect(next.slots.right.activeId).toBe('material');
  });

  it('setActive 切换槽内标签', () => {
    let l = movePanel(DEFAULT_LAYOUT, 'outline', 'right');
    l = movePanel(l, 'material', 'right');
    const next = setActive(l, 'right', 'material');
    expect(next.slots.right.activeId).toBe('material');
  });

  it('panelSlot 查归属', () => {
    const l = movePanel(DEFAULT_LAYOUT, 'outline', 'right');
    expect(panelSlot(l, 'outline')).toBe('right');
    expect(panelSlot(l, 'nonexistent')).toBeNull();
  });

  it('isSlotVisible 空槽 false、有面板 true', () => {
    const l = movePanel(DEFAULT_LAYOUT, 'outline', 'right');
    expect(isSlotVisible(l, 'right')).toBe(true);
    expect(isSlotVisible(l, 'bottom')).toBe(false);
  });
});

describe('layout-storage', () => {
  it('坏 JSON / 版本错 / 缺 slots 回默认', () => {
    expect(parseLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout('{')).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout(JSON.stringify({ version: 2, slots: {} }))).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout(JSON.stringify({ version: 1 }))).toEqual(DEFAULT_LAYOUT);
  });

  it('未知 panelId 丢弃、activeId 不在列表内回落到剩余', () => {
    const raw = JSON.stringify({
      version: 1,
      slots: {
        left: { panelIds: ['sidebar'], activeId: 'sidebar' },
        right: { panelIds: ['outline', 'unknown_panel'], activeId: 'unknown_panel' },
        bottom: { panelIds: [], activeId: null },
      },
      floating: [],
    });
    const parsed = parseLayout(raw);
    expect(parsed.slots.right.panelIds).toEqual(['outline']);
    expect(parsed.slots.right.activeId).toBe('outline');
  });

  it('floating 只保留导图', () => {
    const raw = JSON.stringify({
      version: 1,
      slots: {
        left: { panelIds: ['sidebar'], activeId: 'sidebar' },
        right: { panelIds: [], activeId: null },
        bottom: { panelIds: [], activeId: null },
      },
      floating: ['mindmap', 'outline'],
    });
    expect(parseLayout(raw).floating).toEqual(['mindmap']);
  });

  it('旧 bottom 残留的写章/审稿/润色被剥掉（锁双窗回归）', () => {
    const raw = JSON.stringify({
      version: 1,
      slots: {
        left: { panelIds: ['sidebar'], activeId: 'sidebar' },
        right: { panelIds: [], activeId: null },
        bottom: { panelIds: ['aiWrite', 'aiReview', 'aiPolish', 'outline'], activeId: 'aiWrite' },
      },
      floating: [],
    });
    const parsed = parseLayout(raw);
    expect(parsed.slots.bottom.panelIds).toEqual(['outline']);
    expect(parsed.slots.bottom.activeId).toBe('outline');
  });

  it('往返保持', () => {
    const l = movePanel(DEFAULT_LAYOUT, 'outline', 'right');
    const round = parseLayout(serializeLayout(l));
    expect(round).toEqual(l);
  });
});
