# stages 进 AI 上下文 Spec

> 状态：**设计定稿（终审已收口）**。范围：AI 上下文只做拆章；策划页补改总纲清空提示。写正文 / 普通对话不采纳。「重新生成分卷纲会清空 stages」定案选「不做 + 记风险」。本轮仅产出本文档，不写代码。
>
> 第二轮审查修正：R1 签名改为携带绝对卷号、R2 补「当前卷无 stages 则整段不注入」、R6 改为独立 notice state 并在总纲区就地渲染、8.4 单测基线实测为 42 文件 / 273 全过。
>
> 第三轮审查修正：删掉遗留风险里残留的 `setError`、8.1 补「部分卷有阶段部分无」、删掉硬编码的「107/107」。
>
> 终审修正：8.3 测试程序按源码重写（场景 N 未挂策划页、`stage` fixture 缺 `phases`、textarea 须 `fireInput`、不得测 `generateVolumes`）；R6 文案区分本地清空与写库；R6 示例保留章纲清空；生产代码白名单改为最多两个文件。
>
> 基线提交：`eb2eab6`
>
> 前置 Spec：`2026-09-11-obsidian-stage-import-design.md`（stage 落库，已收口，真实 vault 烟测除外）

## 一句话目标

把已落库的卷内阶段（`VolumeOutline.stages`）以**分级有界**形式注入**拆章**上下文，让作者在 Obsidian 里手写的阶段推进真正约束 AI 拆出的章纲，而不是只停在策划页只读展示。不注入写正文与普通对话（理由见「不采纳的替代」），不新增数据库迁移，不改变 stages 的落库结构。

## 现状与证据

以下均为已读源码核实结果：

1. **stages 的落库位置**：`VolumeOutline.stages?: VolumeStage[]`，序列化在 `planning_ideas.volume_outlines` JSON 列（迁移 v13 已有字段，无新迁移）。`VolumeStage` 字段：`title / chapterRange / goal / keyProgressions[] / characters[] / worldRefs[] / exit / endingHook`。

2. **两套大纲体系（核心难点）**：
   - **体系 A（旧大纲树）**：`outline_nodes` 表，`App.tsx` 持有 `outlineNodes` state。**写正文**（`AIWritePanel`）、**普通对话**（`App.tsx` 的 `ContextBuilder.build`）、**审稿**（`AIReviewPanel`）都走这套。
   - **体系 B（新策划工作台）**：`planning_ideas` 表，`PlanningWorkspace` 内部持有 `volumeOutlines`/`chapterOutlines` state。**拆章**（`buildChapterOutlinesPrompt`）走这套，stages 挂在这里。
   - 当前 `App.tsx` **没有**加载 `volume_outlines`；普通对话和写正文的上下文 source 只有 `outlineNodes / characters / worldEntries / obsidianDocuments / storyFacts / characterKnowledge`，不含 stages。

3. **拆章已能接触 stages 但被 strip 掉了**：`src/renderer/services/ai-prompts/planning.ts` 的 `buildChapterOutlinesPrompt` 第 183—184 行：
   ```ts
   const volumeForPrompt = (({ stages, ...rest }: VolumeOutline) => rest)(volume);
   const volumesForPrompt = volumes.map(({ stages, ...rest }: VolumeOutline) => rest);
   ```
   这是 stage 落库轮「stages 不进 AI 上下文」刻意做的 strip。本轮要反转，改为分级有界注入。

4. **拆章 prompt 的既有体量**（决定 R1 分级的关键证据）：同一个 user prompt 已经包含 `JSON.stringify(volumesForPrompt, null, 2)`（**全部** 2—10 卷的完整字段，含各卷 `keyEvents` 数组）+ 当前卷再来一份完整 JSON + 全书总纲完整 JSON + 全部命中 Skill 的**全文**。新增量的**上界**可算死：按 R1 截断参数，单卷最坏 = 阶段数 ×（goal 120 + exit 120 + endingHook 80 + keyProgressions 8×60）≈ 阶段数 × 800 字；真实数据卷 1 有 5 个阶段，即最坏约 4000 字（`brief` 相邻卷每阶段 ≤ 260 字）。相对上述基数属可接受增量。**「keyProgressions 会撑爆 token」在拆章这个场景不成立**，该顾虑只对写正文/普通对话有效。

