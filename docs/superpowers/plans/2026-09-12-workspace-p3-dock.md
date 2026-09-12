# Workspace P3 拖放进槽 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans 按任务执行。步骤用 checkbox 跟踪。本阶段禁止打开 P4 预设，禁止改 P1 主题色、禁止回改 P0/P2 几何。

**Goal:** 把大纲 / 素材 / 伏笔 / 写章 / 审稿 / 润色从「默认浮动窗」改为「默认入槽」，支持拖标题到 left/right/bottom；`WorkspaceLayoutV1` 管这六者 + 灵感/参考/起名 + 侧栏的归属。**不管 AI 对话**（仍 P2 的 center 内侧列）。导图保留浮动例外。

**Architecture:** `WorkspaceLayoutV1`（纯数据 + localStorage）管「面板归属哪个槽、槽内谁 active」；`react-resizable-panels` 继续管「槽的像素/百分比」；`PanelChrome` 统一标题栏/拖动/关闭；`SlotTabs` 管槽内多面板标签。保活不变：写作区 `hidden`、AI 三面板 `display:none`（关闭=隐藏不卸载）。**本轮不是全部 `panelState` 的唯一源**：只管六个工具 + 灵感/参考/起名 + 侧栏；`aiChatOpen` / `aiChatMinimized` / `aiLevel` 仍留 P2。

**Tech Stack:** React 18、现有 Tailwind、Vitest、已装 `react-resizable-panels@4.12.4`。**不新增 npm 依赖。**

## Global Constraints

- 依据已批准 Spec P3：`docs/superpowers/specs/2026-09-12-dockable-workspace-theme-design.md`。
- **开工前门：** P2 已收口（`0e4e125` + `30c08f1` + `b3fb979` + `44c909c`），工作区无未提交的 P2 代码。P3 单独提交，禁止混 P1/P2。
- `WritingArea` 策划/写作切换继续 `hidden` 保活；**禁止** tab 化写作区或让它进入 right/bottom。
- `AIWritePanel` / `AIReviewPanel` / `AIPolishPanel` 关闭不得卸载（继续 `display:none`），入槽后仍要保活；**入槽 ≠ 每次切换 key 重置**。
- **空 bottom 雷（P2 复核第 3 条）**：bottom 槽「有面板进槽才」挂纵向 Separator + 生效 `BOTTOM_MIN_PX`；无面板时不挂条、不弹开。
- `applyRightAuxExclusive` 的泛型随 layout model 一起改（灵感/参考/起名并入「right 槽标签页」后，互斥语义由「同一槽只有一个 active」接管）。
- 中央 `center` 只放写作区/策划页，其它面板拖到 center 时落 `bottom`。
- Obsidian 只读浏览**本阶段仍模态**（有路径/扫描语义，P3 第一刀不迁）。
- **AI 对话本阶段不入槽**（定案，见文末「已确认决策」）。打开 💬 继续走 P2 的 center 内侧列，禁止 `movePanel(..., 'aiChat')`。
- **六个工具默认落点 3+3**（定案）：大纲/素材/伏笔 → `right`；写章/审稿/润色 → `bottom`。不要「只有审稿在 bottom、其余五个在 right」。
- 导图允许「弹出浮动」，浮动几何仍 persist。
- 不新增数据库迁移；不改章节保存、决策账本、策划 IPC；不改 `tailwind.config.js` 颜色。
- 不提交除非用户明确要求。

## 文件地图

- Create: `src/renderer/workspace/layout-model.ts` — `WorkspaceLayoutV1` 类型、默认布局、`movePanel`/`closePanel`/`setActive`、校验
- Create: `src/renderer/workspace/layout-storage.ts` — `hi-story-workspace-v1` 读写、坏数据回默认
- Create: `src/renderer/workspace/useWorkspaceLayout.ts` — React hook（状态 + 动作 + 持久化）
- Create: `src/renderer/workspace/PanelChrome.tsx` — 标题栏/拖动/关闭/折叠
- Create: `src/renderer/workspace/DropZones.tsx` — 拖放预览
- Create: `src/renderer/workspace/SlotTabs.tsx` — 槽内标签
- Create: `tests/unit/workspace-layout.test.ts`
- Modify: `src/renderer/App.tsx` — 六个工具 + 灵感/参考/起名 + 侧栏走 layout hook；**保留** `aiChatOpen` / `aiChatMinimized` / `aiLevel`
- Modify: `src/renderer/components/DockLayout.tsx` — 槽内按 layout model 渲染 PanelChrome + SlotTabs
- Modify: `AIWritePanel.tsx` / `AIReviewPanel.tsx` / `AIPolishPanel.tsx` — 剥离内部 `panelPos`/`panelSize`，改填满父级
- Modify: `OutlinePanel.tsx` / `MaterialPanel.tsx` / `ForeshadowingPanel.tsx` — 去浮动壳，由 PanelChrome 接管标题
- Modify: Spec 文首实施进度（P3 编码中/完成后才勾，禁止超前）

