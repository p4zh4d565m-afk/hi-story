# Workspace P2 分隔条与折叠 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans 按任务执行。步骤用 checkbox 跟踪。本阶段禁止打开 P3 拖放 / `WorkspaceLayoutV1`，禁止改 P1 主题色。

**Goal:** 用手写三条横向 splitter 换成 `react-resizable-panels`，加上可折叠边轨和空的 bottom 槽；视觉仍是今天的三栏，重启后比例还在。

**Architecture:** `DockLayout` 外层 `Group`（horizontal）：`left` 侧栏 | `center` | `right` 辅助。`center` 内再套纵向 `Group`：上为写作/策划（及其内侧的 AI 对话），下为默认折叠的 `bottom`（本阶段不放面板）。折叠走 Panel `collapsible` + 24px `collapsedSize`，不卸载 `WritingArea`。比例用 `useDefaultLayout` 写入 localStorage。

**Tech Stack:** React 18、现有 Tailwind、Vitest；新增 renderer 依赖 `react-resizable-panels@^4`（当前主版本。Spec 写的 `autoSaveId` 是 v3 API；v4 等价物是 `useDefaultLayout({ groupId, storage })`，意图不变）。

## Global Constraints

- 依据已批准 Spec P2：`docs/superpowers/specs/2026-09-12-dockable-workspace-theme-design.md`。
- **开工前门：** P1 必须先单独 commit（主题色一次、splitter 一次）。工作区若仍有未提交的 P1 文件，先停下来让用户提交，禁止把 `tokens.css` / `theme.ts` 和本阶段几何改混进同一次 commit。
- `WritingArea` 策划/写作切换必须 `hidden` 保活，不得改成卸载或放进会销毁实例的 tab。
- `AIWritePanel` / `AIReviewPanel` / `AIPolishPanel` 关闭不得卸载（继续 `display:none`）。本阶段它们仍是浮窗，不进 bottom。
- 不抽 `WorkspaceLayoutV1`、不做 Drop Zone、不把大纲/素材/伏笔/写章/审稿/润色改成入槽（那是 P3）。
- 灵感/参考/起名继续走 P0 `applyRightAuxExclusive`，禁止三栏并排。
- 不改 `tailwind.config.js` 颜色、不扫 `text-white` / `bg-gray-950`、不改 MindMap Canvas。
- 不新增数据库迁移；不改章节保存、决策账本、策划 IPC。
- 中央永不折叠。**边轨范围以「审查意见」L1 为准**：本阶段只有侧栏关成 24px 轨；AI / 右栏关闭仍卸载。bottom 默认折叠且 P2 不露出分隔条（L2）。
- 现有 `hi-story-panel-widths`（像素）只作**首次** `defaultSize` 种子，之后只写库 persistence（审查意见 L3）。`PANEL_WIDTH_LIMITS` 的 min/max 仍要传给 Panel（v4 数字 = 像素）。
- 不提交除非用户明确要求。

### 复核备忘

- `applyRightAuxExclusive<T extends Record<RightAuxKey, boolean>>` 本阶段不改泛型。
- 今日结构是 `侧栏 | (工具栏 + 编辑器|AI) | 右栏`，不是「AI 和灵感抢同一个 right」。P2 保持这条视觉结构，只换分隔条实现。
- 顶栏仍在 center 列顶部，不要被推进 left/right Panel。
- **v4 API 事实（第二人复核 + 安装 v4.12.4 实测定案）：** `useDefaultLayout` 参数用 `id`（`groupId` 已 `@deprecated`）；**`usePanelRef()` 返回 `RefObject<PanelImperativeHandle | null>`，有 `.current`**，故 `leftRef.current?.collapse()`；`onLayoutChanged` 是推荐回调名（替代 deprecated 的 `onLayoutChange`）。单位：数字 = 像素，`collapsedSize={24}` = 24px 边轨。`PanelImperativeHandle` 有 `collapse/expand/isCollapsed/getSize/resize`。编码以本计划为准，勿沿用 v3 的 `PanelGroup`/`PanelResizeHandle`/`autoSaveId`。

