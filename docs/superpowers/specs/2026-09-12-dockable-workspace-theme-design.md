# Dockable Workspace 与主题系统：代码审查 + 实施方案

> 状态：**已批准设计（2026-09-12）。7 条决策全部按默认确认。P0/P1/P2/P3 已 commit。P3 已落地（2026-09-13，两处产品翻案已入合同：写章/审稿/润色保持浮动不入槽、面板归属不持久化重启清空）。P4 未开始。**
>
> 日期：2026-09-12
>
> 本文档可以修改，不是不可变合同。实施中若与真实代码冲突，先改 Spec 再编码。
> - P0 计划：`docs/superpowers/plans/2026-09-12-workspace-p0-layout-bleed.md`
> - P1 计划：`docs/superpowers/plans/2026-09-12-workspace-p1-theme.md`
> - P2 计划：`docs/superpowers/plans/2026-09-12-workspace-p2-splitter.md`
> - P3 计划：`docs/superpowers/plans/2026-09-12-workspace-p3-dock.md`

## 一句话目标

在不重写 UI、不碰 SQLite 业务数据、不拆掉写作区挂载与 AI 流状态的前提下，把现有「半固定 + 半悬浮」工作区升级为可停靠、可调尺寸、可折叠、可恢复的结构化布局，并补上统一的 Light / Dark 主题令牌。

## 范围边界

本轮设计覆盖用户提出的四块需求，但**禁止一次做完**：

| 纳入 | 明确不做（本期或延后） |
|------|------------------------|
| 结构化停靠槽位（左 / 右 / 下 / 中央辅助） | VS Code 级任意嵌套拆分、自由悬浮覆盖层作为主模式 |
| 相邻面板 Splitter + min/max | 把确认类弹窗改成可停靠面板 |
| 辅助面板折叠 | 工作区预设（写作 / 策划 / AI / 审稿）— 基础稳定后再做 |
| 布局持久化（位置、尺寸、折叠、比例） | 把布局写入 SQLite / 项目库 |
| 窗口缩放时的溢出与挤压修复 | 原生标题栏 / 无边框窗口改造 |
| 长文本区跟随父级或可调高度 | 重写 TipTap 编辑器 |
| CSS 变量 + Light/Dark 两套令牌 | 一次扫完所有硬编码颜色（分批迁移） |

硬约束（来自现有生产路径，实施不得破坏）：

1. `WritingArea` 在策划 / 写作切换时必须保持挂载（`hidden` 而非卸载），否则待保存正文和 2 秒防抖会丢。
2. `AIWritePanel` / `AIReviewPanel` / `AIPolishPanel` 当前用 `display:none` 保活，关闭面板不能卸载，否则进行中的流会断。
3. 不新增数据库迁移；不改章节保存、决策账本、策划 IPC。
4. 真实 UI 回归继续走 `node tests/ui/run-writing-workspace.cjs` 等现有脚本。

---

## 实施进度（2026-09-12）

| 阶段 | 状态 | 计划 | 证据 |
|------|------|------|------|
| P0 止血 | **已 commit** `cf9bbe0` | `docs/superpowers/plans/2026-09-12-workspace-p0-layout-bleed.md` | 单测 12/12、写作 UI 12/12 |
| P1 主题 | **已 commit** `d9c83cb` | `docs/superpowers/plans/2026-09-12-workspace-p1-theme.md` | `theme.test` 4/4、`workspace-p0` 12/12、写作 UI 12/12、`npx vite build` 通过 |
| P2 分隔条 + 折叠 | **已 commit** `0e4e125` + 修复 `30c08f1` | `docs/superpowers/plans/2026-09-12-workspace-p2-splitter.md` | `workspace-p2` 3/3、`workspace-p0` 12/12、`theme` 4/4、写作 UI 12/12、`npx vite build` 通过；手测已过（见下） |
| P3 拖进槽 | **已落地**（`cda1205`→`7c5b635`） | `docs/superpowers/plans/2026-09-12-workspace-p3-dock.md` | `workspace-layout` 17/17、`workspace-p2` 6/6、全量 373、写作 UI 12/12、build 通过；两处产品翻案已入合同 |
| P4 预设 | 未开始 | 等 P3 | — |

### P1 实际做了什么

- 新增 `src/renderer/styles/tokens.css`：Dark 用旧 Tailwind hex 原样转 RGB；Light 暖纸墨字写死。两套 `--ui-on-accent` 都是白。
- 新增 `src/renderer/theme/theme.ts`：`THEME_KEY='hi-story-theme'`，仅精确 `'light'` 为浅色；`parseTheme` / `applyTheme` / `persistTheme` / `loadTheme`；tokens 声明 ⊇ `ink('--ui-*')` 锚点。
- `tailwind.config.js` 全部改为 `rgb(var(--ui-…) / <alpha-value>)`，无残留 `#hex`。
- `index.css` 滚动条 / `::selection` / `.ProseMirror color` 改用变量；选区文字色是 `--ui-gray-100`，不是 `--ui-on-accent`。
- `index.html` 同步读 localStorage 设 `dataset.theme`，防闪白。
- 顶栏「☀️ 浅色 / 🌙 深色」；壳 `hover:text-white` 与输入框 `text-white` 改为 `text-gray-100`（`DockLayout` / `Sidebar` / `WritingArea` / `AIChatPanel` / `RichEditor`）。**保留** `bg-accent text-white`。

**已知残留（不算 P1 没做完，也不并进 P2）：**

- 按钮/图标上的显式 `text-white` 在 Light 下仍白字
- 写章 / 审稿 / 润色的 `bg-gray-950` 仍偏暗
- MindMap Canvas hex 未改
- 未在真实窗口做 2 分钟切主题手测

### P3 编码记录（2026-09-12，未标落地）

- **commit**：`cda1205`（模型+外壳）→ `0fd6268`（接线）→ `5c1c664`（槽内保 state）→ `0b0cbc0`（禁用半成品拖拽止血）→ `b80f966`（剥壳）→ `28ea4b8`（HTML5 拖拽）→ `c470500`（文档标已编码未落地）。
- **实现报告**（工作区，不入库）：`workspace-p3-dock-report.md`
- **定案落地情况**：见下方「P3 第二人复核」。**未标落地**，P4 不要开。

### P3 第二人复核（2026-09-12，给实现者看）

对照实现报告 + `layout-model.ts` / `DockLayout.tsx` / `SlotTabs.tsx` / `App.tsx`。

**结论：主体方向对，定案基本落到代码里，还不能算 P3 收口。** 自检写「未真窗口手测、不标落地」是对的。报告第 5 点说空 bottom 的 Separator 已按 `isSlotVisible` 做了，**和代码不符**——这比「没手测」更要紧。

六笔功能提交干净：模型 → 接线 → 切标签保 state → 拖拽卡死止血 → 剥壳 → HTML5 拖。`openKeepAlive` 进 layout、`movePanel` 拒绝保活面板、3+3、💬 不迁、写作区 `hidden`，都和后来拍的 A/D 一致。剥壳按约定拆开提交。用户抓到的两处也修对了：全屏 DropZones 卡死、切标签卸大纲丢分栏。

#### 对照锁定，实际做到了