---

### Task 1: layout model 纯函数（TDD）

**Files:** `layout-model.ts` + `tests/unit/workspace-layout.test.ts`

**Interfaces:**

```ts
export type SlotId = 'left' | 'right' | 'bottom';
export type PanelId = 'sidebar' | 'aiChat' | 'inspiration' | 'reference' | 'namegen'
  | 'outline' | 'material' | 'foreshadowing' | 'aiWrite' | 'aiReview' | 'aiPolish' | 'mindmap';

export interface SlotState {
  panelIds: PanelId[];          // 槽内面板，多面板时 SlotTabs 展示
  activeId: PanelId | null;     // 当前激活标签
}

export interface WorkspaceLayoutV1 {
  version: 1;
  slots: Record<SlotId, SlotState>;
  floating: PanelId[];          // 仅导图等例外
}

export const DEFAULT_LAYOUT: WorkspaceLayoutV1 = {
  version: 1,
  slots: {
    left: { panelIds: ['sidebar'], activeId: 'sidebar' },
    right: { panelIds: [], activeId: null },
    bottom: { panelIds: [], activeId: null },
  },
  floating: [],
};

/** 打开面板时的默认槽。不含 aiChat（本 P3 不入槽）。 */
export const DEFAULT_SLOT: Partial<Record<PanelId, SlotId>> = {
  outline: 'right',
  material: 'right',
  foreshadowing: 'right',
  inspiration: 'right',
  reference: 'right',
  namegen: 'right',
  aiWrite: 'bottom',
  aiReview: 'bottom',
  aiPolish: 'bottom',
};
```

**纯函数（全部无副作用，供 UI 与主逻辑共用）：**

- `movePanel(layout, panelId, target: SlotId | 'floating' | 'center'): WorkspaceLayoutV1`
  - `center` → 落到 `bottom`（写作区/策划页不可被占）。
  - 从原槽/浮动移除，追加到目标槽 panelIds 尾，设 activeId。
  - `sidebar` 只允许 left；`mindmap` 允许 floating。
- `closePanel(layout, panelId): WorkspaceLayoutV1` — 从槽/浮动移除；若槽空则 activeId=null。
- `setActive(layout, slotId, panelId): WorkspaceLayoutV1` — 槽内切标签。
- `panelSlot(layout, panelId): SlotId | 'floating' | null` — 查归属。
- `isSlotVisible(layout, slotId): boolean` — 槽有面板即真（供挂 Separator / 生效 minSize 判断，锁 P2 复核第 3 条）。

**约束（纯函数内拒绝，返回原 layout 不变）：**

- `sidebar` 只能进 left，不能进 right/bottom/floating。
- **`aiChat` 本阶段拒绝入槽**（`movePanel` 目标无论 left/right/bottom/floating/center 都返回原 layout）。
- 同一 panel 不能同时在两槽。
- 导图之外的面板不接受 floating。

- [ ] **Step 1: 写失败测试**（movePanel 跨槽/center 落 bottom/sidebar 拒 non-left；**aiChat 任意目标拒绝**；closePanel 清空槽；isSlotVisible 空槽 false；DEFAULT_SLOT 3+3）
- [ ] **Step 2: 最小实现并跑通**

```
$env:ELECTRON_RUN_AS_NODE='1'; node_modules/electron/dist/electron.exe node_modules/vitest/vitest.mjs run tests/unit/workspace-layout.test.ts
```

---

### Task 2: layout storage + hook

**Files:** `layout-storage.ts` + `useWorkspaceLayout.ts`

- `LAYOUT_KEY = 'hi-story-workspace-v1'`
- `parseLayout(raw): WorkspaceLayoutV1` — 坏 JSON / version≠1 / 缺 slots → 回 `DEFAULT_LAYOUT`；未知 panelId 丢弃。
- `serializeLayout(layout)` — 归一化（activeId 不在 panelIds 内则置 null）。
- `useWorkspaceLayout()` — 初始 `parseLayout(localStorage)`；`movePanel/closePanel/setActive` 动作更新 state 并 `serialize` 写回（try/catch，隐私模式静默）。

