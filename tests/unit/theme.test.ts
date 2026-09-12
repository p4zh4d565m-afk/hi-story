import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { listInkReferences, listTokenDeclarations, parseTheme } from '../../src/renderer/theme/theme';

describe('parseTheme', () => {
  it('仅精确 light 才是亮色', () => {
    expect(parseTheme('light')).toBe('light');
  });
  it('空、dark、乱码、大小写都不跟系统猜', () => {
    expect(parseTheme(null)).toBe('dark');
    expect(parseTheme('dark')).toBe('dark');
    expect(parseTheme('LIGHT')).toBe('dark');
    expect(parseTheme('system')).toBe('dark');
  });
});

describe('token 名称锚点', () => {
  it('ink() 引用必须能从片段解析', () => {
    expect(listInkReferences("accent: ink('--ui-accent')")).toEqual(['--ui-accent']);
  });

  it('tokens.css 声明与 tailwind ink() 引用集合一致（ink ⊆ 声明，且 ink 覆盖色板）', () => {
    const css = readFileSync(path.join(process.cwd(), 'src/renderer/styles/tokens.css'), 'utf8');
    const config = readFileSync(path.join(process.cwd(), 'tailwind.config.js'), 'utf8');
    const declared = listTokenDeclarations(css);
    const referenced = listInkReferences(config);
    expect(referenced.length).toBeGreaterThan(20);
    expect(referenced).toContain('--ui-editor-900');
    expect(referenced).toContain('--ui-gray-100');
    expect(referenced).toContain('--ui-accent');
    const missing = referenced.filter(name => !declared.includes(name));
    expect(missing).toEqual([]);
    expect(config).not.toMatch(/#[0-9A-Fa-f]{3,8}/);
  });
});