5. **写正文已经间接拿到 stage 塑形后的结果**：`App.tsx` 的 `handleStartPlannedChapter(outline, 'ai')`（约 519 行）把整份 `ChapterOutline`（视角/本章任务/开场处境/核心冲突/关键节拍/信息揭示/人物变化/情绪体验/爽点/章末钩子）序列化成 marker 写进 `outline_nodes.summary`；`AIWritePanel.getContext`（约 393 行）的 `outlineSummary` 读的正是该 summary。拆章一旦吃到 stages，章纲即已吸收阶段边界，写正文拿到的是**章级**粒度的下游产物。再注入**阶段级**的粗粒度摘要是重复且更旧的信息。

6. **普通对话已有一份结构大纲**：`ContextBuilder.build` 第 4 块「关联大纲节点」（`outlineNodes`，priority 8）。再加 planning 侧的 stages 块，等于同时给 AI 两份可能互相矛盾的结构大纲（`outline_nodes` 手编、stages 来自 Obsidian 导入，且重新生成分卷纲会清掉 stages）。

7. **重新生成分卷纲会清空 stages**：`parseVolumeOutlines` 产出对象无 stages，策划页「重新生成」整表替换。当前仅在 `PlanningWorkspace.tsx` 约 455 行有一行黄字提示。本轮把 stages 接入 AI 后，此坑的后果从「策划页少看几行」升级为「AI 上下文静默降级」，见「遗留风险」。

## 范围

**生产代码白名单（可少，不可多出这两处之外的生产文件）**：

- `src/renderer/services/ai-prompts/planning.ts`（R1 + R2）。`formatStagesContext` **优先放进此文件**，不必另开模块。
- `src/renderer/components/PlanningWorkspace.tsx`（R6）。

测试文件另计。禁止改 `App.tsx` / `ContextBuilder` / `AIWritePanel`。若实施者坚持把纯函数拆到 `src/renderer/services/ai-prompts/` 下的新文件，也允许，但不是硬性要求。

本轮包含：

- **拆章**（R1 + R2）：`buildChapterOutlinesPrompt` 把当前卷 + 相邻卷的 stages 以分级有界形式注入（反转上一轮 strip）。这是本轮唯一的 AI 上下文改动。
- 分级有界形式：当前卷「完整形」（含 `keyProgressions` 与非空 `endingHook`），相邻卷「精简形」（见 R1）。
- **改总纲清空分卷纲/阶段的就地提示**（见 R6，零算法、零对齐）：`updateOutlineField` / `updatePhase` 两处清空时置一个**独立** notice state，并在**总纲区内**就地渲染。当前这两处是**静默**清空，而组件唯一的 `error` 渲染点在页首第一步卡片里，总纲区看不到。
- 对应纯函数与 prompt 组装单测 + 真实 DOM 断言。

本轮不包含：

- **写正文注入**（原 R3）：语义重复，见「不采纳的替代」。
- **普通对话注入**（原 R4）：双份真相风险，见「不采纳的替代」。
- **`App.tsx` 加载 `volume_outlines`**（原 R5）：上述两条不做，本轮无需该桥接，不动 `App.tsx`。
- 注入 `characters / worldRefs`：剥了 wiki 链接的名字列表，人物与世界观各自已有上下文通道，重复且信息密度低。
- 修改 stages 落库结构或 `VolumeStage` 类型。
- 新增数据库迁移。
- 把 stages 写进 `outline_nodes` 树（见「不采纳的替代」）。
- **重新生成分卷纲按标题/章范围保留 stages**：仍是独立 P2，本轮不做（理由见「遗留风险」）。
- 真实 vault 烟测。

## 功能要求

### R1 分级有界形式

定义：

```ts
/** 每项必须携带该卷在全书分卷列表中的绝对下标，函数内不得用数组位置推断卷号 */
export interface StageContextEntry { index: number; volume: VolumeOutline }

export function formatStagesContext(
  entries: StageContextEntry[],
  mode: 'full' | 'brief',
): string | null
```

**为什么不是 `(volumes: VolumeOutline[], mode)`**：R2 要求当前卷走 `'full'`、相邻卷走 `'brief'`，实现时必然传切片（如 `[volumes[volumeIndex]]`）。若卷号取自入参数组下标，第 3 卷会被标成「第 1 卷」，而这段错误文本会直接进 prompt，把作者手写的阶段挂到错误的卷上——正是本轮最该避免的失败模式。故卷号必须由调用方以绝对下标显式传入，标题行一律渲染 `第 ${entry.index + 1} 卷`。