> **⚠️ 本节是编码当时（2026-09-12）的对照，含已作废的「3+3 放 bottom」。2026-09-13 产品翻案：写章/审稿/润色改回浮动窗。当前合同以「P3 定案（2026-09-13 修订）」与 §8 浮动表为准，下表只作历史记录。**

| 定案 | 代码 |
|------|------|
| 大纲/素材/伏笔默认 right，可 `movePanel` | `DEFAULT_SLOT` + 顶栏 `movePanel` |
| 写章/审稿/润色固定 bottom，不走 `movePanel` | `openKeepAlive` / `closeKeepAlive`；`movePanel` 直接 return |
| 一条标签带、一次显示一个 | `bottom.panelIds` + `activeId` |
| 保活实例不卸 | bottom 的 `SlotView` 永远挂三个 AI 面板，`display` 切显隐 |
| 灵感/参考/起名同槽标签 | App 已不用 `applyRightAuxExclusive` |
| 剥壳 | 三 AI 面板已是 `h-full w-full`，不再 `fixed inset-0` |

#### 报告写错了一条

P2 复核第 3 条 / P3 定案第 4 条：有面板才挂纵向 Separator，才让 `BOTTOM_MIN_PX` 生效。现状：`bottomRef` 建了，**从不 `expand`/`collapse`**；main 和 bottom 之间 **没有 Separator**；bottom 仍是恒挂 + `minSize={120}` + `defaultSize={0}`。

后果两种都可能：打开写章时槽是 0 高，面板等于看不见；或者空槽被 120px 顶开。这两种都要真窗口看，但根因是接线没做，不是「测没测」。

#### 拖拽现在能编译，路径很脆

1. **单面板没有标签行，拖不起来。** `SlotTabs` 在 `panelIds.length <= 1` 时返回 null。只开大纲，没有手柄。
2. **空的 right 会卸载，没有 drop 目标。** 东西都拖到 bottom 之后，不能再拖回 right，只能靠顶栏。
3. **bottom 里普通面板和保活面板混在一起时，保活标签也会 `draggable`。** `movePanel` 会拒绝，但拖感应是假的。应按标签判断，不要整槽共用一个 `onDragStart`。
4. **顶栏不是开关：** 点「大纲」会 `movePanel(..., 'right')`，用户刚拖到底的大纲会被拽回 right。保活面板还好，`openKeepAlive` 已在则只切 active。

没有 Drop Zone 预览可以以后补；上面几条会让「拖进槽」在真窗口里不像做过。

#### 其余技术债（同意报告，级别更低）

- `layout.slots.left` 未消费：行为对，模型有死数据。
- 三 AI 面板 `if (!open) return null`：App 传 `open={true}` 现在碰不到；留下会在以后有人改 `open` 时把保活打穿，应删。
- `applyRightAuxExclusive` 生产不用了，P0 单测还在测它，容易让人以为互斥还在。
- 写作 UI 仍只锁写作区保活，锁不住入槽/拖拽。

#### 建议（按优先级，先做再手测，不要开 P4）

1. **先补 bottom 开合。** 有 `panelIds` 才挂 Separator，并 `bottomRef.expand()`；空则不挂条、`collapse()` 到 0。不要在没条的情况下宣称入槽完成。
2. **真窗口 3 分钟：** 开写章看 bottom 是否真展开；开大纲+素材，拖一个到底，刷新还在；关光 right 后再想拖回去（现在预期失败）；空 bottom 拖不出空白带。
3. 单面板要有拖拽入口（例如 `PanelChrome` 或单独手柄）；空槽要有 drop 面（哪怕 0 宽占位）；保活标签不要 `draggable`。
4. 顶栏改为：已在某槽 → `setActive` 或关闭；不要每次都塞回默认槽。
5. 删三个 AI 面板的 `if (!open) return null`。未手测通过前 Spec 继续写「已编码未落地」。

`node tests/ui/run-writing-workspace.cjs` 必须继续绿。

### P2 收口记录（2026-09-12）

- **commit**：`0e4e125`（主体）+ `30c08f1`（修复）。
- **落地**：手写 splitter 换 `react-resizable-panels` v4；仅侧栏 24px 轨；AI/右栏关闭仍卸载；空 bottom 槽占位不露分隔条；`useDefaultLayout` 唯一写手，`hi-story-panel-widths` 只作首次种子。
- **手测发现并修复的两个接线 bug**（几何无 DOM 回归锁，靠真人手测抓到）：
  1. 侧栏点 ☰ 只 `hidden` 内容、未真 `collapse()` Panel → 点轨恢复宽度异常。修：`useEffect` 监听 `sidebarOpen` 双向同步 `expand()/collapse()`；`onResize` 对称回写状态。
  2. AI/右栏条件渲染导致 `useDefaultLayout` 持久化 layout 与当前面板数对不上、刷新回默认。修：按当前组合传 `panelIds`（h/v/center 三组）。
- **手测结论**：拖分隔条改占比、折叠侧栏出 24px 轨并恢复、刷新比例保留、空 bottom 拖不出空白带，均已过。
- **未覆盖**：仍无 Electron 几何 E2E，几何行为靠库背书 + 手测，无自动回归锁。

### P2 收口第二人复核（2026-09-12，给实现者看）

**结论：P2 可以算收口。** L1–L3 都做到了；`0e4e125` 主体 → `30c08f1` 修手测 bug → `b3fb979` 只改文档，没有和主题色混 commit。手测抓到的两个接线 bug（☰ 未真 collapse、条件面板缺 `panelIds`）修对了，比「测试全绿就宣布落地」扎实。写作区 `hidden`、三面板 `display:none`、`contextPanel` 未顺手删，纪律也对。

下面 5 条是建议，**不是判定 P2 没做完**。P3 开工前请过一遍。

1. **先别开 P3 编码。** 下一步是抽 `WorkspaceLayoutV1` + 拖放 + 浮窗入槽，Spec 里风险最高。先写 `docs/superpowers/plans/2026-09-12-workspace-p3-dock.md`（或当日文件名），写清：写作区保活、AI 三面板 `display:none`、`applyRightAuxExclusive` 泛型随 layout model 一起改、空 bottom **有面板进槽才**挂 Separator / `minSize`。计划评审后再编码。**（后续：计划已写、两处定案已锁。编码仍等用户发话，不要从本复核段直接开工。）**
2. **把刚修的两个 bug 收成纯函数单测。** 现在 `tests/unit/workspace-p2.test.ts` 只有 3 条布尔，锁不住 `30c08f1`。至少把 h/v/c 三组 `panelIds` 抽成函数（有右栏/无右栏、有 AI/无 AI），P3 改 Group 时刷新丢比例会再犯且没有自动网。侧栏 `expand/collapse` 双向同步很难单测，至少在 P3 计划里列为回归手测，不要只靠记忆。
3. **空 bottom 仍是 P3 的雷。** `bottomRef` 建了却从不 `collapse()`，Panel 仍是 `defaultSize={0}` + `minSize={120}`。P2 因为没画纵向 Separator，手测拖不出来；P3 一加条就会按 120px 弹开。P3 计划写死：无面板时不挂条、不生效 `BOTTOM_MIN_PX`。
4. **本计划文件当时没写验证结果。** Spec / CLAUDE 已标落地，`workspace-p2-splitter.md` 文末曾停在「不提交。等用户发话。」实现者不要按那句当未完工。以本收口 + 计划文末补的验证结果为准。
5. **手测记录缺 1000 宽和关列。** 收口写了拖条、侧栏轨、刷新、空 bottom。计划验收里还有：关掉/最小化 AI、关掉右栏、约 1000 宽顶栏仍点得到。若没测过，P3 前补 1 分钟；测过了把一句补进上面「手测结论」。