---

## 审查意见（2026-09-12）

对照 Spec P2、当前 `DockLayout.tsx` 和本计划正文。**结论：方向对，可以做；但有 3 处正文自相矛盾、2 处按骨架直写会做出坏 UI。编码前先按下面「锁定」执行，不要边写边猜。** 未改任务骨架，避免和已写代码示例抢两套真相；锁定覆盖骨架冲突处。

### 能做、且应该做

- 用手写 `useResize` 换库、写作区继续 `hidden`、三面板继续 `display:none`、浮窗不入槽：这些边界是对的。
- 视觉保持 `侧栏 | (顶栏 + 编辑器|AI) | 右栏`，不让 AI 和灵感抢同一个 right：符合今天结构，P3 再并槽。
- 钉 v4 的 `Group` / `Separator` / `useDefaultLayout`，不写 v3 名：对。第二人补的 `id` / `onLayoutChanged` 也该听。
- Task 1 纯函数很小，但能锁「AI 最小化不算展开」——保留。不要指望它覆盖 Task 3 的几何风险。

### 必须先锁死（否则实现者会做出三种不同产品）

**L1. 关侧栏 / 关 AI / 关右栏，到底是「24px 轨」还是「整列卸掉」？**

| 用户动作 | 今天 | 约束第 21 行 / Spec P2.4 | Task 3 骨架 |
|----------|------|--------------------------|-------------|
| 关侧栏 | 卸载 aside | 折成 24px 轨 | 始终挂载 + `collapse()` |
| 关 AI / 最小化 | 卸载 AI 列，最小化出气泡 | 「AI 可折成边轨」 | `flags.ai &&` **卸载**；接线写明最小化不要改成轨 |
| 关灵感/参考/起名 | 卸载整列 | 「right 折成 24px 轨」 | `{flags.rightAux &&` **卸载** |

约束、Spec、骨架、验收「折叠 AI 同理」四套口径。按骨架直写则 **只有侧栏是轨**，AI/右栏仍是卸载。

**锁定（本审查建议，编码按此，不再发明第三套）：**

- **侧栏：** 关 = 24px 轨，子树保持挂载。这是 P2 唯一要改的关闭语义。
- **AI：** 关和最小化都 **保持今天**：列从 Group 拿掉 + 最小化气泡。不要做 AI 边轨。验收里「折叠 AI 同理」作废，改成「关掉或最小化 AI 后编辑器立刻变宽（列卸载，不是轨）」。
- **右栏辅助：** 关 = 整列卸载（今天语义）。不要做右栏边轨。Spec「右侧辅助折轨」推迟到 P3 槽模型，避免和 P0 互斥卸载打架。

**L2. 空 bottom 不准被用户拖出一条空白带。**

骨架里 bottom `defaultSize={0}` 且 `minSize={120}`，上面还永远挂着 `<Separator />`。v4 会把「小于 minSize」当成可塌缩，但分隔条仍在；用户往上拖就会出现一块 **120px 空槽**。P3 才往里面放面板，P2 这是缺陷不是特性。

**锁定：** bottom 默认 `collapse()`；P2 **不渲染** 这条纵向 Separator（或 `disabled` 且不可见）。P3 有面板进槽后再启用。`BOTTOM_MIN_PX` 可以留着给 P3，本阶段不要让它和 `defaultSize={0}` 同时生效在一个未折叠的 Panel 上。

**L3. 持久化只准一个写手。**

接线写「可以继续把像素写入 `hi-story-panel-widths`，但以库 layout 为准」。两套一起写，拖动必抖、刷新必打架（像素 vs 百分比）。

**锁定：** `hi-story-panel-widths` **只读一次** 当 Group 还没有 `useDefaultLayout` 缓存时的 `defaultSize` 种子。拖动之后只让 `onLayoutChanged` 写库的 key。P2 起不要再 `setItem(PANEL_WIDTHS_KEY)`。P0 单测仍测 parse/serialize，不要求运行时继续写这个 key。