- [ ] **Step 1: parseLayout 坏数据/未知 panelId 回退 + 往返**
- [ ] **Step 2: hook 动作持久化（不强行测 DOM，测纯函数路径）**

---

### Task 3: PanelChrome + SlotTabs + DropZones

**Files:** `PanelChrome.tsx` / `SlotTabs.tsx` / `DropZones.tsx`

- `PanelChrome`：标题（`onPointerDown` 开始拖 → DropZones 高亮）、关闭（调 `closePanel`）、折叠（槽级）。外壳由它统一提供，功能面板只渲染内容。
- `SlotTabs`：槽内 `panelIds.length > 1` 时渲染标签行，切换调 `setActive`；单面板不显示标签行。
- `DropZones`：拖拽悬停时，left/right/bottom/center（映射 bottom）四边高亮；释放调 `movePanel`。

- [ ] **Step 1: 接线（先让 drag→drop 走通，视觉从简）**

---

### Task 4: 面板去浮动化 + 入槽接线

**Files:** `App.tsx` + `DockLayout.tsx` + 六个面板组件

**接线规则（2026-09-12 定案，D 方案 + 四条收口）：**

1. **三类面板、三种归属模型，不要混：**
   - **大纲/素材/伏笔**：真正走 `movePanel`，默认 right，可拖 left/right/bottom，关闭 = 卸载。
   - **写章/审稿/润色**：**不走 `movePanel`**（和 `aiChat` 同构）。固定归属 bottom，打开 = `display:block`、关闭 = `display:none`，**实例始终在 bottom 槽的保活宿主里，绝不从 React 树拿掉**。`movePanel` 对这三者目标一律拒绝。
   - **灵感/参考/起名**：归 right 槽标签，可同时在槽内用标签切换（**废除 P0 的 `applyRightAuxExclusive` 互斥**，语义升级成同槽多面板标签）。
2. **bottom 槽合并成一条标签带**：`SlotTabs` 里同时显示「大纲/素材/伏笔（若拖进 bottom）+ 写章/审稿/润色（若 open）」，一套标签，不出现「普通面板一套 + 保活面板各自标题」两套东西。
3. **bottom 槽「看得见」的驱动是混合的**：挂纵向 Separator + 生效 `BOTTOM_MIN_PX` 的条件 = `isSlotVisible(layout, 'bottom') || aiWriteOpen || aiReviewOpen || aiPolishOpen`（保活面板不走 layout 归属，`isSlotVisible` 看不到它们，必须补三个布尔）。
4. `App.tsx`：
   - `useWorkspaceLayout` 管大纲/素材/伏笔 + 灵感/参考/起名 + 侧栏归属；`aiChatOpen`/`aiChatMinimized`/`aiLevel` 仍 P2；写章/审稿/润色仍 `panelState.xxxOpen`（display 开合）。
   - 打开大纲/素材/伏笔 → `movePanel(..., DEFAULT_SLOT)`；打开写章/审稿/润色 → `setPanelState(aiWriteOpen=true)`（**不** `movePanel`）；打开灵感/参考/起名 → `movePanel(..., 'right')`。
5. `DockLayout.tsx`：left/right/bottom 按 `layout.slots` 渲染 `PanelChrome`+`SlotTabs`；bottom 额外挂三个保活宿主（`display:none` 包裹），保活宿主与普通面板共一条 SlotTabs；写作区/策划页仍 center，AI 仍 center 内侧列。
6. 三个保活面板：删内部 `panelPos/panelSize` absolute，改 `h-full w-full`；外壳交 `PanelChrome`（但**跨槽拖拒绝**，标题栏不触发 drag）。
7. 导图：保留浮动，不进槽（`floating: ['mindmap']`）。

- [ ] **Step 1: 六面板去浮动 + 入槽**
- [ ] **Step 2: 跑测试 + UI 回归 + build**

```
$env:ELECTRON_RUN_AS_NODE='1'; node_modules/electron/dist/electron.exe node_modules/vitest/vitest.mjs run tests/unit/workspace-layout.test.ts tests/unit/workspace-p0.test.ts tests/unit/workspace-p2.test.ts tests/unit/theme.test.ts
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
node tests/ui/run-writing-workspace.cjs
npx vite build
```

---

### Task 5: 文档收口

- Spec「实施进度」P3 改为已编码/已验证之后，才能写「P3 已落地」。禁止报告超前。
- `CLAUDE.md` / `AGENTS.md` 补一句 P3（拖放进槽 + `WorkspaceLayoutV1` + 保活约束）。
- 本计划 checkbox 与验证结果同步。

不提交。等用户发话。

---

## 验收

自动：

