# Workspace P1 主题令牌 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans 按任务执行。步骤用 checkbox 跟踪。本阶段禁止打开 P2 docking / splitter 库，禁止改 P0 几何。

**Goal:** 把现有暗色色板收成 CSS 变量，加上 Light / Dark 切换；默认 Dark 外观与今天一致，主写作路径在 Light 下可读。

**Architecture:** `:root` / `html[data-theme]` 提供 RGB 三元组；Tailwind 语义色改为 `rgb(var(--token) / <alpha-value>)`，保留 `bg-accent/10`。读写主题的纯函数进 `src/renderer/theme/theme.ts`。顶栏开关只改 `dataset.theme` + `localStorage`，不碰布局模型。

**Tech Stack:** 现有 Tailwind 3.4、CSS 变量、Vitest；不新增 npm 依赖。

## Global Constraints

- 依据已批准 Spec P1：`docs/superpowers/specs/2026-09-12-dockable-workspace-theme-design.md`。
- P0 已提交 `cf9bbe0`。禁止把 P0 几何与 P1 颜色混进同一次未提交改动。
- Dark 默认值必须是今天 `tailwind.config.js` 的 hex 原样转 RGB，不允许「趁机调暗色」。
- Light：暖纸墨字，不要纯白底、不要纯黑字。
- 先换壳：`DockLayout`、`Sidebar`、`WritingArea`、`AIChatPanel`、`RichEditor` 继承色。写章/审稿/润色的 `bg-gray-950` 第二批，本阶段不扫。
- MindMap Canvas hex 本阶段不改。
- 不跟随系统 `prefers-color-scheme`。
- 不上 `react-resizable-panels`、不抽 `WorkspaceLayoutV1`、不删 `Layout.tsx`。
- 不新增数据库迁移；写作区保活与 AI 三面板 `display:none` 不得改。
- `@tailwindcss/typography` 未安装，`prose-invert` 基本是空类；Light 靠 `text-gray-100` 变量翻转 + `.ProseMirror { color }` 覆盖。
- 不提交除非用户明确要求。

### 复核补充（2026-09-12，供第二位开发者复审）

复核者逐条核对了 Dark 变量与 `tailwind.config.js` hex（全部原样换算、无「趁机调暗色」）、`@tailwindcss/typography` 未安装（`prose-invert` 空类）、CSP 允许 `unsafe-inline`（防闪白脚本可跑）、三面板 `bg-gray-950`/`text-white` 用量（写章 5+8、审稿 12+8、润色 4+3，第二批不扫是必要克制）。以下四点并入本计划，不改结论：

1. **`text-white` 替换范围要写死，否则 Light 下有「浅纸白字」洞。** 根壳 `bg-gray-950 text-gray-100` 变量翻转只覆盖继承根壳文字色的元素，**不覆盖按钮/图标上的显式 `text-white`**（全仓几十处）。Task 3 目前只写了输入框与壳 hover，未含按钮图标。P1 只保证「主写作路径 + 壳」在 Light 下可读；**按钮/图标上的 `text-white` 属于第二批**，与写章灰底一起扫。验收须加一条「已知残留：部分按钮图标在 Light 下仍白字」，避免误判为「没做完」。

2. **`--ui-on-accent: 255 255 255` 两套都是白，是现状、不是本轮问题。** Dark 下 `bg-accent` 是浅绿 `#7EC89B`，白字对比度偏低——这是今天的既有外观，**禁止本轮顺手改成深字**（会动 Dark，违反「默认 Dark 一致」）。实施时不得「优化」`on-accent` 或 `bg-accent` 的文字色。

3. **`::selection` 的 `color` 用 `--ui-gray-100`（=正文色），不要写成 `--ui-on-accent`。** 两套下 `--ui-gray-100` 恰好都是正文色，成立；若误用 `--ui-on-accent`（白），Dark 选中文字会白底白字。实施时留意即可。

