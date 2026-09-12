import { describe, expect, it } from 'vitest';
import { applyRightAuxExclusive, toggleRightAux } from '../../src/renderer/workspace/right-aux-panels';
import { clampFloatingRect } from '../../src/renderer/workspace/floating-rect';
import { parsePanelWidths, serializePanelWidths } from '../../src/renderer/workspace/panel-widths';

const aux = {
  inspirationOpen: false,
  referenceOpen: false,
  namegenOpen: false,
};

describe('右栏辅助面板互斥', () => {
  it('打开参考会关掉已开的灵感和起名', () => {
    const opened = applyRightAuxExclusive(
      { ...aux, inspirationOpen: true, namegenOpen: true, sidebarOpen: true },
      'referenceOpen',
      true,
    );
    expect(opened).toMatchObject({
      inspirationOpen: false,
      referenceOpen: true,
      namegenOpen: false,
      sidebarOpen: true,
    });
  });

  it('关闭当前栏不把其它栏打开', () => {
    const closed = applyRightAuxExclusive(
      { ...aux, referenceOpen: true },
      'referenceOpen',
      false,
    );
    expect(closed).toEqual({ ...aux, referenceOpen: false });
  });

  it('再点已打开的栏是关闭', () => {
    const toggled = toggleRightAux({ ...aux, namegenOpen: true }, 'namegenOpen');
    expect(toggled.namegenOpen).toBe(false);
    expect(toggled.inspirationOpen).toBe(false);
    expect(toggled.referenceOpen).toBe(false);
  });

  it('点关闭着的栏会打开它并关掉其它', () => {
    const toggled = toggleRightAux({ ...aux, inspirationOpen: true }, 'namegenOpen');
    expect(toggled).toMatchObject({
      inspirationOpen: false,
      referenceOpen: false,
      namegenOpen: true,
    });
  });
});

describe('浮窗矩形夹紧视口', () => {
  const viewport = { width: 1400, height: 900 };

  it('飞出右侧时把标题栏拉回视口', () => {
    const next = clampFloatingRect({ x: 2000, y: 80, w: 500, h: 400 }, viewport);
    expect(next.x + 48).toBeLessThanOrEqual(viewport.width);
    expect(next.y).toBeGreaterThanOrEqual(0);
    expect(next.w).toBe(500);
    expect(next.h).toBe(400);
  });

  it('尺寸超过视口时缩小到视口', () => {
    const next = clampFloatingRect({ x: -20, y: -20, w: 3000, h: 2000 }, viewport);
    expect(next.w).toBe(viewport.width);
    expect(next.h).toBe(viewport.height);
    expect(next.x).toBeGreaterThanOrEqual(48 - next.w);
    expect(next.y).toBeGreaterThanOrEqual(0);
  });

  it('小于最小值时抬到 300×200', () => {
    const next = clampFloatingRect({ x: 10, y: 10, w: 80, h: 50 }, viewport);
    expect(next.w).toBe(300);
    expect(next.h).toBe(200);
  });

  it('视口比最小值更小时贴边且不抛', () => {
    const next = clampFloatingRect(
      { x: 400, y: 400, w: 500, h: 400 },
      { width: 200, height: 150 },
    );
    expect(next.w).toBe(200);
    expect(next.h).toBe(150);
    expect(next.x).toBe(0);
    expect(next.y).toBe(0);
  });
});

describe('三栏宽度持久化', () => {
  it('空值回默认', () => {
    expect(parsePanelWidths(null)).toEqual({
      version: 1,
      sidebar: 280,
      aiChat: 380,
      insp: 360,
    });
  });

  it('合法值往返保持夹紧后的整数', () => {
    const raw = serializePanelWidths({ sidebar: 300, aiChat: 420, insp: 400 });
    expect(parsePanelWidths(raw)).toEqual({
      version: 1,
      sidebar: 300,
      aiChat: 420,
      insp: 400,
    });
  });

  it('坏 JSON、错误版本、非数字都回默认', () => {
    expect(parsePanelWidths('{')).toEqual(parsePanelWidths(null));
    expect(parsePanelWidths(JSON.stringify({ version: 2, sidebar: 300 }))).toEqual(parsePanelWidths(null));
    expect(parsePanelWidths(JSON.stringify({
      version: 1,
      sidebar: 'wide',
      aiChat: Number.NaN,
      insp: Infinity,
    }))).toEqual(parsePanelWidths(null));
  });

  it('越界宽度夹进现有 splitter 限制', () => {
    const parsed = parsePanelWidths(JSON.stringify({
      version: 1,
      sidebar: 10,
      aiChat: 9999,
      insp: 301.8,
    }));
    expect(parsed.sidebar).toBe(200);
    expect(parsed.aiChat).toBe(700);
    expect(parsed.insp).toBe(302);
  });
});