### 高风险（不锁也会翻车，但口径已够写进接线）

1. **1000×600 会撑爆像素 min。** 侧栏 200 + 编辑器 280 + AI 300 + 右栏 300 = 1080，已经大于 P0 验收的 1000 宽。今天靠「关掉几列」才能用小窗；P2 若四列同时开，库会违反 min 或出现横向溢出。手测必须覆盖：小窗只开侧栏+编辑器；再开 AI；再开右栏。过窄时允许把 **可折叠列压到轨或卸掉**，禁止让写作区小于约 280 还继续摊开两侧。
2. **折叠状态双源。** `panelState.sidebarOpen` 和 `leftRef` 是否 collapsed 会分叉：用户把分隔条拖过 minSize，库会自己 collapse，App 还以为开着。必须在 Panel 的 collapsed/resize 回调里同步 `onToggleSidebar`，并防循环（collapse → toggle → collapse）。
3. **嵌套 Group 高度。** v4 默认 `height: 100%`，父级是 flex 且没有明确高度时是空的。外层 DockLayout 已是 `h-full`；内层纵向 Group、中间横向 Group 必须走 **`h-full min-h-0` 或 `flex-1 min-h-0`**，不能只写 `h-full` 套在未撑开的 Panel 里。否则写作区高度为 0，保存回归也会过（测的是挂载不是可见高度）——这是「测试全绿、窗口一片空」的经典坑。
4. **`useDefaultLayout` 的 `defaultLayout` 和 Panel 上的像素 `defaultSize` 不要同时抢。** 有缓存用缓存；无缓存才用 P0 像素种子。
5. **`usePanelRef` 有没有 `.current`。** 第二人说无 `.current`。React 惯例是 RefObject。**安装后先读 `node_modules/react-resizable-panels` 的类型再写**，不要死记。类型是 handle 就 `leftRef.collapse()`，是 `RefObject` 就 `leftRef.current?.collapse()`。
6. **Separator 的 `className="w-1.5"`。** 库文档写明不能覆盖 flex-grow/shrink，hover 要用 `data-separator`。用 Tailwind 设宽可能被库 Ignored 或把命中区做没。接线时按文档用 data 属性，不要假设手写条的 class 能原样贴上去。
7. **钉版本。** `npm install react-resizable-panels@^4` 以后可能漂到 5。安装后把 **精确 4.x.y** 写回本计划 Tech Stack；`package.json` 用 `^4` 可以，但编码对照那一版文档。
8. **不要顺手删 `contextPanel`。** `DockLayout` 解构里有个未使用的 `contextPanel`，P2 不清理死代码（和「不删 Layout.tsx」同一纪律）。

### Task 1 不必加码，Task 3 验收要改字

- 不必为边轨再堆纯函数测试；几何以写作 UI 12/12 + 手测为准。
- 自动验收保留 theme 4/4、P0 12/12 是对的（证明没混主题、没改 width parse）。
- 手动验收删掉/改写「折叠 AI 同理出现边轨」；补上「空 bottom 看不到分隔条、拖不出来」；补上「1000 宽开三列仍能点到顶栏」。

### 明确不反对的克制

- 不在 P2 抽 `WorkspaceLayoutV1`：同意。现在 `panelState` 布尔还在，再抽模型是 P3 的范围爆炸。
- 不把写章/审稿/润色塞进 bottom：同意。空槽只占位。
- P1 未提交则停工：仍有效。主题和 splitter 混 commit 会让回滚不可用。

---

## 文件地图

- Create: `src/renderer/workspace/split-flags.ts` — 哪些槽该展开（纯函数）
- Create: `tests/unit/workspace-p2.test.ts`
- Modify: `package.json` — 加 `react-resizable-panels`
- Modify: `src/renderer/components/DockLayout.tsx` — 手写 `useResize` 三条横向条换成 Group；加纵向 bottom；折叠边轨
- Modify: Spec 文首实施进度（P2 编码开始/完成后才勾，禁止超前）
- 不改：`panel-widths.ts` 的 parse 语义（P0 单测必须仍 12/12）