4. **「变量名写错构建期会炸」过满——`var()` 是运行时解析，构建期只查语法不查变量名。** `rgb(var(--ui-edito-900) / <alpha-value>)` 拼错时 `npx vite build` 仍通过，只在运行时表现为透明/无背景。因此构建通过**不保证** token 无错。兜底二选一（至少做一）：a) 在 `theme.test.ts` 加一个静态锚点——从 `tokens.css` 声明的 `--ui-*` 集合与 `tailwind.config.js` 里 `ink('--ui-*')` 引用的集合逐一比对，缺引用或多引用都报错；b) 若不写锚点，则明确「变量名正确性靠手动验收第 2 条（切换后逐区看）兜底」，不得仅凭 build 通过就声称安全。

### 开工前门（已核对）

- [x] P0 在 git 中：`cf9bbe0 feat: 工作区 P0 止血`
- [x] 工作区无未提交的 P0 代码（`git status` 无 `src/renderer/workspace` 改动）
- [x] 本计划只动颜色与主题状态，不改 splitter / 右栏互斥 / 浮窗夹紧

---

## 文件地图

- Create: `src/renderer/styles/tokens.css` — Dark `:root` + Light `html[data-theme="light"]`
- Create: `src/renderer/theme/theme.ts` — `THEME_KEY`、`parseTheme`、`applyTheme`
- Create: `tests/unit/theme.test.ts`
- Modify: `tailwind.config.js` — hex 改为 CSS 变量
- Modify: `src/renderer/styles/index.css` — `@import` tokens；滚动条/选区用变量
- Modify: `src/renderer/index.html` — 同步读 localStorage，防闪白
- Modify: `src/renderer/components/DockLayout.tsx` — 顶栏切换；壳上 `hover:text-white` → `hover:text-gray-100`（`bg-accent text-white` 保留）
- Modify: `src/renderer/components/Sidebar.tsx`、`WritingArea.tsx`、`AIChatPanel.tsx` — 同上 hover 替换；输入框 `text-white` → `text-gray-100`
- Modify: `src/renderer/components/editor/RichEditor.tsx` — 工具条 hover；ProseMirror 用 token 色
- Modify: Spec 文首：P0 已 commit，P1 计划已写

---

### Task 1: 主题纯函数

**Files:**
- Create: `src/renderer/theme/theme.ts`
- Test: `tests/unit/theme.test.ts`

**Interfaces:**
- `THEME_KEY = 'hi-story-theme'`
- `export type ThemeName = 'dark' | 'light'`
- `parseTheme(raw: string | null): ThemeName` — 仅 `'light'` 为 light，其余含 `'dark'` / null / 乱码 / `'LIGHT'` 一律 dark
- `applyTheme(theme: ThemeName): void` — 有 `document` 时设 `document.documentElement.dataset.theme`；无 DOM 时 no-op
- `persistTheme(theme: ThemeName): void` — `localStorage.setItem`，try/catch
- `loadTheme(): ThemeName` — try `parseTheme(localStorage.getItem(THEME_KEY))`，失败回 dark

