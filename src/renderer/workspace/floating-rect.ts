export interface FloatingRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Viewport {
  width: number;
  height: number;
}

const DEFAULT_MIN_W = 300;
const DEFAULT_MIN_H = 200;
const TITLE_SLACK = 48;

export function clampFloatingRect(
  rect: FloatingRect,
  viewport: Viewport,
  minW = DEFAULT_MIN_W,
  minH = DEFAULT_MIN_H,
): FloatingRect {
  const vw = Math.max(0, viewport.width);
  const vh = Math.max(0, viewport.height);

  if (vw < minW || vh < minH) {
    return { x: 0, y: 0, w: vw, h: vh };
  }

  const w = Math.min(Math.max(minW, rect.w), vw);
  const h = Math.min(Math.max(minH, rect.h), vh);
  const minX = TITLE_SLACK - w;
  const maxX = vw - TITLE_SLACK;
  const maxY = Math.max(0, vh - TITLE_SLACK);
  const x = Math.min(Math.max(rect.x, minX), maxX);
  const y = Math.min(Math.max(rect.y, 0), maxY);
  return { x, y, w, h };
}
