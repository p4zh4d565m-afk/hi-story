export const THEME_KEY = 'hi-story-theme';
export type ThemeName = 'dark' | 'light';

export function parseTheme(raw: string | null): ThemeName {
  return raw === 'light' ? 'light' : 'dark';
}

export function applyTheme(theme: ThemeName): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
}

export function persistTheme(theme: ThemeName): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch { /* 隐私模式等写失败时保持内存主题 */ }
}

export function loadTheme(): ThemeName {
  try {
    return parseTheme(localStorage.getItem(THEME_KEY));
  } catch {
    return 'dark';
  }
}

export function listTokenDeclarations(css: string): string[] {
  const names = new Set<string>();
  const re = /(--ui-[a-z0-9-]+)\s*:/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(css))) names.add(match[1]);
  return [...names].sort();
}

export function listInkReferences(configSource: string): string[] {
  const names = new Set<string>();
  const re = /ink\(\s*'(--ui-[a-z0-9-]+)'\s*\)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(configSource))) names.add(match[1]);
  return [...names].sort();
}