- [x] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest';
import { parseTheme } from '../../src/renderer/theme/theme';

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
```

- [x] **Step 2: 最小实现并跑通**

```
$env:ELECTRON_RUN_AS_NODE='1'; node_modules/electron/dist/electron.exe node_modules/vitest/vitest.mjs run tests/unit/theme.test.ts
```

---

### Task 2: tokens.css + Tailwind 改指向变量

**Files:**
- Create: `src/renderer/styles/tokens.css`
- Modify: `tailwind.config.js`
- Modify: `src/renderer/styles/index.css`

**Dark 必须用下列 RGB（由现有 hex 原样换算，禁止改数字）：**

```css
:root,
html[data-theme="dark"] {
  --ui-sidebar-900: 30 31 28;      /* #1E1F1C */
  --ui-sidebar-800: 38 39 36;      /* #262724 */
  --ui-sidebar-700: 57 58 54;      /* #393A36 */
  --ui-sidebar-600: 80 81 77;      /* #50514D */
  --ui-sidebar-accent: 181 176 164;
  --ui-sidebar-accent-hover: 158 153 140;
  --ui-sidebar-hover: 38 39 36;
  --ui-sidebar-active: 57 58 54;

  --ui-editor-900: 29 36 31;       /* #1D241F */
  --ui-editor-850: 32 39 34;       /* #202722 */
  --ui-editor-800: 36 43 38;       /* #242B26 */
  --ui-editor-700: 54 62 57;       /* #363E39 */
  --ui-editor-600: 74 83 77;       /* #4A534D */
  --ui-editor-accent: 140 191 160;
  --ui-editor-accent-hover: 122 176 144;

  --ui-aichat-900: 37 34 30;       /* #25221E */
  --ui-aichat-800: 48 44 39;       /* #302C27 */
  --ui-aichat-700: 74 68 60;       /* #4A443C */
  --ui-aichat-600: 102 94 84;      /* #665E54 */
  --ui-aichat-accent: 212 184 150;
  --ui-aichat-accent-hover: 196 168 130;

  --ui-context-900: 27 31 36;
  --ui-context-800: 34 39 44;
  --ui-context-700: 54 61 68;
  --ui-context-600: 78 86 95;
  --ui-context-accent: 140 165 187;
  --ui-context-accent-hover: 122 149 172;

  --ui-inspiration-900: 36 34 25;
  --ui-inspiration-800: 48 45 34;
  --ui-inspiration-700: 76 71 54;
  --ui-inspiration-600: 107 100 77;
  --ui-inspiration-accent: 196 184 124;
  --ui-inspiration-accent-hover: 180 168 108;

  --ui-float-900: 36 31 33;
  --ui-float-800: 48 41 43;
  --ui-float-700: 74 63 66;
  --ui-float-600: 102 87 91;
  --ui-float-accent: 196 160 168;
  --ui-float-accent-hover: 180 140 150;

  --ui-accent: 126 200 155;        /* #7EC89B */
  --ui-accent-hover: 110 184 139;
  --ui-accent-blue: 140 165 187;
  --ui-accent-blue-hover: 122 149 172;
  --ui-accent-warm: 212 168 144;
  --ui-accent-warm-hover: 196 152 128;

  /* 本项目 gray-100 = 主文字，gray-950 = 最深底。Light 翻转语义，不跟 Tailwind 默认 50=最浅 */
  --ui-gray-50: 245 242 237;
  --ui-gray-100: 232 227 218;
  --ui-gray-200: 209 203 192;
  --ui-gray-300: 181 174 163;
  --ui-gray-400: 147 139 128;
  --ui-gray-500: 120 112 101;
  --ui-gray-600: 95 87 78;
  --ui-gray-700: 72 65 58;
  --ui-gray-800: 50 45 40;
  --ui-gray-900: 31 28 24;
  --ui-gray-950: 22 21 19;

  --ui-bg: var(--ui-gray-950);
  --ui-surface: var(--ui-editor-800);
  --ui-editor: var(--ui-editor-900);
  --ui-text: var(--ui-gray-100);
  --ui-text-muted: var(--ui-gray-400);
  --ui-border: var(--ui-editor-700);
  --ui-divider: var(--ui-editor-700);
  --ui-input: var(--ui-editor-800);
  --ui-hover: var(--ui-editor-700);
  --ui-active: var(--ui-editor-600);
  --ui-selected: var(--ui-accent);
  --ui-disabled: var(--ui-gray-600);
  --ui-warning: 212 168 80;
  --ui-error: 196 96 96;
  --ui-success: 110 184 139;
  --ui-selection-bg: 126 200 155;
  --ui-on-accent: 255 255 255;
}
```

**Light（暖纸墨字，允许与 Dark 不同，但必须写死在本文件，实施时不得再发明）：**

```css
html[data-theme="light"] {
  --ui-sidebar-900: 236 230 220;
  --ui-sidebar-800: 228 221 209;
  --ui-sidebar-700: 206 196 180;
  --ui-sidebar-600: 176 164 146;
  --ui-sidebar-accent: 92 84 72;
  --ui-sidebar-accent-hover: 74 66 56;
  --ui-sidebar-hover: 228 221 209;
  --ui-sidebar-active: 214 204 188;

  --ui-editor-900: 247 242 232;
  --ui-editor-850: 242 236 224;
  --ui-editor-800: 236 229 214;
  --ui-editor-700: 214 204 184;
  --ui-editor-600: 186 174 154;
  --ui-editor-accent: 46 120 82;
  --ui-editor-accent-hover: 36 102 70;

  --ui-aichat-900: 245 238 226;
  --ui-aichat-800: 236 226 210;
  --ui-aichat-700: 214 198 176;
  --ui-aichat-600: 186 166 142;
  --ui-aichat-accent: 138 96 48;
  --ui-aichat-accent-hover: 116 78 36;

  --ui-context-900: 232 236 240;
  --ui-context-800: 220 226 232;
  --ui-context-700: 190 200 210;
  --ui-context-600: 150 164 176;
  --ui-context-accent: 56 92 120;
  --ui-context-accent-hover: 40 74 100;

  --ui-inspiration-900: 245 240 220;
  --ui-inspiration-800: 236 228 200;
  --ui-inspiration-700: 210 196 150;
  --ui-inspiration-600: 176 160 110;
  --ui-inspiration-accent: 120 100 32;
  --ui-inspiration-accent-hover: 96 80 24;

  --ui-float-900: 242 234 236;
  --ui-float-800: 232 220 224;
  --ui-float-700: 206 186 192;
  --ui-float-600: 176 152 160;
  --ui-float-accent: 128 72 84;
  --ui-float-accent-hover: 108 56 68;

  --ui-accent: 46 120 82;
  --ui-accent-hover: 36 102 70;
  --ui-accent-blue: 56 92 120;
  --ui-accent-blue-hover: 40 74 100;
  --ui-accent-warm: 168 88 56;
  --ui-accent-warm-hover: 148 72 44;

  --ui-gray-50: 250 247 241;
  --ui-gray-100: 44 39 34;
  --ui-gray-200: 62 55 48;
  --ui-gray-300: 90 80 70;
  --ui-gray-400: 110 100 88;
  --ui-gray-500: 130 118 104;
  --ui-gray-600: 168 158 144;
  --ui-gray-700: 206 196 180;
  --ui-gray-800: 228 221 209;
  --ui-gray-900: 236 230 220;
  --ui-gray-950: 247 242 232;

  --ui-bg: var(--ui-gray-950);
  --ui-surface: var(--ui-editor-800);
  --ui-editor: var(--ui-editor-900);
  --ui-text: var(--ui-gray-100);
  --ui-text-muted: var(--ui-gray-400);
  --ui-border: var(--ui-editor-700);
  --ui-divider: var(--ui-editor-700);
  --ui-input: var(--ui-editor-800);
  --ui-hover: var(--ui-editor-700);
  --ui-active: var(--ui-editor-600);
  --ui-selected: var(--ui-accent);
  --ui-disabled: var(--ui-gray-600);
  --ui-warning: 160 112 24;
  --ui-error: 176 56 48;
  --ui-success: 36 102 70;
  --ui-selection-bg: 46 120 82;
  --ui-on-accent: 255 255 255;
}
```

`tailwind.config.js` 每个颜色改为：

```js
const ink = (token) => `rgb(var(${token}) / <alpha-value>)`;
// editor.900: ink('--ui-editor-900')
// gray.100: ink('--ui-gray-100')
// accent: ink('--ui-accent')
```

`index.css` 文件顶：`@import './tokens.css';`

滚动条 / 选区：

```css
::-webkit-scrollbar-thumb { background: rgb(var(--ui-editor-600)); }
::-webkit-scrollbar-thumb:hover { background: rgb(var(--ui-editor-700)); }
::selection {
  background: rgb(var(--ui-selection-bg) / 0.30);
  color: rgb(var(--ui-gray-100));
}
.ProseMirror { color: rgb(var(--ui-gray-100)); }
```

- [x] **Step 1: 落地 tokens + tailwind 改写**
- [x] **Step 2: `npx vite build` 必须通过**（语法级；变量名拼错不保证在此暴露，见 Global Constraints 复核补充第 4 条）
- [x] **Step 3: 按第 4 条兜底**——加 tokens 变量名静态锚点，或明确靠手动验收逐区看

Dark 默认未设 `data-theme` 时 `:root` 仍是旧色，避免 html 脚本失败时闪白。

---

### Task 3: 防闪白 + 顶栏切换 + 壳 hover

**Files:**
- Modify: `src/renderer/index.html`
- Modify: `src/renderer/components/DockLayout.tsx`
- Modify: `Sidebar.tsx` / `WritingArea.tsx` / `AIChatPanel.tsx` / `RichEditor.tsx`

`index.html` `<head>` 在 CSS 前插入（CSP 已允许 `unsafe-inline`）：

```html
<script>
  try {
    var t = localStorage.getItem('hi-story-theme');
    document.documentElement.dataset.theme = t === 'light' ? 'light' : 'dark';
  } catch (e) {
    document.documentElement.dataset.theme = 'dark';
  }