---

### Task 1: 槽展开纯函数

**Files:**
- Create: `src/renderer/workspace/split-flags.ts`
- Test: `tests/unit/workspace-p2.test.ts`

**Interfaces:**

```ts
export const RAIL_PX = 24;
export const BOTTOM_MIN_PX = 120;

export type SplitOpenFlags = {
  left: boolean;
  ai: boolean;
  rightAux: boolean;
};

export function isAiChatVisible(state: {
  aiChatOpen: boolean;
  aiChatMinimized: boolean;
  aiLevel: 'off' | 'assist';
}): boolean {
  return state.aiLevel !== 'off' && state.aiChatOpen && !state.aiChatMinimized;
}

export function isRightAuxOpen(state: {
  inspirationOpen: boolean;
  referenceOpen: boolean;
  namegenOpen: boolean;
}): boolean {
  return state.inspirationOpen || state.referenceOpen || state.namegenOpen;
}

export function splitOpenFlags(state: {
  sidebarOpen: boolean;
  aiChatOpen: boolean;
  aiChatMinimized: boolean;
  aiLevel: 'off' | 'assist';
  inspirationOpen: boolean;
  referenceOpen: boolean;
  namegenOpen: boolean;
}): SplitOpenFlags {
  return {
    left: state.sidebarOpen,
    ai: isAiChatVisible(state),
    rightAux: isRightAuxOpen(state),
  };
}
```

[x] **Step 1: 写失败测试**（`left` 跟 `sidebarOpen`；AI 在 `off` / 最小化时不算展开；右栏三布尔任一为真即展开）
[x] **Step 2: 最小实现并跑通**

```
$env:ELECTRON_RUN_AS_NODE='1'; node_modules/electron/dist/electron.exe node_modules/vitest/vitest.mjs run tests/unit/workspace-p2.test.ts
```

---

### Task 2: 安装库

**Files:**
- Modify: `package.json` / lockfile

```
npm install react-resizable-panels@^4
```

编码时以当时安装的 4.x 文档为准。导入必须是：

```ts
import { Group, Panel, Separator, useDefaultLayout, usePanelRef } from 'react-resizable-panels';
```

禁止再写 v3 的 `PanelGroup` / `PanelResizeHandle` / `autoSaveId`。

[x] **Step 1: 安装**
[x] **Step 2: `npx vite build` 仍能过**（此时尚未引用也行，确认没把主进程 native 搞坏）

---

### Task 3: DockLayout 换成 Group

**Files:**
- Modify: `src/renderer/components/DockLayout.tsx`

**持久化：**

```ts
const { defaultLayout: hLayout, onLayoutChanged: onHLayout } = useDefaultLayout({
  id: 'hi-story-split-h',
  storage: typeof localStorage === 'undefined' ? undefined : localStorage,
});
const { defaultLayout: vLayout, onLayoutChanged: onVLayout } = useDefaultLayout({
  id: 'hi-story-split-v',
  storage: typeof localStorage === 'undefined' ? undefined : localStorage,
});
const { defaultLayout: cLayout, onLayoutChanged: onCLayout } = useDefaultLayout({
  id: 'hi-story-split-center',
  storage: typeof localStorage === 'undefined' ? undefined : localStorage,
});
```

**几何骨架（必须保持 WritingArea 这段原样）：**