**`mode: 'full'`（当前卷）** —— 阶段是作者手写的施工依据，要能约束 AI 拆出的 `keyBeats`：

```
## 卷内阶段
第3卷「卷名」：
### 阶段1 标题（第 1-15 章）
目标：…
关键推进：条目1 / 条目2 / 条目3
出口：…
卷末钩子：…
```

（示例刻意用「第3卷」：卷号来自 `entry.index`，不是入参数组位置。）

**`mode: 'brief'`（相邻卷）** —— 只需要边界感，不需要细节：

```
## 相邻卷阶段
第4卷「卷名」：
- 阶段1 标题（第 16-30 章）：目标 → 出口
```

共同约束：

- 卷号一律取 `entry.index + 1`，不得用入参数组位置。
- 两种模式都只取 `title / chapterRange / goal / keyProgressions / exit / endingHook` 的子集，**永不取** `characters / worldRefs`。
- `brief` 只取 `title / chapterRange / goal / exit`，**不取** `keyProgressions / endingHook`。相邻卷不给 `endingHook` 不构成信息缺口：上一卷如何收尾，卷 JSON 的 `endingState` / `promisesPaid` 已全量携带（证据 4）。
- `endingHook` 缺省即 `''`（`parseStage` 保证），**为空则整行省略**，不输出空标签。真实数据中通常只有每卷最后一个阶段有值，成本接近零。
- 空字段跳过对应位置（无 goal 则只写标题行；`brief` 无 exit 则省略 `→`）。
- 逐项跳过 `stages` 缺省/为空的卷；**所有** entries 都无阶段（含 `entries` 本身为空数组）→ 返回 `null`，不输出空块、不输出只有标题的块。
- 有界：`goal` / `exit` 各 `slice(0, 120)`；`keyProgressions` 每条 `slice(0, 60)`、最多取前 8 条（超出追加 `…`）；`endingHook` `slice(0, 80)`。

### R2 拆章注入（`buildChapterOutlinesPrompt`）

- 删除第 183—184 行的 strip，改为：`volumeForPrompt` / `volumesForPrompt` 仍剥掉 `stages`（避免整份 JSON 重复输出阶段），另起独立块由 `formatStagesContext` 产出。
- 注入范围与模式：当前卷 `{ index: volumeIndex, volume: volumes[volumeIndex] }` 走 `'full'`；相邻卷（`volumeIndex - 1` / `volumeIndex + 1`，各自存在才加，且必须带**自己的**绝对下标）走 `'brief'`。
- **当前卷无 stages ⇒ 整个阶段区段都不注入**，即使相邻卷有。理由：本次只拆当前卷，一个孤立的「相邻卷阶段」块对当前卷的拆分没有指导价值，却占 token 且可能诱导 AI 按邻卷节奏拆当前卷。判定顺序固定为「先算 `'full'` 块，为 `null` 则整段跳过，不再计算 `'brief'`」。
- 位置：插在「# 本次只拆第 N 卷」之后、「# 作者要求」之前，标注「以下为作者手写的卷内阶段，是本卷的施工依据；关键节拍必须与阶段的关键推进一致，不得另起炉灶」。
- `parseVolumeOutlines` 产出对象无 stages，天然为空 → `formatStagesContext` 返回 `null`，AI 生成的卷不注入（行为与现状一致，回归不破）。

### R6 改总纲清空阶段的就地提示（零算法、零对齐）

**不得复用 `setError`。** 组件里 `error` 只有一处渲染，在页首第一步「你的故事想法」卡片内（约 L377），而整页是单个 `overflow-y-auto` 长滚动容器，总纲区在其下方、分卷区更下方。作者在总纲 textarea 打字时，`setError` 的内容会出现在视口之上，**和它要替代的那行分卷区黄字一样看不见**。此外 `error` 是红色 ⚠️ 的错误通道，承载信息性通知会与真实错误互相覆盖（每个 `generate*` 开头都 `setError('')`）。

落地方式：