</script>
```

`DockLayout` 顶栏字号控件旁加按钮：

- 文案：Dark 显示「☀️ 浅色」，Light 显示「🌙 深色」
- `title`：切换浅色/深色主题
- 点击：`next = theme === 'dark' ? 'light' : 'dark'`；`applyTheme(next)`；`persistTheme(next)`；`setTheme(next)`
- 初始：`useState(loadTheme)`

壳层规则：

- `hover:text-white`（非 `bg-accent` 填充钮）改为 `hover:text-gray-100`
- 输入框 `text-white` 改为 `text-gray-100`（Light 下才是墨色）
- **保留** `bg-accent text-white` / `bg-accent-hover`（`--ui-on-accent` 两套都是白）
- 根壳 `bg-gray-950 text-gray-100` 保留，变量翻转后 Light 自动变成纸色+墨字
- **按钮/图标上的显式 `text-white` 本轮不扫（第二批）**，只改输入框与壳 hover；不要试图一次清完，否则 Light 下仍留白字洞但范围失控

`RichEditor` 工具条同样改 hover；不删 `prose-invert` 类名（空类，避免无谓 diff）。

- [x] **Step 1: html 脚本 + DockLayout 开关**
- [x] **Step 2: 四壳 hover/输入色**
- [x] **Step 3: 跑测试与构建**

```
$env:ELECTRON_RUN_AS_NODE='1'; node_modules/electron/dist/electron.exe node_modules/vitest/vitest.mjs run tests/unit/theme.test.ts tests/unit/workspace-p0.test.ts
node tests/ui/run-writing-workspace.cjs
npx vite build
```

---

### Task 4: 文档

- [x] Spec 文首改为：P0 已 commit `cf9bbe0`；P1 已编码未提交。
- [x] P1 完成后才改 CLAUDE.md / AGENTS.md（一句：主题令牌 + 顶栏切换；写章灰底未扫）。
- [x] 计划 checkbox 与验证结果必须同步后再写「P1 已落地」。禁止报告超前。

不提交。等用户发话。

### 验证结果（2026-09-12）

- `theme.test.ts` 4/4
- `workspace-p0.test.ts` 12/12（未混改几何）
- `node tests/ui/run-writing-workspace.cjs` 12/12
- `npx vite build` 通过

**P1 已落地（未 commit）。**

### 下一步

P2 计划：`docs/superpowers/plans/2026-09-12-workspace-p2-splitter.md`。

开工前门：用户明确要求后再单独 commit P1；P2 禁止把 splitter 与主题色混进同一次提交。第二批 `text-white` / `bg-gray-950` 不并进 P2。

---

## 验收

自动：

- `theme.test.ts` 通过
- P0 `workspace-p0.test.ts` 仍 12/12（证明没混改几何）
- 写作 UI 12/12
- `npx vite build` 通过

手动（编码后，提交前建议 2 分钟）：

- 默认仍是林间稿纸暗色，没有「整体洗白」
- 点顶栏切到浅色：侧栏、编辑器、AI 对话、顶栏一起变；正文是墨字暖纸
- 刷新后仍是浅色
- 再切回深色
- 写章浮窗本阶段允许仍偏暗（第二批）

**已知残留（不算没做完）：**

- 部分按钮/图标上的显式 `text-white` 在 Light 下仍白字（属第二批，与写章灰底一起扫）
- 写章/审稿/润色的 `bg-gray-950` 面板仍偏暗

## 明确不做

- 跟随系统
- 扫完全部 `text-white` / `bg-gray-950`（含 AIWrite/Review/Polish）
- MindMap Canvas
- P2 splitter
- 对比度自动计算工具