```tsx
<Group
  id="hi-story-split-h"
  orientation="horizontal"
  className="h-full w-full"
  defaultLayout={hLayout}
  onLayoutChanged={onHLayout}
>
  <Panel
    id="left"
    panelRef={leftRef}
    collapsible
    collapsedSize={RAIL_PX}
    minSize={PANEL_WIDTH_LIMITS.sidebar.min}
    maxSize={PANEL_WIDTH_LIMITS.sidebar.max}
    defaultSize={sidebarWidth}
  >
    {/* 折叠时渲染 24px 边轨按钮，点击 onToggleSidebar；展开时渲染 sidebar */}
  </Panel>
  <Separator className="w-1.5 bg-transparent hover:bg-accent/50" />
  <Panel id="center" minSize={360}>
    <Group
      id="hi-story-split-v"
      orientation="vertical"
      className="h-full w-full"
      defaultLayout={vLayout}
      onLayoutChanged={onVLayout}
    >
      <Panel id="main" minSize={200}>
        {/* 顶栏 + 横向 Group：写作区 | AI */}
        <div className="h-full flex flex-col min-h-0">
          {/* 现有顶栏原样保留 */}
          <Group
            id="hi-story-split-center"
            orientation="horizontal"
            className="flex-1 min-h-0"
            defaultLayout={cLayout}
            onLayoutChanged={onCLayout}
          >
            <Panel id="editor" minSize={280}>
              <div className="h-full" hidden={workspaceMode !== 'writing'}>{writingArea}</div>
              {workspaceMode === 'planning' && planningArea}
            </Panel>
            {flags.ai && <Separator className="w-1.5 bg-transparent hover:bg-accent/50" />}
            {flags.ai && (
              <Panel
                id="ai"
                collapsible
                collapsedSize={RAIL_PX}
                minSize={PANEL_WIDTH_LIMITS.aiChat.min}
                maxSize={PANEL_WIDTH_LIMITS.aiChat.max}
                defaultSize={aiChatWidth}
              >
                {aiChat}
              </Panel>
            )}
          </Group>
        </div>
      </Panel>
      <Separator className="h-1.5 bg-transparent hover:bg-accent/50" />
      <Panel
        id="bottom"
        panelRef={bottomRef}
        collapsible
        collapsedSize={0}
        minSize={BOTTOM_MIN_PX}
        defaultSize={0}
      >
        {/* 空槽。P3 才往这里拖面板。不要放写作区。 */}
      </Panel>
    </Group>
  </Panel>
  {flags.rightAux && <Separator className="w-1.5 bg-transparent hover:bg-accent/50" />}
  {flags.rightAux && (
    <Panel
      id="right"
      collapsible
      collapsedSize={RAIL_PX}
      minSize={PANEL_WIDTH_LIMITS.insp.min}
      maxSize={PANEL_WIDTH_LIMITS.insp.max}
      defaultSize={inspWidth}
    >
      {/* 现有三选一 aside，仍互斥 */}
    </Panel>
  )}
</Group>
```

**接线规则：**

- **与上文「审查意见」L1–L3 冲突时以锁定为准**，不要按骨架字面把右栏/AI 做成边轨，也不要渲染空 bottom 的 Separator。
- 删掉 `useResize` / `handleSidebarResize` / `handleAiChatResize` / `handleInspResize` 和那三条 `w-1.5 cursor-col-resize` 手写条。
- **不要**在拖动时继续 `setItem(PANEL_WIDTHS_KEY)`（L3）。
- `panelState.sidebarOpen === false`：调用 `leftRef.current?.collapse()`（**实测 v4.12.4 `usePanelRef()` 返回 `RefObject<PanelImperativeHandle | null>`，有 `.current`**），不要 `{sidebarOpen && <aside>}` 卸载。边轨点击走现有 `onToggleSidebar`。拖过 minSize 导致的自动 collapse 必须同步回 `sidebarOpen`，并防循环。
- AI 最小化（右下角气泡）语义保留：最小化时 `flags.ai === false`，该 Panel 不参与 Group（与今天卸载 AI 列一致）。不要把最小化改成 24px 轨。
- 浮窗（大纲/素材/伏笔/导图/写章/审稿/润色）代码原样留在后面，不进 Group。
- 嵌套 Group 父级必须有可计算高度（`h-full min-h-0` / `flex-1 min-h-0`），避免写作区高度为 0。