- 新增独立 state `const [stageClearedNotice, setStageClearedNotice] = useState(false)`。
- `updateOutlineField`（约 L225）与 `updatePhase`（约 L233）两处，在现有清空分支内置位。**必须保留章纲清空两行**，不得用下面片段整段替换导致章纲残留：
  ```ts
  const hadStages = volumeOutlines.some(v => (v.stages ?? []).length > 0);
  if (volumeOutlines.length) {
    if (hadStages) setStageClearedNotice(true);
    setVolumeOutlines([]); setVolumeStatus('empty');
  }
  if (chapterOutlines.length) {
    setChapterOutlines([]); setChapterOutlineStatus('empty');
  }
  ```
- **在总纲区（`showMaster` 块）内**就地渲染，与「总纲尚未锁定」那行状态提示同区。文案必须同时满足：
  - **完成时**（`setStageClearedNotice` 与 `setVolumeOutlines([])` 在同一个同步函数里，作者读到时编辑区已经空了）。
  - **区分本地清空与写库**：这两处函数**不调用 `save()`**，SQLite 里的 stages 还在；只有作者随后点「保存修改 / 锁定总纲」才会把空分卷写入数据库。
  - **不得**写成「将被清空」；**不得**暗示「先重新导入再改总纲」（死循环）；**不得**把「尚未写库的本地清空」说成必须重新导入。

  推荐原文：
  > 分卷纲与已导入的卷内阶段已从当前编辑区清空（尚未写入数据库）。保存总纲会把清空写入数据库；如需恢复，请重新加载本项目，或重新从 Obsidian 导入。
- 清除时机：`loadPlanning` 成功、切换项目（`useEffect([project?.id])` 重置分支）、`generateVolumes` 成功时置 `false`。产品代码仍应在 `generateVolumes` 成功时清除；**自动化测试不得依赖这条路径**（该函数会打真实 AI，本套件无 mock，见 8.3）。
- 只加 state + 渲染，**不碰** `saveVolumes`、不做 stages 合并、不改对齐逻辑、不改清空行为本身。
- `generateVolumes`（重新生成分卷纲）已有一行黄字提示（约 L455），本轮不改该处；本提示补的是「改总纲」这条之前完全无提示的静默清空路径。
- `updateVolume`（编辑分卷字段，约 L274）用 `{ ...volume, [field]: value }` spread，**不会**丢 stages，本轮不改、不提示。

## 测试矩阵（实施轮 TDD）

### 8.1 分级有界形式（纯函数）

1. **卷号必须取自 `entry.index`，不得取自数组位置**：传 `[{ index: 2, volume }]` → 输出「第3卷」而非「第1卷」；`brief` 传 `[{ index: 3, volume }]` → 输出「第4卷」。两种模式都要测。这是防止阶段被挂到错误卷的核心断言。
2. `mode: 'full'` 多卷带 stages → 每阶段输出标题/章范围/目标/关键推进/出口。
3. `mode: 'brief'` → 每阶段一行，**不含** keyProgressions 与 endingHook（断言输出不含对应内容）。
4. `endingHook` 为 `''` → `full` 模式下整行省略，不出现空标签。
5. `endingHook` 非空 → `full` 模式下输出。
6. goal 或 exit 为空 → 对应位置省略，不出现多余 `→` 或空冒号。
7. **全部** entries 的 `stages` 都空/缺省，以及 `entries` 为 `[]` → 返回 `null`（两种模式都是）。
8. **部分有、部分无**：`[{index:0, 有阶段}, {index:1, stages 缺省}, {index:2, stages: []}]` → 只输出第 1 卷的块，**不为第 2/3 卷留下只有卷标题的空行**。（R1「逐项跳过」规则的关键分支）
9. 截断：`goal`/`exit` 超 120 字、`keyProgressions` 单条超 60 字、条数超 8 → 按 R1 截断。
10. **不泄漏** `characters / worldRefs`（两种模式都断言输出文本不含这些内容）。

### 8.2 拆章

1. `buildChapterOutlinesPrompt` 输入带 stages 的 volumes → user prompt 含当前卷「卷内阶段」完整形块（含关键推进）与相邻卷精简形块。
2. 当前卷带 stages、相邻卷无 stages → 只有完整形块，无「相邻卷阶段」块。
3. **当前卷无 stages、相邻卷有 stages → 整个阶段区段都不出现**，连「相邻卷阶段」块也没有。
4. `volumeIndex` 为首卷 / 末卷 → 相邻卷只取存在的一侧，不越界。
5. **卷号端到端保真**：fixture 至少 4 卷，拆第 3 卷（`volumeIndex = 2`）→ prompt 中完整形块标「第3卷」、相邻形块标「第2卷」「第4卷」。
6. 输入不带 stages（`parseVolumeOutlines` 产物）→ 不含任何阶段块（回归不破）。
7. `volumesForPrompt` / `volumeForPrompt` 的 JSON 中仍无 `stages` 键（不重复输出）。

