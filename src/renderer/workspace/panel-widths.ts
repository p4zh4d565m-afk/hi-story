export const PANEL_WIDTHS_KEY = 'hi-story-panel-widths';

export const PANEL_WIDTH_LIMITS = {
  sidebar: { min: 200, max: 420, default: 280 },
  aiChat: { min: 300, max: 700, default: 380 },
  insp: { min: 300, max: 600, default: 360 },
} as const;

export interface PanelWidths {
  version: 1;
  sidebar: number;
  aiChat: number;
  insp: number;
}

const DEFAULT_WIDTHS: PanelWidths = {
  version: 1,
  sidebar: PANEL_WIDTH_LIMITS.sidebar.default,
  aiChat: PANEL_WIDTH_LIMITS.aiChat.default,
  insp: PANEL_WIDTH_LIMITS.insp.default,
};

function clampWidth(n: unknown, min: number, max: number, fallback: number): number | null {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function parsePanelWidths(raw: string | null): PanelWidths {
  if (!raw) return { ...DEFAULT_WIDTHS };
  try {
    const parsed = JSON.parse(raw) as Partial<PanelWidths>;
    if (!parsed || parsed.version !== 1) return { ...DEFAULT_WIDTHS };
    const sidebar = clampWidth(parsed.sidebar, PANEL_WIDTH_LIMITS.sidebar.min, PANEL_WIDTH_LIMITS.sidebar.max, DEFAULT_WIDTHS.sidebar);
    const aiChat = clampWidth(parsed.aiChat, PANEL_WIDTH_LIMITS.aiChat.min, PANEL_WIDTH_LIMITS.aiChat.max, DEFAULT_WIDTHS.aiChat);
    const insp = clampWidth(parsed.insp, PANEL_WIDTH_LIMITS.insp.min, PANEL_WIDTH_LIMITS.insp.max, DEFAULT_WIDTHS.insp);
    if (sidebar === null || aiChat === null || insp === null) return { ...DEFAULT_WIDTHS };
    return { version: 1, sidebar, aiChat, insp };
  } catch {
    return { ...DEFAULT_WIDTHS };
  }
}

export function serializePanelWidths(widths: Omit<PanelWidths, 'version'>): string {
  const parsed = parsePanelWidths(JSON.stringify({ version: 1, ...widths }));
  return JSON.stringify(parsed);
}