[x] **Step 1: 接线**
[x] **Step 2: 跑测试与构建**

```
$env:ELECTRON_RUN_AS_NODE='1'; node_modules/electron/dist/electron.exe node_modules/vitest/vitest.mjs run tests/unit/workspace-p2.test.ts tests/unit/workspace-p0.test.ts tests/unit/theme.test.ts
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
node tests/ui/run-writing-workspace.cjs
npx vite build
```

预期：P2 新单测通过；P0 12/12；theme 4/4；写作 UI 12/12；vite 通过。

---

### Task 4: 文档

- [x] Spec「实施进度」P2 改为已编码/已验证之后，才能写「P2 已落地」。禁止报告超前。
- [x] `CLAUDE.md` / `AGENTS.md` 补一句：分隔条换库 + 边轨折叠 + 空 bottom；浮窗未入槽。
- [x] 计划 checkbox 与验证结果同步。

### 验证结果（实现者，2026-09-12）

- `workspace-p2.test.ts` 6/6（含 `splitPanelIds` 纯函数锚点）；`workspace-p0` 12/12；`theme` 4/4；写作 UI 12/12；`npx vite build` 通过
- 主体 `0e4e125`，手测接线修复 `30c08f1`，文档 `b3fb979`
- 手测：拖条、侧栏 24px 轨并恢复、刷新比例、空 bottom 拖不出空白带
- **复核建议第 2 条已落地**：`splitPanelIds`（`horizontalPanelIds`/`centerPanelIds`/`verticalPanelIds`）抽成纯函数并加 3 条单测，锁「有/无右栏、有/无 AI」组合。关 AI/关右栏/1000 宽顶栏三项手测**已补测通过**（2026-09-12）。

**P2 已落地。**

### 第二人复核建议（2026-09-12，给实现者看）

完整条文在 Spec「P2 收口第二人复核」。摘要：

1. **先写 P3 计划再编码**，不要接着拖放。
2. 把 `panelIds` 组合抽纯函数补进 `workspace-p2.test.ts`，锁住 `30c08f1` 的刷新丢比例。
3. P3 才给 bottom 挂 Separator / `minSize={120}`；无面板时不要让 `BOTTOM_MIN_PX` 生效。`bottomRef` 目前从未 `collapse()`。**已写入 P3 计划约束与定案，编码时按那份做。**
4. 手测已补：关 AI、关右栏、约 1000 宽顶栏仍可点。
5. P3 仍以 `node tests/ui/run-writing-workspace.cjs` 为门。

---

## 验收

自动：

- `workspace-p2.test.ts` 通过
- `workspace-p0.test.ts` 仍 12/12
- `theme.test.ts` 仍 4/4（证明没混改主题）
- 写作 UI 12/12（策划往返正文还在）
- `npx vite build` 通过

手动（编码后，提交前建议 3 分钟）：

- 拖侧栏 / AI / 右栏分隔条，编辑器跟着变宽变窄
- 折叠侧栏出现 24px 边轨，编辑器立刻变宽；再点恢复
- 关掉或最小化 AI 后编辑器立刻变宽（列卸掉，**不是** 24px 轨；见 L1）
- 关掉灵感/参考/起名后右列消失，**不**留边轨
- 刷新后侧栏/AI/右栏比例还在（库 persistence，不是 `hi-story-panel-widths` 双写）
- 默认 Dark 外观不被本阶段改掉
- 底槽看不见、**拖不出**空白带（P2 不渲染或禁用这条 Separator）
- 写章浮窗仍浮着（P3 才入槽）
- 约 1000 宽：只开侧栏+编辑器可写；再开 AI/右栏时写作区不被压没，顶栏仍点得到

## 明确不做

- 拖放到槽 / `PanelChrome` / Drop Zone
- `hi-story-workspace-v1` 布局模型
- 扫 `text-white` / 写章灰底
- 跟随系统主题
- 工作区预设（P4）
- 删 `Layout.tsx` / `MainArea.tsx` / `ContextPanel.tsx`