### 8.3 改总纲清空阶段的就地提示

**测试设施**：`updateOutlineField` / `updatePhase` 是组件内部闭包、不导出，vitest 纯函数测不到。本组挂在**真实 DOM 回归** `tests/ui/obsidian-import.tsx`，经 `node tests/ui/run-obsidian-import.cjs` 执行。必须用 **`mountPlanning()`**（场景 M 已有），**不得**接在场景 N 后面——场景 N 挂的是 `ObsidianImportPanel`，`onImported` 为空，屏幕上没有策划页，也没有总纲 textarea。

**不得照搬现成 `stage` fixture 直接挂策划页**：`tests/ui/obsidian-import-test-db.cjs` 的 `stage` 种子总纲是 `{"premise":"旧前提"}`，没有 `phases`。`PlanningWorkspace` 会在 `masterOutline.phases.map` 炸掉。场景 N 能过，正是因为它从不渲染策划页。实施轮二选一：

- 给 `stage` 种子补上可渲染的 `phases: []` 及其余总纲必填字段；或
- 新增仅供本组使用的 fixture（完整 `phases` + 至少一卷带 stages）。

**触发方式**：套件已有 `setNativeValue` + `fireInput`。textarea 的 React `onChange` 听的是 `input`。**禁止**对总纲 textarea 只发 `fireChange`（那是给 `<select>` 的，`updateOutlineField` 很可能不会跑）。`HTMLTextAreaElement` 的 value setter 也要走 textarea 原型，不能复用目前只覆盖 `input/select` 的 `setNativeValue`。

**禁止测 `generateVolumes` 成功。** 改总纲会把 `outlineStatus` 打回 `generated`，同时把分卷/章纲本地清空，`showVolumes` 变 false，分卷区（含「生成分卷纲」）从 DOM 消失；该按钮还要求总纲已锁定；函数本身会打真实 AI，本套件无 mock。提示消失改测 `loadPlanning`：重挂 `PlanningWorkspace` 即可，因为改总纲并不写库，重载会把 stages 从 SQLite 读回来。

1. 策划页已加载带 stages 的分卷时，对总纲字段 `fireInput` → **总纲区内**出现完成时提示，文案含「当前编辑区清空」与「尚未写入数据库」（不得再断言「必须重新导入」这一句作为唯一恢复路径）。
2. **提示位置**：断言总纲区容器的 `textContent` 含提示文案；页首第一步「你的故事想法」卡片的 `textContent` **不含**该文案。不要用「页面上没有 ⚠️」——页首若已有真实错误会被误伤；`error` 是内部 state，不要写白盒断言。
3. 策划页已加载**不含** stages 的分卷时改总纲字段 → 无提示（回归不破）。
4. `updateVolume` 编辑分卷字段 → stages 保留、无提示（spread 保真）。须在改总纲之前测，因为改总纲后分卷区会从 DOM 消失。
5. 提示出现后**不点保存**，重挂 `mountPlanning()`（触发 `loadPlanning`）→ 分卷 stages 从数据库回来，提示消失。

### 8.4 回归

**基线已实测（2026-09-11，基线提交 `eb2eab6`）**：42 个测试文件 / **273 单测全过**。测量命令（Windows 下须用 Electron 的 Node 以避开 better-sqlite3 的 ABI 不匹配，直接 `npx vitest run` 会有 99 个 `ERR_DLOPEN_FAILED` 假失败）：

```powershell
$env:ELECTRON_RUN_AS_NODE=1
& node_modules/electron/dist/electron.exe node_modules/vitest/vitest.mjs run
```

1. 273 单测不破；本轮新增 8.1 / 8.2 用例后总数上升，报告须写明新总数。
2. `node tests/ui/run-obsidian-import.cjs`：基线 **102/102**。注意该套件**按 `check()` 调用计数**，不是按场景计数——现有 102 个 check 分布在 15 个场景（A—O），所以 8.3 的 5 条**场景级**要求会产出多于 5 个 check。**不要预设目标数字**；验收口径是「新总数 > 102、全部通过、且 8.3 的 5 条各自有对应 check」，实测数填入报告，不得沿用 102。
3. `App.tsx`、`ContextBuilder`、`AIWritePanel` 无改动；生产代码只出现在白名单内的 `planning.ts` 与 `PlanningWorkspace.tsx`（若拆了纯函数文件则再加那一个）。用 git diff 自证。

