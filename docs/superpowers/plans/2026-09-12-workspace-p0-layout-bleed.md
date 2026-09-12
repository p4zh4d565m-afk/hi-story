# Workspace P0 止血 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans 按任务执行。步骤用 checkbox 跟踪。本阶段禁止打开 P1 主题改色。

**Goal:** 先修现有工作区里会挤掉正文、重启丢失宽度、浮窗飞出视口、长文本锁死高度的问题，不引入 docking 库。

**Architecture:** 把互斥右栏、浮窗夹紧、宽度读写抽成纯函数（`src/renderer/workspace/`），单测锁行为；`App.tsx` / `DockLayout.tsx` 只接线。视觉与暗色主题保持原样。

**Tech Stack:** React 18、TypeScript、Vitest、现有 Tailwind；不新增 npm 依赖。

## Global Constraints

- 依据已批准 Spec：`docs/superpowers/specs/2026-09-12-dockable-workspace-theme-design.md` 的 P0。
- `WritingArea` 策划/写作切换必须 `hidden` 保活，不得改成卸载。
- `AIWritePanel` / `AIReviewPanel` / `AIPolishPanel` 关闭不得卸载。
- 不新增数据库迁移；不改章节保存、决策账本、策划 IPC。
- 不上 `react-resizable-panels`、不上 dockview；那是 P2。
- 不改 `tailwind.config.js` 颜色、不加 `data-theme`；那是 P1。P0 收口后再开 P1。
- 不提交除非用户明确要求。不改 git config。

---

## 文件地图

- Create: `src/renderer/workspace/right-aux-panels.ts` — 灵感/参考/起名互斥
- Create: `src/renderer/workspace/floating-rect.ts` — 浮窗矩形夹紧视口
- Create: `src/renderer/workspace/panel-widths.ts` — 三栏宽度 parse/serialize
- Create: `tests/unit/workspace-p0.test.ts` — 上述纯函数
- Modify: `src/renderer/App.tsx` — 开关与快捷键走互斥
- Modify: `src/renderer/components/DockLayout.tsx` — 读存宽度、resize 夹紧、顶栏 wrap、右栏只渲染一个
- Modify: `src/renderer/components/AIChatPanel.tsx` — 输入 `resize-y`
- Modify: `src/renderer/components/AIPolishPanel.tsx` — 解除 340px 双锁
- Modify: Spec 文首/文末过时「待确认」句

---

### Task 1: 右栏互斥纯函数

**Files:**
- Create: `src/renderer/workspace/right-aux-panels.ts`
- Test: `tests/unit/workspace-p0.test.ts`

**Interfaces:**
- Produces: `RightAuxKey`、`applyRightAuxExclusive(state, key, nextOpen)`、`toggleRightAux(state, key)`

- [x] **Step 1: 写失败测试**

打开一个右栏必须关掉另外两个；关掉当前栏不影响其它（已是 false）；再点当前栏是关闭。

- [x] **Step 2: 最小实现并跑通单测**

```ts
export const RIGHT_AUX_KEYS = ['inspirationOpen', 'referenceOpen', 'namegenOpen'] as const;
export type RightAuxKey = typeof RIGHT_AUX_KEYS[number];

export function applyRightAuxExclusive<T extends Record<RightAuxKey, boolean>>(
  state: T, key: RightAuxKey, nextOpen: boolean,
): T {
  if (!nextOpen) return { ...state, [key]: false };
  return {
    ...state,
    inspirationOpen: key === 'inspirationOpen',
    referenceOpen: key === 'referenceOpen',
    namegenOpen: key === 'namegenOpen',
  };
}

export function toggleRightAux<T extends Record<RightAuxKey, boolean>>(
  state: T, key: RightAuxKey,
): T {
  return applyRightAuxExclusive(state, key, !state[key]);
}
```

---

### Task 2: 浮窗夹紧纯函数

**Files:**
- Create: `src/renderer/workspace/floating-rect.ts`
- Test: `tests/unit/workspace-p0.test.ts`

**Interfaces:**
- Produces: `FloatingRect`、`Viewport`、`clampFloatingRect(rect, viewport, minW?, minH?)`

规则：

- `w/h` 不低于 min（默认 300×200），不超过视口。
- `x/y` 保证标题栏至少 48px 落在视口内（可从左边探出，但不能整窗飞走）。
- 视口小于 min 时，尺寸贴视口，坐标归零。