- `workspace-layout.test.ts` 通过（movePanel/closePanel/setActive/isSlotVisible/parseLayout）
- `workspace-p0` 12/12、`workspace-p2` 6/6、`theme` 4/4（证明没混改几何/主题）
- 写作 UI 12/12（策划往返正文还在、写章/审稿/润色关闭仍保活）

手动（编码后，提交前建议 3 分钟）：

- 打开「📋 大纲」→ 默认进 **right**，不再盖在编辑器上
- 打开「🔍 审稿」→ 默认进 **bottom**；拖到 right 后刷新仍在 right
- 打开 💬 AI → 仍在编辑器右侧那一列，**不**出现在 right 槽标签里
- 同一槽多个面板 → 显示标签页切换；关闭后槽空则槽消失（bottom 空则不挂 Separator）
- 写章生成中把它拖到另一槽 → 流不断、停止键仍可用
- 切策划再切回写作 → 正文未丢
- 侧栏 ☰ 折叠成 24px 轨再点恢复（P2 `30c08f1` 回归，P3 改 Group 时别再只 `hidden` 不 `collapse`）
- 空 bottom（无面板）仍拖不出空白带
- 约 1000 宽：侧栏+编辑器可写，多槽不把正文压没

## 明确不做

- AI 对话并入 right 槽（终态；单开一小步，本计划不做）
- Obsidian 只读浏览入槽（仍模态）
- 工作区预设（P4）
- `hi-story-workspace-v1` 之外再引入每项目布局
- 扫 `text-white` / 写章灰底 / MindMap Canvas 主题
- 删 `Layout.tsx` / `MainArea.tsx` / `ContextPanel.tsx`

---

## 已确认决策（2026-09-12，第二人拍板）

口头「只有审稿在 bottom、其余五个在 right」**作废**，以本段为准。计划正文曾写 3+3、口头建议写成只审稿在底——**以 3+3 统一**，不要让实现者猜。

1. **AI 对话本 P3 不迁。** 同意对方的保守方案。Spec §8「AI 默认 right」是终态。P2 已把 AI 放在 center 内侧分隔条里，不再盖正文。本轮只迁六个浮窗。「P3 才把 AI 拖到下方」指有了 bottom 槽之后**可以**往下拖，不是本轮必须把 AI 并进 right。打开 💬 不走 `movePanel`；`movePanel` 拒绝 `aiChat`。理由：避免 center 内侧列和 right 槽双份真相；避免「对话可卸载」和「写章/审稿/润色必须 display:none 保活」挤进同一套标签寿命。`PanelId` 可保留 `'aiChat'`，入槽留给后续一小步。
2. **六个工具默认 3+3。** 不要「只有审稿在 bottom」。大纲 / 素材 / 伏笔 → `right`（列表查阅）。写章 / 审稿 / 润色 → `bottom`（大工作面，正文保持够宽）。不要统一 right。审稿、写章、润色都是大块面板，默认全塞 right 会把编辑器挤成窄条，P2 挖出的 bottom 也几乎用不上。润色 Spec 曾写「对照所以靠右」，对照已在润色面板内部完成，外壳放 bottom；用户仍可拖到 right，刷新记住。灵感/参考/起名继续进 right 当标签（P0 互斥升级），与大纲三类共用右侧，不要再塞进写章/审稿。

### 第二人审查意见（给实现者看；不是判定计划没写完）

对照计划草案 + 对方两问。**可以按本计划编码，但必须先吃掉上面两条定案。** 下面几条是开工纪律，不要当新功能做。

1. **Goal 已收窄，不要再写成「替换全部 `panelState`」。** `aiChatOpen` / `aiChatMinimized` / `aiLevel` 仍是 P2 开合。打开 💬 **禁止** `movePanel`。
2. **空 bottom 是 P2 复核第 3 条留下的雷。** 有面板才挂纵向 Separator + 生效 `BOTTOM_MIN_PX`；无面板不挂条、不弹开。不要给空槽 `minSize={120}`。
3. **保活不能破。** 写作区继续 `hidden`；写章/审稿/润色关闭 = 从槽移除但组件仍 `display:none` 挂载。入槽 ≠ `key` 重置。侧栏 ☰ 仍要真 `collapse()`（P2 `30c08f1`）。
4. **Obsidian 浏览仍模态。** 导图可浮动。不要扫第二批 `text-white` / 写章灰底，不要开 P4。
5. **写作 UI 回归是门。** `node tests/ui/run-writing-workspace.cjs` 必须继续绿。几何仍无 Electron E2E，提交前按上文手动清单走一遍。

编码未开始。不提交除非用户明确要求。