P3 拖放不能只靠手测，`node tests/ui/run-writing-workspace.cjs` 必须继续当门。

---

## Spec 审查意见（2026-09-12）

对照当前代码（P0 已 commit、P1 已编码）、P2 计划及其 L1–L3。**结论：终态设计仍然成立，7 条决策不用翻案。** 问题是这篇既是「审查当时的代码」又是「分阶段实施方案」，后半段已经开工，前半段很多「当前」已经不是当前；阶段条款和终态示意图也没标「哪一段才做」。实现者若从 §推荐技术方案 直接开 P2，会把 P3 做进 P2。

### 文内已修的打架

- 文首「下一步 P2」曾写「侧栏、AI、右栏都折轨」；§实施阶段 P2.4 已改成仅侧栏。**以 P2.4 / 计划 L1 为准。**
- 下文若仍出现 `autoSaveId`、`PanelGroup`、约 625 行、`resize-none`、宽度不持久、没有主题，视为 **2026-09-12 开工前的审查快照**，不以之为编码依据。

### 必须把「终态」和「本阶段」拆开（否则 P2 会超范围）

| 终态（§推荐技术方案 / §8 / §10） | 实际阶段 |
|----------------------------------|----------|
| 四槽 + 槽内标签 + 拖进槽 | **P3**（本轮只迁六个浮窗；AI 对话不进槽） |
| AI 打开进入 **right**（与灵感同槽标签） | **终态 / P3 之后一小步**。本 P3 不迁。P2 保持 AI 在编辑器右侧独立列 |
| 大纲/素材/伏笔默认 right；写章/审稿/润色**保持浮动窗（不入槽）** | **本 P3**（产品实测翻案，原「3+3 bottom」作废） |
| 左/右/底都 24px 边轨 | **P3**。P2 只有侧栏轨 |
| `hi-story-workspace-v1` 管面板归属 | **P3**。P2 只用库 persistence 管比例 |
| 抽出 `WorkspaceLayoutV1` 再换 splitter | **不要按 §7 原文顺序。** 实际是 P0 止血 → P1 主题 → P2 先换 splitter（不抽模型）→ P3 再抽模型 |

§7 写「① 先抽模型 ② 再用 PanelGroup」。按那条做会在 P2 打开 P3。**锁定：P2 禁止抽 layout-model。**

### 审查原文里已经过时的「当前」（不要当 bug 再修一遍）

P0 已做：灵感/参考/起名互斥、顶栏 `flex-wrap`、浮窗夹紧、AI 输入 `resize-y`、润色解除 340px、宽度写入 `hi-story-panel-widths`。  
P1 已做：CSS 变量、Light/Dark、顶栏切换。  
§0「宽度重启即丢 / 没有主题」、§1.1「唯一持久化是字号」、§3.1「宽度只在内存」、§3.3–3.5 里对应条目、§11「无 CSS 变量 / 语义色是编译期常量」——都是开工前快照。

§3.5 第 2 条「没有纵向分割」：P2 已加空 bottom 占位；**本 P3** bottom 只放「拖进去的查阅类面板」，写章/审稿/润色保持浮动不入槽。把 AI 对话拖到下方是终态/后续一小步，本 P3 不做。

### 仍成立、编码必须遵守

- 写作区 `hidden`、AI 三面板 `display:none`、决策账本模态、不上完整 docking 库、布局不进 SQLite、导图可浮动例外、死代码一期不删。
- 代码锚点已漂移：保活写作区现在约 `DockLayout.tsx:484`，写章 `display:none` 约 `:629`。引用块不要当精确行号。

### 建议补进风险、但不改 7 条决策

1. **像素 min 之和大于窗口 minWidth。** Electron `minWidth: 1000`，侧栏 200 + 编辑 280 + AI 300 + 右栏 300 = 1080。P0 验收「1000×600 可操作」靠关列；P2 换库后仍必须靠关列/侧栏轨，不能四列同时用像素 min 硬撑。
2. **三套 localStorage。** `hi-story-panel-widths`（P0 像素）→ 库 `useDefaultLayout`（P2 比例）→ `hi-story-workspace-v1`（P3 归属）。同时写会抖。P2 计划 L3：只留库为写手。
3. **空 bottom 的 Separator。** Spec P2.3「可 0 高度」若仍画出分隔条，用户会拖出空白。P2 计划 L2：不露条。
4. **Obsidian 只读浏览改可停靠（§8）不要进 P3 第一刀。** 现在是模态，和导入向导一样有路径/扫描语义；P3 先迁浮窗工具（大纲/素材/伏笔/写章/审稿/润色）。浏览保持模态。
5. **手动验收清单混了 P0–P3。** 「灵感+参考以标签切换」「拖 AI 到下方」「写章生成中拖到另一槽」都是 P3。P0 已是互斥不是标签。清单保留作终态，但条目应标阶段，避免 P2 做完被判没做完。

### 明确不反对

- 四槽不上嵌套、工具默认入槽、预设放 P4、P0/P1 禁止混改：仍对。
- P1 第二批白字/写章灰底不并进 P2：仍对。
- `applyRightAuxExclusive` 泛型留到 P3：仍对。

---

## 0. 现状总览（审查结论）

> **快照说明：** 本节是开工前审查。P0 已持久化宽度并修互斥/浮窗/顶栏；P1 已有主题切换。未修的仍是：多数工具是浮窗盖编辑器，没有真正停靠。

HiStower 已经有一个名叫 `DockLayout` 的布局壳，但**不是**可停靠系统。它是：

- 左侧固定槽：侧栏（可关、可横向拖宽）
- 中央固定槽：策划 / 写作（写作区用 `hidden` 保活）
- 中央右侧槽：AI 对话（可关、可最小化、可横向拖宽）
- 最右侧一排：灵感 / 参考 / 起名（可关，宽度状态互相绑死）
- 其余工具：绝对定位的浮动窗（大纲、素材、伏笔、导图、写章、审稿、润色）

用户痛点与代码一一对应：多数工具不在结构布局里，而是盖在编辑器上；宽度重启即丢；多开右侧面板会把正文挤没；没有主题切换。

---

## 1. 当前相关 UI 架构是如何实现的？

### 1.1 所有权

`App.tsx` 是唯一的工作区编排器：

- 拥有全部业务状态（章节、人物、策划、AI 上下文）。
- 拥有 `panelState`（各面板开关、AI 参与级别）。
- 把子树作为 `ReactNode` 注入 `DockLayout`。
- 面板开关只活在 React state，**刷新丢失**（P0 只持久化三栏宽度，不是哪些面板开着）。已持久化的 UI 偏好：字号 `hi-story-font-sizes`、栏宽 `hi-story-panel-widths`、主题 `hi-story-theme`。