## 建议实施顺序

1. 提交本 Spec（含复审收敛）。
2. 8.1 失败测试 → `formatStagesContext` → 通过。
3. 8.2 失败测试 → 拆章注入 → 通过。
4. 8.3 失败断言（`mountPlanning` + 可渲染总纲 fixture + `fireInput`；提示消失走 `loadPlanning` 重挂）→ R6 独立 notice state + 总纲区就地渲染 → 通过。
5. 全量单测（Electron-as-Node）+ `npm run build:main` + `npx vite build` + `node tests/ui/run-obsidian-import.cjs`。
6. 更新 `AGENTS.md` / `CLAUDE.md` 与开发报告。

每个步骤独立提交。

## 完成标准

- [ ] `formatStagesContext` 按 `StageContextEntry.index` 渲染绝对卷号，切片传入也不错位；分级有界输出；`full` 含 keyProgressions 与非空 endingHook，`brief` 不含；两者都不泄漏 characters/worldRefs；有单测。
- [ ] 拆章当前卷注入完整形、相邻卷注入精简形；首末卷不越界；卷号端到端保真；**当前卷无 stages 时整段不注入**；AI 生成的卷（无 stages）不注入，回归不破。
- [ ] 阶段内容不在卷 JSON 中重复出现。
- [ ] 改总纲字段（`updateOutlineField` / `updatePhase`）带 stages 时在**总纲区内**就地显示**完成时**提示，文案区分本地清空与写库，未复用 `error` 通道；不带 stages 时无提示；`updateVolume` 编辑分卷不掉 stages；不点保存即重载后 stages 回来、提示消失。
- [ ] 无迁移、不改 stages 落库结构、不写 outline_nodes；生产代码仅 `planning.ts`（± 可选纯函数文件）+ `PlanningWorkspace.tsx`，**不动 `App.tsx` / `ContextBuilder` / `AIWritePanel`**。
- [ ] 回归不破：单测 ≥ 273 全过（Electron-as-Node 跑法）；`run-obsidian-import.cjs` 新总数 > 102 且全过，8.3 五条各有对应 check。

## 报告模板

实施轮开发报告至少写明：

1. 基线与最新提交。
2. R1 / R2 / R6 各对应代码文件、测试名称与结果。
3. 自动测试文件数、测试数与命令退出码；单测须用 Electron-as-Node 跑法（见 8.4），并同时给出 `run-obsidian-import.cjs` 的**实测** N/N（基线 102，新数实测填写、不得预设也不得沿用旧数字）。
4. 是否新增迁移（应写「否」）；是否改动 stages 落库（应写「否」）；是否改动 `App.tsx`（应写「否」）。
5. 如实说明：本轮 **AI 上下文只覆盖拆章**；写正文与普通对话**明确不做**（不是「未完成」，是「不采纳」）；R6 是策划页提示，不是第三处 AI 注入。阶段字段中 `characters / worldRefs` 不进任何上下文。
6. 如实说明「重新生成分卷纲会清空 stages」的处置：本轮选了「明确不做 + 记风险」，并补了「改总纲清空阶段」的提示；`重新生成保留 stages` 仍是独立 P2。

---

## 不采纳的替代