- [x] **Step 1: 覆盖超视口、负坐标、小于 min、视口比 min 更小**
- [x] **Step 2: 实现 `clampFloatingRect` 并跑通**

---

### Task 3: 宽度持久化纯函数

**Files:**
- Create: `src/renderer/workspace/panel-widths.ts`
- Test: `tests/unit/workspace-p0.test.ts`

**Interfaces:**
- Produces: `PANEL_WIDTHS_KEY = 'hi-story-panel-widths'`
- `parsePanelWidths(raw: string | null): { version: 1; sidebar: number; aiChat: number; insp: number }`
- `serializePanelWidths(widths)`

限制与 `DockLayout` 现有 splitter 一致：sidebar 200–420 默认 280；aiChat 300–700 默认 380；insp 300–600 默认 360。

坏 JSON、缺字段、`version !== 1`、非有限数字 → 回默认，不抛。

- [x] **Step 1: 测试默认、合法往返、坏数据、越界夹紧**
- [x] **Step 2: 实现并跑通**

运行：

```
$env:ELECTRON_RUN_AS_NODE='1'; node_modules/electron/dist/electron.exe node_modules/vitest/vitest.mjs run tests/unit/workspace-p0.test.ts
```

---

### Task 4: 接到 App / DockLayout / 文本区

**Files:**
- Modify: `src/renderer/App.tsx` 的 `onToggleInspiration/Reference/Namegen`、Ctrl+Shift+I/N、从编辑器打开灵感/参考
- Modify: `src/renderer/components/DockLayout.tsx`
- Modify: `src/renderer/components/AIChatPanel.tsx` 输入 textarea
- Modify: `src/renderer/components/AIPolishPanel.tsx` 润色 textarea

接线规则：

1. 所有打开/切换灵感、参考、起名都走 `toggleRightAux` / `applyRightAuxExclusive(..., true)`，关闭走 `nextOpen: false`。
2. `DockLayout` 用 `parsePanelWidths(localStorage.getItem(PANEL_WIDTHS_KEY))` 初始化三宽；宽度变化写回 `serializePanelWidths`。
3. 浮窗 move/resize 与 `window.resize` 都经 `clampFloatingRect`。
4. 顶栏 `flex-wrap`，避免 1000px 宽时按钮被裁切。
5. AI 输入去掉 `resize-none`，改为 `resize-y min-h-[2.5rem] max-h-40`。
6. 润色结果区去掉 `min-h-[340px] max-h-[340px]`，改为 `min-h-[160px] max-h-[70vh] resize-y`。

- [x] **Step 1: 接线**
- [x] **Step 2: 跑 `tests/unit/workspace-p0.test.ts` 与 `node tests/ui/run-writing-workspace.cjs`**
- [x] **Step 3: `npx vite build` 确认渲染端能编过**

---

### Task 5: 文档收口

- [x] Spec 文首/文末改为 P0 已实现并验证；计划 checkbox 与验证结果同步（禁止报告超前于计划）。
- [x] `CLAUDE.md` / `AGENTS.md` 补一句 P0 已落地（保持精简）。

**P3 备忘（本阶段不改）：** `applyRightAuxExclusive<T extends Record<RightAuxKey, boolean>>` 绑的是 `panelState` 上的三个布尔字段。P3 若把开关抽成 `WorkspaceLayoutV1`，此泛型要一起改，不能假装 layout model 仍长得像旧 `panelState`。

---

## 验证结果（2026-09-12）

| 命令 | 结果 |
|------|------|
| `$env:ELECTRON_RUN_AS_NODE='1'; node_modules/electron/dist/electron.exe node_modules/vitest/vitest.mjs run tests/unit/workspace-p0.test.ts` | **12/12 通过**（互斥、夹紧含左探出/负坐标/小于 min/视口小于 min、宽度默认/往返/坏 JSON/错误版本/NaN/Infinity/越界） |
| `node tests/ui/run-writing-workspace.cjs` | **12/12 通过** |
| `npx vite build` | **通过**（`dist/renderer/assets/index-D529kn0M.js`） |

未做：完整 Electron 窗口手测顶栏换行 / 右栏互斥 / 宽度重启。代码已实现；**git 尚未 commit，等用户发话。**