`DockLayout.tsx`（开工前约 625 行，P1 后约 670+）负责几何：侧栏/AI/灵感宽度、浮动窗矩形、顶栏按钮、字体缩放。它**不**管理业务数据。P0 起宽度另存 `hi-story-panel-widths`；P1 起主题存 `hi-story-theme`。字号仍是 `localStorage['hi-story-font-sizes']`。

`Layout.tsx`、`MainArea.tsx`、`ContextPanel.tsx` 是更早的三栏布局，**当前无引用**，属于死代码。人物编辑已改走 `CharacterEditDialog` 模态框。

### 1.2 面板三类形态

| 形态 | 组件 | 行为 |
|------|------|------|
| 结构停靠（假 docking） | Sidebar、WritingArea / PlanningWorkspace、AIChatPanel、Inspiration / Reference / NameGenerator | 在 Flex 行里占固定像素宽 |
| 浮动窗 | MindMap、MaterialPanel、OutlinePanel、ForeshadowingPanel | `fixed` 层 + 绝对定位矩形，标题栏拖动，8 向缩放 |
| 自管浮动窗 | AIWritePanel、AIReviewPanel、AIPolishPanel | 组件内部自己做 position/size，DockLayout 只控制显示 |
| 模态 / 对话框 | CreativeDecisionPanel、CharacterEditDialog、ImportDialog、ObsidianPanel、DatabaseBrowser、ObsidianImportPanel | `fixed inset-0` 遮罩，不参与工作区 |

顶栏是全局开关集合，按钮很多，窄窗口会挤在一行。

### 1.3 关键实现细节（必须保留）

```484:486:src/renderer/components/DockLayout.tsx
            <div className="h-full" hidden={workspaceMode !== 'writing'}>{writingArea}</div>
            {workspaceMode === 'planning' && planningArea}
```

```629:631:src/renderer/components/DockLayout.tsx
      <div style={{ display: panelState.aiWriteOpen ? 'block' : 'none' }}>
        {aiWritePanel}
      </div>

任何新布局必须继续「写作区保活 + AI 写章/审稿/润色保活」。停靠库若默认卸载不可见图，不能直接套。

---

## 2. 当前布局使用 Flex、Grid、绝对定位还是其他方案？

以 **Flex 为主，绝对定位为辅，Grid 仅局部**：

| 区域 | 方案 |
|------|------|
| 根工作区 `DockLayout` | `h-full flex` 横向 Flex |
| 主列 | `flex-1 min-w-0 flex flex-col` |
| 写作区 | `h-full flex flex-col`；编辑器容器 `flex-1 overflow-hidden` |
| RichEditor | 内部再套 `h-full flex flex-col`，正文 `flex-1 overflow-y-auto` |
| 策划页 | 外层 `h-full overflow-y-auto`；内层 `max-w-6xl mx-auto`；局部 `grid`（想法区 / 阶段字段） |
| 施工卡 | `grid grid-cols-1 lg:grid-cols-2` |
| 浮动工具 | `fixed inset-0` + `absolute` + 像素 `left/top/width/height` |
| 分隔条 | 手写 `w-1.5 cursor-col-resize`，**没有**纵向 splitter |
| Electron 窗 | 默认 1400×900，`minWidth: 1000`，`minHeight: 600` |

没有 CSS Grid 工作区、没有容器查询、没有 `react-resizable-panels` / Allotment 一类库。`package.json` 里布局相关依赖为零。

---

## 3. 哪些组件存在固定尺寸？

### 3.1 结构宽度（P0 起写入 `hi-story-panel-widths`；审查时尚未持久）

| 值 | 默认 | 限制 | 位置 |
|----|------|------|------|
| 侧栏 | 280 | 200–420 | `DockLayout` |
| AI 对话 | 380 | 300–700 | `DockLayout` |
| 灵感/参考/起名 | 360 | 300–600 | **三个面板共用同一个 `inspWidth`** |
| 人物卡 / 世界观卡 | 360 | 拖拽改宽 | `CharacterCard` / `WorldEntryCard`（人物卡已不在主路径） |
| 旧 `Layout.tsx` | 侧栏 280 / 上下文 320 | 220–400 / 240–600 | 未使用 |

### 3.2 浮动窗矩形

打开时按 `window.innerWidth/Height` 算一次，之后不跟随窗口缩放：

- 导图：约 500 × (窗口高 − 96)
- 素材 / 大纲 / 伏笔：接近全屏的大矩形
- 写章：680×500，缩放 480–1400 × 300–900
- 审稿 / 润色：同类右下角缩放

最小浮动：300×200。

### 3.3 文本区固定高度

| 区域 | 现状 | 问题 |
|------|------|------|
| 正文 RichEditor | 跟随父级 `flex-1`，文档 `min-h-[200px]` | 主路径合理；父级被挤小时仍可滚 |
| AI 对话输入 | 审查时 `rows={2}` + `resize-none`；**P0 已改 `resize-y`** | 长 prompt 曾无法拉高 |
| 润色对比 | 审查时 `min-h-[340px] max-h-[340px]`；**P0 已解除双锁** | 曾写死高度 |
| 策划想法 | `rows={7}` + `resize-y` | 已可拉，但不跟面板 |
| 策划总纲/卷纲/章纲 | 多为 `rows={2}` | 长字段局促 |
| 决策账本 textarea | `rows={2}` + 部分 `resize-y` | 模态内可接受 |
| 世界观内容 | `rows` 随面板宽度估算 | 宽了行数变多，语义奇怪 |

### 3.4 其它固定像素

- 顶栏按钮组：审查时无换行；**P0 已 `flex-wrap`**。按钮仍多，窄窗可能折两行，不再被裁切到点不到。
- 施工卡 `mx-6` 固定边距。
- 导入/资料库等对话框 `w-[600px]` / `w-[800px]`。
- 决策账本 `max-w-3xl max-h-[90vh]`。
- Electron `minWidth: 1000` 挡不住**内部**多面板叠加溢出。

### 3.5 审查时发现的布局缺陷（对照进度）

1. **灵感 / 参考 / 起名共用 `inspWidth`**，拖一个改三个；同时打开则横向并排，轻松吃掉 900px+。→ **P0 已互斥**（仍共用宽度数字；并排已禁）。同槽标签是 P3。
2. **没有纵向分割**，不能把 AI 对话放到编辑器下方。→ **仍真。** P2 只占位空 bottom；把 AI 拖下去是 P3。
3. **浮动窗不随窗口 resize 夹紧** → **P0 已夹紧。**
4. **顶栏按钮溢出** → **P0 已 wrap。**
5. `useResize` 写在组件体内 → **P2 换库后删除。**

---

## 4. 当前是否已经存在 Panel / Layout 抽象？

**有壳，没有模型。**

已有：

- `DockLayout`：硬编码槽位 + 手写 resize + 手写浮动窗。
- `panelState`：布尔开关，不是布局树。
- 各功能组件：自己画标题栏 / 关闭按钮 / 内部滚动。

没有：

- 面板 ID 注册表（`ai-chat` / `outline` / …）
- 槽位（slot）或布局树（layout tree）
- Drop Zone / Dock Preview
- 统一 `PanelChrome`（标题、折叠、拖动手柄）
- 持久化用的布局 schema
- 面板与几何解耦（AI 写章把业务和窗口几何写在同一个文件）

渐进改造的切入点正是：**先抽出布局模型，再改 `DockLayout` 的渲染，不改面板内部业务。**

---

## 5–6. 引入 Docking 是否需要第三方库？最适合的方案？

### 三种路线

**A. 完整 Docking 库（dockview / flexlayout-react / rc-dock）**

- 优点：拖放、预览、标签页、嵌套拆分一次齐。
- 缺点：默认卸载隐藏面板，和写作区 / AI 流保活冲突；样式与现有 Tailwind 主题两套；学习与回归成本高；一次换壳风险大。
- 结论：**一期不上。** 若二期槽位模型不够用，再评估 dockview（TypeScript 优先），且必须配置 keep-alive。

**B. 只引入 Splitter 库 + 自研槽位（推荐）**

- 引入 `react-resizable-panels`（约 10kb，支持 collapse；审查原文写的 `autoSaveId` 是 **v3** API。P2 钉 **v4**：`useDefaultLayout({ id, storage })` + `Group` / `Panel` / `Separator`）。
- 自研 4 个固定槽：`left` / `center` / `right` / `bottom`。
- 槽内多面板用标签页，不支持无限嵌套。
- 拖动面板标题 → 四边/中央辅助 Drop Zone 高亮 → 放入目标槽。
- 优点：符合「结构化停靠」；可渐进替换现有 Flex；写作区永远在 `center` 且不卸载。
- 缺点：达不到 VS Code 那种任意拆分；要自己做拖放预览。

**C. 零新依赖，继续加手写 splitter**

- 优点：无新包。
- 缺点：纵向分割、持久化、多槽比例、窗口变小时的 min 约束都要自写；`DockLayout` 会继续膨胀。
- 结论：只适合「先持久化现有宽度」的预热补丁，不适合作为目标架构。

**推荐：B。** Allotment 是可替换的 splitter（VS Code 风格），但 `react-resizable-panels` 更轻、collapse API 更贴「可折叠面板」。

---

## 7. 是否能够在现有结构上渐进式改造？

**能，而且必须。** 路径（**实际开工顺序已与当初草案不同**，以文首实施进度为准）：

```
现有 DockLayout 渲染
    ↓ P0 止血（宽度持久化 / 互斥 / 浮窗夹紧）——已 commit
    ↓ P1 主题令牌 ——已编码
    ↓ P2 用 v4 Group 替换三条横向 splitter（不抽模型；空 bottom 占位）
    ↓ P3 抽出 WorkspaceLayoutV1 + 浮窗可拖进槽
    ↓ P4 预设；导图等保留「弹出浮动」