- **写正文注入 stages**：拆章产出的 `ChapterOutline` 已吸收阶段边界，并经 `handleStartPlannedChapter` 的 marker 写进 `outline_nodes.summary`，由 `AIWritePanel` 的 `outlineSummary` 读取（证据 5）。再注入阶段级摘要，粒度更粗、信息更旧，是加噪不是降噪。唯一真正缺失的路径是「作者不走拆章、自己在 outline_nodes 建节点写正文」，但那属于两套大纲体系的历史债，不该用 stages 去补；要做应另立「策划层 → 写作层桥接」需求。
- **普通对话注入 stages**：问题不是 token 而是**双份真相**。`ContextBuilder` 已有 priority 8 的 `outlineNodes` 大纲块，再塞一份可能矛盾的 planning 侧阶段块，比只给一份更糟（证据 6）。普通对话是发散场景，本就不依赖精确阶段边界。
- **对所有场景一刀切「不含 keyProgressions」**（原 Spec R1 定法）：`keyProgressions` 是作者手写的、该章范围内要发生什么的清单，而拆章要产出的 `keyBeats` 本质就是它的细化。strip 掉等于让 AI 在作者已写明节拍的区间里重新发明节拍，产出与手稿冲突的章纲——本功能最核心的收益就没了。token 顾虑在拆章不成立（证据 4）。故改为分级：拆章当前卷取，其余一律不取。
- **把 stages 写进 `outline_nodes` 树**（像 `handleStartPlannedChapter` 那样用 marker）：outline_nodes 是旧大纲树，语义与 `planning_ideas` 分属两套，塞进去会污染旧树，且 stages 有独立落库位置，双向冗余易漂移。改为在上下文层注入，不改存储。
- **整份 VolumeOutline 注入**：`characters / worldRefs` 是名字列表，重复且低密度；无边界注入违背「有界」目标。
- **新增独立 stages 上下文表**：stages 已随 volume_outlines JSON 落库，再建表冗余。

## 复审结论（原「待独立复审确认」三问的答复）

1. **范围**：AI 上下文**只做拆章**。写正文与普通对话不是「以后再做」，是按上述理由**不采纳**；若将来要做，须以新需求形式重新论证，不得引用本 Spec 作为既定计划。R6 是策划页就地提示，不是第四个 AI 场景。
2. **`endingHook`**：**含**，但仅在 `full` 模式且非空时输出。理由：缺省即 `''`、真实数据中只有每卷末阶段有值，成本≈0；且同一 prompt 的卷 JSON 已全量携带 `climax / endingState / promisesPaid`，单独排除卷末钩子没有一致的理由。
3. **普通对话**：**不引入**。

## 遗留风险（本轮已定处置）

1. **重新生成分卷纲会清空 stages**（证据 7）。本轮**定案选 (b)：明确不做 + 记风险**，不做「按标题/章范围保留 stages」的模糊匹配。理由：
   - stages 真相源在 Obsidian，清空是**缓存失效**而非数据丢失，重新导入即恢复；(a) 是为「能一键恢复的状态」建模糊匹配，性价比不对。
   - (a) 的失败模式（错配 → 阶段挂错卷 → 静默污染本轮新建的拆章 prompt）比清空（显性、`formatStagesContext` 返回 null 不注入）更糟。
   - 时序闸门：`generateChapters` 要求 `volumeStatus === 'locked'`，重新生成后状态回 `generated`，作者不可能「重生成完立刻拆章」，中间必须重锁，阶段空掉在人工步骤可见。
   - **本轮补的口子**：`updateOutlineField` / `updatePhase`（改总纲任一字段）此前是**静默**清空且作者在总纲区看不到分卷区黄字，本轮加**独立 notice state + 总纲区就地渲染**（R6，**不是** `setError`，原因见 R6 与本节第 4 条）。这比 (a) 便宜得多，且覆盖了真正的无声坑。
   - `重新生成保留 stages` 仍作为独立 P2 另立；届时须用「标题 + 章范围」匹配而非 volumeIndex 对齐，且需重新论证。

2. **真实 vault 未复跑**：真实数据仅卷 1 有 5 个阶段文件，卷 2/3 stages 为空。本轮不做真实 vault 烟测，fixture 须覆盖「当前卷有阶段、相邻卷无阶段」（8.2.2）与「当前卷无阶段、相邻卷有阶段」（8.2.3）两种真实形态。

3. **改总纲一次按键即清空整份分卷纲与章纲**（不只是 stages）：`updateOutlineField` / `updatePhase` 在 textarea 的 `onChange` 里无条件执行 `setVolumeOutlines([])` 与 `setChapterOutlines([])`，**且不调用 `save()`**。这是既有行为，本轮**不改**。R6 只补可见提示，并必须写明「尚未写库」。若认为该行为过于激进（例如应改成确认对话框或按 dirty 标记延迟失效），属独立需求，须另立。

4. **`error` 通道设计缺陷**：`PlanningWorkspace` 的 `error` 只有页首一处渲染（约 L377），下方各步骤的错误都要滚回顶部才看得到。R6 通过不复用该通道绕开了问题，但通道本身的缺陷仍在，属独立 P2。
