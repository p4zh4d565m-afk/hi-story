import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAYOUT, DEFAULT_SLOT,
  movePanel, closePanel, setActive, panelSlot, isSlotVisible,
  openKeepAlive, closeKeepAlive,
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

  it('写章默认槽是 bottom（3+3 定案；打开走 openKeepAlive 不走 movePanel）', () => {
    expect(DEFAULT_SLOT.aiWrite).toBe('bottom');
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

  it('aiChat 完全拒绝 movePanel；三个保活面板跨槽拖也拒绝', () => {
    const fixed = ['aiChat', 'aiWrite', 'aiReview', 'aiPolish'];
    for (const pid of fixed) {
      for (const target of ['left', 'right', 'bottom', 'center', 'floating'] as const) {
        expect(movePanel(DEFAULT_LAYOUT, pid as any, target)).toEqual(DEFAULT_LAYOUT);
      }
    }
  });

  it('DEFAULT_SLOT 3+3：大纲/素材/伏笔 right，写章/审稿/润色 bottom', () => {
    expect(DEFAULT_SLOT.outline).toBe('right');
    expect(DEFAULT_SLOT.material).toBe('right');
    expect(DEFAULT_SLOT.foreshadowing).toBe('right');
    expect(DEFAULT_SLOT.aiWrite).toBe('bottom');
    expect(DEFAULT_SLOT.aiReview).toBe('bottom');
    expect(DEFAULT_SLOT.aiPolish).toBe('bottom');
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

  it('往返保持', () => {
    const l = movePanel(DEFAULT_LAYOUT, 'outline', 'right');
    const round = parseLayout(serializeLayout(l));
    expect(round).toEqual(l);
  });
});

describe('保活面板（openKeepAlive/closeKeepAlive）', () => {
  it('openKeepAlive 固定进 bottom 并设 active', () => {
    const next = openKeepAlive(DEFAULT_LAYOUT, 'aiWrite');
    expect(next.slots.bottom.panelIds).toEqual(['aiWrite']);
    expect(next.slots.bottom.activeId).toBe('aiWrite');
  });

  it('打开第二个保活面板：追加到 bottom、active 切过去、原面板仍在', () => {
    let l = openKeepAlive(DEFAULT_LAYOUT, 'aiWrite');
    l = openKeepAlive(l, 'aiReview');
    expect(l.slots.bottom.panelIds).toEqual(['aiWrite', 'aiReview']);
    expect(l.slots.bottom.activeId).toBe('aiReview');
  });

  it('重复打开已存在的保活面板只切 active 不重复追加', () => {
    let l = openKeepAlive(DEFAULT_LAYOUT, 'aiWrite');
    l = openKeepAlive(l, 'aiReview');
    l = openKeepAlive(l, 'aiWrite');
    expect(l.slots.bottom.panelIds).toEqual(['aiWrite', 'aiReview']);
    expect(l.slots.bottom.activeId).toBe('aiWrite');
  });

  it('closeKeepAlive 从 bottom 移除，active 回落到剩余', () => {
    let l = openKeepAlive(DEFAULT_LAYOUT, 'aiWrite');
    l = openKeepAlive(l, 'aiReview');
    const next = closeKeepAlive(l, 'aiWrite');
    expect(next.slots.bottom.panelIds).toEqual(['aiReview']);
    expect(next.slots.bottom.activeId).toBe('aiReview');
  });

  it('非保活面板 openKeepAlive/closeKeepAlive 原样返回', () => {
    expect(openKeepAlive(DEFAULT_LAYOUT, 'outline')).toEqual(DEFAULT_LAYOUT);
    expect(closeKeepAlive(DEFAULT_LAYOUT, 'outline')).toEqual(DEFAULT_LAYOUT);
  });
});