```

当初草案是「① 先抽模型 ② 再换 PanelGroup」。**不要再按那条做 P2。** 禁止先删 `DockLayout` 再重写。

组件侧约定：

- 功能面板只渲染**内容**，外壳（标题、拖动手柄、关闭、折叠）由 `PanelChrome` 提供。
- 迁移期允许旧浮动窗与新槽位并存：未入槽的面板仍用现在的浮动实现。

---

## 8. 哪些模块应该支持 Docking？

可停靠 = 可在 `left | right | bottom` 之间移动，槽内以标签页共存。

| 面板 | 默认槽 | 说明 |
|------|--------|------|
| 侧栏（项目/章节/人物/世界观） | left | 可停到 right；不进 bottom（列表过矮难用） |
| AI 对话 | 终态 right；**本 P3 不迁** | 仍停 P2 的 center 内侧列。入槽单开一小步，避免和 right 槽双份真相 |
| 灵感 / 参考 / 起名 | right | 改为标签页，禁止再横向叠三个 |
| 大纲 | **P3 默认 right** | 可拖到底；不再盖编辑器 |
| 素材 | **P3 默认 right** | 同上 |
| 伏笔 / 钩子追踪 | **P3 默认 right** | 可拖到底 |
| AI 写章 | **浮动窗（本 P3 不入槽）** | 产品实测后翻案：放 bottom 太矮、对照正文不便，回到浮动；**实例保活**（关闭 display:none 不卸载，流不断） |
| AI 审稿 | **浮动窗（本 P3 不入槽）** | 同上。审稿报告长，放 bottom 压扁正文，回浮动 |
| 润色 | **浮动窗（本 P3 不入槽）** | 同上。对照原文/润色结果需要大块并排空间，回浮动 |
| Obsidian 只读浏览 | 保持模态（P3 第一刀不改） | 审查时写「可改为可停靠」；导入向导仍用模态。浏览有路径/扫描语义，不并进第一批入槽 |
| 角色思维导图 | bottom 或 right | 需要较大画布；允许「弹出浮动」作为例外 |

中央 `center` 只放写作区或策划页，**不能被其它模块占领**。其它模块拖到中央时，实际进入「中央下方 `bottom`」或「覆盖为标签」——推荐进入 `bottom`，避免正文变成其中一个 tab。

---

## 9. 哪些模块只应该 Resize，而不应该 Dock？

| 模块 | 原因 |
|------|------|
| 正文编辑器 / 策划工作台 | 主工作面，必须占 `center` |
| 顶栏（策划/写作切换、字号、面板开关） | 应用铬，不是内容面板 |
| 写作目标条、状态栏 | 编辑器附属 |
| 章节标签条、施工卡 | 属于写作区内部，随编辑器 |
| 创作决策确认账本 | 确认事务 + 请求中禁止关闭，必须是模态 |
| 新建项目 / 导入小说 / 人物编辑 / 关系编辑 | 任务型对话框 |
| Obsidian 导入向导 | 多步提交，已有冻结控件语义 |
| 资料库浏览器 | 低频调试，保持模态即可 |
| Toast / 右键菜单 | 瞬态 |

这些区域内部仍可调高度（见第 3 节），只是不能拖到别的槽。

---

## 10. Layout Persistence 应该存在哪里？

**渲染进程 `localStorage`，键名 `hi-story-workspace-v1`，不要进 SQLite。**

理由：

- 布局是应用铬，不是小说数据；切项目不应走 IPC。
- 现有字号、AI 配置、写作目标已在 `localStorage`，Electron 会写到 `userData`。
- SQLite 会逼出迁移、仓库、失败回退，和「UI 几何」不成比例。

建议 schema（版本字段必带，坏数据回退默认布局）：

```ts
interface WorkspaceLayoutV1 {
  version: 1;
  slots: {
    left: { size: number; collapsed: boolean; panelIds: string[]; activeId: string | null };
    right: { size: number; collapsed: boolean; panelIds: string[]; activeId: string | null };
    bottom: { size: number; collapsed: boolean; panelIds: string[]; activeId: string | null };
  };
  openPanelIds: string[];          // 允许关闭（从槽中移除但仍记尺寸）
  aiLevel: 'off' | 'assist';
  floating?: Record<string, { x: number; y: number; w: number; h: number }>; // 仅导图等例外
}
```

比例由 `react-resizable-panels` 的持久化（v4：`useDefaultLayout`）另存一份亦可，但**面板归属**必须由我们的 JSON 管，不能只靠库。

**过渡（审查补丁）：** P2 **不**创建 `hi-story-workspace-v1`。P0 的 `hi-story-panel-widths` 只当种子；P2 比例只写库；P3 才引入上表 schema。三套 key 禁止同时当写手。**本 P3 收窄：** 归属 JSON 管六个工具 + 灵感/参考/起名 + 侧栏；`aiLevel` / `aiChatOpen` **先不**并进这份 JSON，仍走现有 `panelState`。

持久化粒度：

- 应用级一份（所有项目共用）。用户换项目通常希望同一套工作区。
- **不做**每项目布局，除非后续明确要。
- Electron 窗口位置/大小：主进程另存（`window.bounds`），与面板布局分开，一期可先不做。

失败策略：JSON 坏了 → 静默回默认，不弹错误、不写库。

工作区预设（延后）：在同一 schema 上存 4 份命名快照。默认布局可内置：

- 写作：left=侧栏，center=编辑器，right=关或 AI
- 策划：left=侧栏，center=策划，right 关
- AI 讨论：left=侧栏，right=AI 对话
- 审查：right 或 bottom=审稿 + 伏笔

一期只提供「恢复默认」，不提供命名预设 UI。

---

## 11. Theme System 当前基础如何？

> **P1 已编码：** CSS 变量、`data-theme`、Light 色板、顶栏切换、防闪白均已落地。下面保留审查原文作对照；以文首「实施进度」为准。

### 已有

`tailwind.config.js` 已有一套**仅暗色**的语义色（P1 起这些值来自 `tokens.css`，不再是编译期 hex）：

- `sidebar` / `editor` / `aichat` / `context` / `inspiration` / `float` 各 900–600 + accent
- 全局 `accent` / `accent-blue` / `accent-warm`
- 自定义暖灰 `gray.50–950`

设计意图明确（「林间稿纸」护眼暖绿），所以不是「完全没有设计系统」，而是 **token 只覆盖 Dark，且只活在 Tailwind 配置里**。

### P1 已补 / 仍缺

- **已补：** `html[data-theme]`、`tokens.css` CSS 变量、Light 色板、`theme.ts` 运行时状态、顶栏切换、`index.html` 防闪白。未开 Tailwind `darkMode`（按设计用变量换值，不加 `dark:` 前缀）。
- **仍缺（第二批，非 P2）：** 写章/审稿/润色 `bg-gray-950`、按钮图标显式 `text-white`、MindMap Canvas hex。

### 硬编码情况（开工前快照；P1 已把壳层 token 化，下列「无变量 / 编译期常量」不再成立）

- 无 `--color-*` CSS 变量。
- 大量 `bg-gray-*` / `text-white` / `border-gray-*` 与语义色混用。
- 写章 / 审稿 / 润色大量 `bg-gray-950`，绕开了 `aichat` / `editor` token。
- `RichEditor` 使用 `prose-invert`（暗色散文），Light 下会反。
- `MindMap` Canvas 直接画 hex，主题切换不会自动跟着走。
- 语义色本身也是 Tailwind 编译期常量，不能运行时换 Light。

### 主题改造原则

1. 把现有 Dark 色板**原样**变成 CSS 变量默认值，视觉一期不变。
2. `tailwind.config.js` 的颜色改为 `rgb(var(--ui-editor-900) / <alpha-value>)` 或 `var(--ui-editor-900)`。
3. `html[data-theme="light"]` 覆盖同一组变量。
4. 先换壳（DockLayout、侧栏、编辑器、AI 对话），再扫功能面板，最后才是 Canvas / 图表。
5. 对比度：Light 正文不低于深灰上浅纸；Dark 保持现有暖绿，不改成纯黑白。

不建议用 Tailwind 默认 `dark:` 前缀铺一遍 —— 现有 class 已经是「暗色语义名」，再加 `dark:` 会双倍 class。CSS 变量换值更适合「同一套 class 两套主题」。

---

## 12. 这些修改是否会影响现有业务逻辑、SQLite 数据或编辑器状态？

| 层 | 影响 |
|----|------|
| SQLite / 迁移 | **无。** 布局和主题不进库。 |
| IPC / Repository | **无。** |
| 章节保存 / TipTap | **有风险，但可隔离。** 只要 `WritingArea` 继续按 `activeChapter.id` 挂载、策划切换继续 `hidden`、不要把编辑器放进会卸载的 tab，保存链路不变。 |
| AI 流 | **有风险。** 写章/审稿/润色必须保活；停靠后只改外壳几何。切槽不得 `key=` 重置面板。 |
| 决策账本 | 保持模态。不要并进 docking，避免「请求中禁止关闭」与面板关闭按钮冲突。 |
| 策划工作台 | 仍在 `center`。只修内部 textarea 高度与小窗溢出。 |
| 项目加载守卫 | 不改。 |

回归最低集：`node tests/ui/run-writing-workspace.cjs`（保活 + 保存）、决策账本 UI、策划 Obsidian 导入 UI。布局单测以纯函数（slot 移动、非法停靠拒绝、坏 JSON 回退）为主。

---

## 推荐技术方案

### 布局模型（终态，主要是 P3；P2 只换分隔条 + 空 bottom）

固定四槽，不允许任意嵌套：

```
┌─────────── Toolbar（不可停靠）────────────┐
│ left │     center（写作/策划）    │ right │
│      │────────────────────────────│      │
│      │         bottom             │      │
└──────────────────────────────────────────┘
```

- 槽之间：`react-resizable-panels` 的纵向 + 横向 Group。
- 槽内部：标签页；同一槽多面板不并排占宽（修复当前灵感/参考/起名叠宽）。
- 拖放：面板标题 `pointerdown` → 幽灵 + 四边 Drop Zone；释放后更新 `WorkspaceLayoutV1`。
- 折叠：终态下槽 `collapsed` 后显示一条 24px 边轨，点击恢复。**P2 只做侧栏轨**；AI / 右栏关闭仍卸载。
- 中央永不折叠。

### 默认布局（P3 入槽后；与终态「AI 也进 right」不同）

- left: 侧栏
- center: 写作或策划；**AI 对话仍在 center 内侧**（本 P3 不进 right）
- right: 打开时默认进大纲 / 素材 / 伏笔，以及灵感/参考/起名标签；空则槽收起
- bottom: 打开时默认进写章 / 审稿 / 润色；无面板不挂 Separator、不弹开
- 导图：浮动例外；浮动几何仍 persist
- 打开后再拖，归属写入 `hi-story-workspace-v1`

### 主题

- `src/renderer/styles/tokens.css`：`--ui-bg`、`--ui-surface`、`--ui-editor`、`--ui-text`、`--ui-text-muted`、`--ui-border`、`--ui-divider`、`--ui-input`、`--ui-hover`、`--ui-active`、`--ui-selected`、`--ui-accent`、`--ui-disabled`、`--ui-warning`、`--ui-error`、`--ui-success`，以及现有 sidebar/editor/aichat 色阶。
- `document.documentElement.dataset.theme = 'dark' | 'light'`
- 顶栏增加一个切换，存 `localStorage['hi-story-theme']`
- 跟随系统：一期不做，避免和手动选择打架。

### 长文本

- 主编辑器：继续填满 `center`。
- AI 输入：`resize-y`，min 2 行，max 占对话面板 40%。
- 润色：取消 340px 双锁，改为 `flex-1 min-h-[160px]`。
- 策划：保持 `resize-y`，大字段 min-h 提到 6 行。

---

## 涉及文件

### 新增

| 文件 | 职责 |
|------|------|
| `src/renderer/workspace/layout-model.ts` | 类型、默认布局、移动面板、校验 |
| `src/renderer/workspace/layout-storage.ts` | localStorage 读写、坏数据回退 |
| `src/renderer/workspace/useWorkspaceLayout.ts` | React hook |
| `src/renderer/workspace/PanelChrome.tsx` | 统一标题栏 / 拖动 / 关闭 / 折叠 |
| `src/renderer/workspace/DropZones.tsx` | 拖动时的停靠预览 |
| `src/renderer/workspace/SlotTabs.tsx` | 槽内标签 |
| `src/renderer/styles/tokens.css` | 设计令牌 |
| `src/renderer/theme/theme.ts` | 读写主题 |
| `tests/unit/workspace-layout.test.ts` | 纯函数测试 |

### 大改（行为向后兼容）

| 文件 | 改什么 |
|------|--------|
| `src/renderer/components/DockLayout.tsx` | P2：消费 Group/Panel；P3：再消费 layout model |
| `src/renderer/App.tsx` | P3：六个工具 + 灵感/参考/起名 + 侧栏走 layout hook；**保留** `aiChatOpen` 等。顶栏主题切换已是 P1 |
| `tailwind.config.js` | 颜色改指向 CSS 变量 |
| `src/renderer/styles/index.css` | 引入 tokens，滚动条/选区用变量 |
| `src/renderer/index.html` | 可在载入前用一小段脚本读 theme，防闪白 |

### 小改（外壳，不改业务）

`AIWritePanel.tsx` / `AIReviewPanel.tsx` / `AIPolishPanel.tsx`：剥离内部 `panelPos/panelSize`，改为填满父级。
`AIChatPanel.tsx`：输入区可拉高。
`WritingArea.tsx` / `RichEditor.tsx`：Light 下去掉死写 `prose-invert`，改为 token。
`PlanningWorkspace.tsx`：小窗溢出、textarea min-height。
`MindMap.tsx`：二期再接 Canvas 色（一期可仍用暗色画布）。

### 不动

主进程、preload、所有 `db/*`、IPC、保存链路、决策账本事务、策划生成。
`Layout.tsx` / `MainArea.tsx` / `ContextPanel.tsx`：一期可标废弃，不顺手大删，除非确认无测试引用。

### 测试

- 单测：槽位移动、拒绝停到 center、折叠、坏 JSON、主题读写。
- UI：扩展 `tests/ui/writing-workspace.tsx`：侧栏折叠后写作区仍挂载；切策划再切回正文还在；关写章面板后再打开流状态仍在（若该测试已覆盖保活，保持断言）。
- 不要求新的 Electron 窗口几何测试除非手动验收清单。

---

## 实施阶段与优先级

按风险从低到高。每一阶段单独可交付、可回归。

### P0 — 响应式与现有 splitter 止血（不引入 docking）

**优先级：最高。改动小，立刻缓解「空间无法用」。**

1. 灵感 / 参考 / 起名改为互斥或同槽标签（哪怕先做成「同时只显示一个」）。
2. 顶栏溢出：`flex-wrap` 或「更多」菜单。
3. 浮动窗 `resize` 时夹紧到视口。
4. AI 输入 `resize-y`；润色区解除 340px 锁死。
5. 侧栏 / AI / 右栏宽度写入 `localStorage`（现有三个数字即可，不必等完整 model）。

验收：1000×600 可操作；1400×900 与最大化编辑器能吃到多出来的宽高。

### P1 — 主题令牌 + Light/Dark 切换

**优先级：高，且与布局正交，可并行。**

1. `tokens.css` + Dark 默认等于今天的色。
2. Light 色板（暖纸 + 墨字，不要纯白刺眼）。
3. Tailwind 改变量；顶栏切换。
4. 迁移 DockLayout / Sidebar / WritingArea / AIChat 的壳。
5. `prose-invert` 按主题切换。

验收：切换后主写作路径对比度可读；不要求所有面板第一天完美（写章灰底可第二批）。

### P2 — Splitter 库替换 + 折叠

**优先级：高。计划：`docs/superpowers/plans/2026-09-12-workspace-p2-splitter.md`（已 commit）。**

1. 加 `react-resizable-panels`。
2. left | center | right 可拖比例，带 minSize。
3. 增加 bottom 槽占位（可 0 高度 / collapsed）。P2 **不渲染或禁用** 纵向 Separator，禁止拖出空白带。
4. 仅侧栏可折叠成 24px 边轨；AI 关闭/最小化、右栏关闭仍**卸载**（AI/右栏边轨推迟到 P3 槽模型，避免与 P0 互斥卸载打架）。
5. 比例持久化：`hi-story-panel-widths` 只作首次 `defaultSize` 种子，之后以 `useDefaultLayout` 为**唯一**写手，不双写。不引入 `hi-story-workspace-v1`。

验收：拖分隔条改编辑器占比；关掉/最小化 AI 后编辑器立刻变宽（列卸载，不是边轨）；侧栏折叠成 24px 轨后编辑器立刻变宽；重启恢复比例。

### P3 — 结构化停靠（拖放到槽）

**优先级：中高，依赖 P2 的槽。计划：`docs/superpowers/plans/2026-09-12-workspace-p3-dock.md`（已编码，未收口；见文首「P3 第二人复核」）。**

1. `WorkspaceLayoutV1` 管大纲/素材/伏笔/灵感/参考/起名 + 侧栏；**不**替换 `aiChatOpen`（AI 对话仍 P2 列），也**不**管写章/审稿/润色（保持浮动窗布尔）。
2. `PanelChrome` + Drop Zone 预览。
3. 大纲 / 素材 / 伏笔 / 灵感 / 参考 / 起名默认 **right**；写章 / 审稿 / 润色**保持浮动窗、本 P3 不入槽**。Obsidian 只读浏览仍模态。
4. 保活：center 的 WritingArea、写章/审稿/润色关闭 display:none 不卸载（流不断）。入槽 ≠ `key` 重置。
5. 导图允许浮动例外。
6. 空 bottom 有面板才挂 Separator / `BOTTOM_MIN_PX`（空时卸载，不可拉）。
7. **面板归属不持久化**：重启后 right/bottom 默认空，只保留槽比例（用户 2026-09-13 决定，推翻原「拖到底刷新仍在」）。

验收：打开大纲进 right；把大纲拖到 bottom（本次会话内生效）；切策划再回来正文未丢；写章/审稿/润色仍浮窗、可拖可关、生成中流不断；💬 不出现在 right 槽标签；重启后已打开的面板清空。

### P4 — 工作区预设

**优先级：低，用户已标明非第一优先。**

内置 4 套快照 + 「恢复默认」。自定义命名预设可再后。

---

## 改动范围估计

| 阶段 | 量级 | 风险 |
|------|------|------|
| P0 | S：DockLayout + 2–3 个面板 | 低。可能误伤右栏同时开三面板的用户（应视为 bugfix）。 |
| P1 | M：css + tailwind + 高频组件 | 中。漏改硬编码会在 Light 下「暗色块」。分批可接受。 |
| P2 | M：DockLayout 重排 | 中。minSize 与窗口过窄时的策略要手测。 |
| P3 | L：新 workspace 模块 + 多个面板去浮动化 | 高。保活与拖放是主风险。必须写作 UI 回归。 |
| P4 | S | 低。 |

整体不碰 SQLite。预计不改 `package.json` 以外的主进程依赖；P2 只加一条 renderer 依赖。

---

## 风险

1. **卸载写作区** → 丢稿。缓解：center 只改 CSS 几何，禁止 tab 化写作区。
2. **卸载 AI 写章/审稿/润色** → 流停不住或状态清零。缓解：关闭 = 从槽隐藏但仍 mount（与今天 `display:none` 同构）。
3. **停靠库默认行为** → 不用完整 docking 库。
4. **Light 主题对比度** → 先做壳，Canvas/图表第二批；提供一键回 Dark。
5. **布局 JSON 升级** → `version` 字段，未知版本回默认。
6. **测试脆弱** → 写作回归以「仍挂载 / 仍保存」为断言，不要对像素坐标写死。
8. **像素 min 撑爆小窗。** 四列 min 之和 > `minWidth: 1000`。缓解：靠关列和侧栏轨，不把四列像素 min 当成同时可满足。
9. **三套 localStorage 双写。** P0 像素 / P2 库比例 / P3 归属 JSON。缓解：每阶段一个写手（见 §10 过渡）。
10. **空 bottom 分隔条。** P2 若画出 Separator，用户会拖出空洞。缓解：P2 不露条。

---

## 手动验收清单（开发开始后）

终态清单，条目后标最早阶段。未标阶段的不算 P2 没做完。

- [ ] **P0** 1000×600：侧栏可关，顶栏可点到写章/AI，无遮挡死区
- [ ] **P0/P2** 最大化：编辑器变高变宽，不是中间一条
- [ ] **终态 / 后续一小步** 拖 AI 对话到下方：编辑器在上、对话在下。**本 P3** 打开 💬 仍在 center 内侧，不进 right 槽标签
- [ ] **P2** 折叠侧栏再打开：出现 24px 轨后恢复，宽度/比例还在
- [ ] **P3** 重启应用：尺寸、折叠、主题与上次一致（P1 主题；P2 比例；**面板归属不持久化，重启清空**——2026-09-13 产品决定）
- [ ] **P0 起一直要** 策划 ↔ 写作：未保存正文仍在，自动保存仍触发
- [ ] **P3** 写章生成中把面板拖到另一槽：流继续，停止键仍可用
- [ ] **P1** Light / Dark 切换：侧栏、编辑器、AI 对话、顶栏一致；无需重启（写章灰底第二批）
- [ ] 决策账本仍是模态，请求中关不掉
- [ ] **P0** 同时打开灵感+参考：互斥，不是并排吃掉正文。**P3** 才改成同槽标签
- [ ] **P2** 空 bottom 拖不出空白带；**P3 后**写章/审稿/润色仍浮窗（保持浮动，不入槽）。**本 P3** 打开大纲进 right、拖到底（会话内）；空 bottom 卸载不挂 Separator

---

## 请确认的决策（已确认，2026-09-12）

第二人复核后，7 条全部按默认走，不再为用户增加选项。逐条确认如下，其中第 6 条补一处工程纪律澄清：

1. **停靠形态**：采用四槽结构化停靠，不上 VS Code 级嵌套。正文是主面 + 写作区不可卸载的硬约束，嵌套 docking 一上来就撞。
2. **依赖**：P2 引入 `react-resizable-panels`（小、支持 collapse、可渐进替换 Flex）；不上 dockview/flexlayout。完整 docking 库默认卸载隐藏面板，与写作区 / AI 流保活冲突。
3. **持久化**：`localStorage` 应用级一份，不进 SQLite、不做每项目布局。布局是窗口铬，不是小说数据；进库要迁移 + IPC + 切项目等待，纯亏。
4. **浮动**：查阅类工具（大纲/素材/伏笔/灵感/参考/起名）默认入槽；写章/审稿/润色**保持浮动窗**（产品实测翻案，见「P3 定案」）；思维导图保留浮动。写章/审稿/润色是最大盖屏源，但实测放槽内（尤其 bottom）太矮、对照正文不便，故不入槽。
5. **预设**：P4 再做。没有稳定槽位模型，预设只是四套易过期的硬编码；先「拖完能记住」再给快照。
6. **主题**：P1 与 P0 可并行（正交、互不阻塞）；Light 用暖纸墨字，Dark 保持现有林间稿纸。**澄清：并行 ≠ 混改。** P0 动 DockLayout 几何、P1 动 tailwind 颜色，两者都碰 DockLayout；每个 P 内部仍一步一提交，P0 收口 commit 完再开 P1 颜色改，避免回滚时互相牵连。
7. **死代码**：`Layout.tsx` / `MainArea.tsx` / `ContextPanel.tsx` 一期保留，不强制删除。不在主路径，顺手删会把范围扯进无测试旧组件；P3 稳定后再标废弃或删。

**开工顺序**：P0 止血（已 commit `cf9bbe0`）→ P1 主题（已 commit `d9c83cb`）→ P2 分隔条（已 commit `0e4e125` + 修复）→ P3 拖进槽（已编码 `cda1205`→`28ea4b8`，**未标落地**，见「P3 第二人复核」）→ P4 预设（P3 收口后再做）。

**P3 备忘：** `applyRightAuxExclusive` 的 `T extends Record<RightAuxKey, boolean>` 绑的是当前 `panelState` 三字段；抽 `WorkspaceLayoutV1` 时一并改泛型，P0/P1/P2 不提前重构。

### P3 定案（2026-09-12 第二人拍板；2026-09-13 产品翻案后修订）

原定案「写章/审稿/润色放 bottom」经用户实测后**推翻**，改为保持浮动窗。完整理由见计划文末「已确认决策」。

1. **AI 对话本 P3 不迁。** 打开 💬 不走 `movePanel`；`movePanel` 拒绝 `aiChat`。
2. **写章/审稿/润色保持浮动窗，本 P3 不入槽。** 原「3+3」作废。理由：bottom 槽太矮压扁大工作面、对照正文/原文不便；用户明确要回浮动。它们退出 layout，走 `aiWriteOpen`/`aiReviewOpen`/`aiPolishOpen` 布尔 + 父级 `display:none` 保活（关闭不卸载，流不断）。大纲/素材/伏笔/灵感/参考/起名 → right 入槽不变。
3. **`WorkspaceLayoutV1` 本轮收窄。** 只管大纲/素材/伏笔/灵感/参考/起名 + 侧栏，**不是**全部 `panelState` 的唯一源。`aiChatOpen` / `aiChatMinimized` / `aiLevel` + 三个浮动面板布尔仍留 P2/面板层。
4. **空 bottom：** 有面板才挂 Separator / 生效 `BOTTOM_MIN_PX`。无面板不挂条、不弹开。Obsidian 浏览仍模态。导图可浮动。
