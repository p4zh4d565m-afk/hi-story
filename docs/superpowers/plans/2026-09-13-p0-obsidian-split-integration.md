# P0 + Obsidian 导入分隔 双线整合（2026-09-13 晚 · 三片完成 · 最终门已过）

> **状态（2026-09-14）：** 已随 P0 快进合入 `feature/skill-engine`（`6ff75e1`），未 push。下文是合入前的整合记录。
>
> **给下一位开发者 / 用户：** 两条线在 `ObsidianImportPanel.tsx` 正交合并（布局 + commit 前 reserve）。代码已合入 `feature/skill-engine`。P1 仍未授权，不要 push。
>
> **合同 / 计划 / 审查：**
> - `docs/superpowers/specs/2026-09-13-ai-production-current-contract.md`
> - `docs/superpowers/plans/2026-09-13-p0-provider-planning-preview.md`
> - `docs/superpowers/plans/2026-09-13-p0-provider-planning-preview-review.md`

---

## 0. 一句话状况

P0 三片（Provider / Planning / Preview）**全部提交**；另一位开发者的 Obsidian 导入弹窗纵向分隔**已并入**；两线在 `ObsidianImportPanel.tsx` 的冲突**已手工正交合并**；**整分支最终门已过**。**尚未 push、尚未合回主工作区。** P1 仍未授权。

| 项 | 状态 |
|---|---|
| 分支 | `codex/p0-provider-planning-preview`（worktree `C:\Users\Ariel\ccx-wt\codex-p0-provider-planning-preview`） |
| 起点 / merge-base | `81856da` |
| 提交链 | `87f8040`（Provider）→ `eb835ab`（Planning）→ `719a8b4`（Obsidian 分隔整合）→ `db755a2`（Preview） |
| Push / 合回主工作区 | **否** |
| 最终门 | **已过**（详见第 4 节） |
| 共享 `D:\ccx` | **未改** P0/分隔代码（仍是文档 + 源 checkout 里另一位开发者的未提交草稿） |

---

## 1. 完成内容

### 1.1 线 A —— P0（Provider + Planning 两片）

**Provider 片（`87f8040`，14 文件 +428 −177）：**
- 删除全局 `aiService.configure` 及 7 个调用点；`chat`/`chatStream` 每次收完整 `ProviderConfig` 快照。
- `chatStream` 改为**同步外壳**，调用瞬间拷贝配置再进 generator；`projectId` 必填（trim 后非空）。
- 主进程 `normalizeStreamProjectId` 只登记归一化值；渲染端删 `ChatCallOptions.model`，主进程 `ChatOptions.model` **保留**。
- 写章 `writeModel` / 抽取 `summaryModel` 写入当次 `config.model`。
- 未调 `invalidateCache`，无迁移，未改写章预览 HTML。

**Planning 片（`eb835ab`，9 文件 +426 −117）：**
- `planning-loader`：失败（`success:false`/抛错）只走 `onError` 不再 `onApply(null)` 清空 committed；`data:null` 是合法空策划；新增 `applyCommitted`（`generation+1` 作废在途 load）。
- `planning-write-epoch`（新增）：per-project 内存 epoch，`capture/reserve/isCurrent`，同一同步调用「比较+递增」，失败不回滚 token。
- `planning-persistence`（新增）：`persistPlanning` 在 invoke **前** reserve，三态判别 `saved | superseded | failed`，`superseded` 不发 IPC。
- `PlanningWorkspace`：`save()` 用 save 返回值 `onPlanningCommitted(projectId, res.data)` 立即更新 App committed（非 fire-and-forget reload）；四个长任务启动捕获 `startedEpoch`，AI 返回后带 `expectedEpoch` 条件 persist。
- `App.tsx`：加 `onError`（失败不清快照）、`onPlanningCommitted`/`onReloadPlanningCommitted` 接线。

### 1.2 线 B —— Obsidian 导入弹窗纵向分隔（已并入，`719a8b4`）

- 候选文件 + 文件详情（上）与导入方案（下）之间加可拖动纵向分隔条。
- 复用 `react-resizable-panels` v4（`Group`/`Panel`/`Separator`）；默认 **上 65% / 下 35%**，**不持久化**。
- 扫描中 / 扫描失败不挂 Group，避免空分隔条。
- 「预计 + 确认导入 / 重试刷新」钉在下半底部，方案表单与拦截项在下半滚动。
- 新增纯函数 `obsidian-import-split.ts` + 单测 `obsidian-import-split.test.ts`；UI 测试加 A5b–A5f 五条断言。

### 1.3 整合（冲突解法，`719a8b4`）

`ObsidianImportPanel.tsx` 上两线正交：
- **线 B**：布局重构（`candidatePane` / `planForm` / `planActions` + `Group` 分隔）。
- **线 A**：3 处 commit 逻辑（`onPlanningCommitStarted` prop + 解构 + `touchesPlanning` 判断 + commit 前 `reservePlanningWrite`）。

合并方式：保留线 B 的完整布局，把线 A 的 3 处改动叠加到重构后的 `commit` 函数与 props 上，**未用整文件覆盖**，两边改动都保留。

### 1.4 线 A —— Preview 片（`db755a2`）

- `generated-preview.ts`（新增）：`splitGeneratedPreviewBlocks(html)` 把 `<p>...</p>` 切成文本节点分段，解码 `&lt;/&gt;/&amp;/&quot;/&#39;/&nbsp;`，段内 `<br>` 转换行、其余标签剥掉；流式未闭合尾段立即显示；无 `<p>` 或 p 外的前缀/尾随进 `fallback` 不丢失。
- `AIWritePanel`：`dangerouslySetInnerHTML` 换成 `GeneratedContentPreview`（分段 `<p>` 文本节点，抽不出段整份进 `<pre>`）；保存路径仍存 HTML 原文，不改审稿/润色，不改写章 prompt。

---

## 2. 修改文件（整合后最终清单，均在 worktree）

### 2.1 已提交（Provider `87f8040`）

- 新增：`src/renderer/services/ai/request-config.ts`、`tests/unit/ai-request-config.test.ts`、`src/main/ai/stream-project-id.ts`、`tests/unit/stream-project-id.test.ts`
- 修改：`ai.service.ts`、`src/main/ipc/ai.ipc.ts`、`tests/unit/ai-stream-cancel.test.ts`、7 个面板组件

### 2.2 已提交（Planning `eb835ab`）

- 新增：`src/renderer/services/planning-write-epoch.ts`、`planning-persistence.ts` + 各自测试
- 修改：`planning-loader.ts` + 测试、`PlanningWorkspace.tsx`、`App.tsx`、`ObsidianImportPanel.tsx`（线 A 的 3 处）

### 2.3 已提交（Obsidian 分隔整合 `719a8b4`）

- 新增：`src/renderer/components/obsidian-import-split.ts`、`tests/unit/obsidian-import/obsidian-import-split.test.ts`
- 修改：`src/renderer/components/ObsidianImportPanel.tsx`（线 B 布局 + 线 A commit 逻辑）、`tests/ui/obsidian-import.tsx`（A5b–A5f）

### 2.4 已提交（Preview `db755a2`）

- 新增：`src/renderer/services/ai/generated-preview.ts`、`tests/unit/generated-preview.test.ts`
- 修改：`src/renderer/components/AIWritePanel.tsx`

### 2.5 共享 checkout `D:\ccx`（文档，未跟踪，与代码无关）

合同、短计划、审查、冻结讨论稿、本整合文档。

---

## 3. 遇到问题

### 3.1 线 A（我）

1. **epoch 是模块级单例 Map**：首版硬编码 token 断言在测试间串状态；改用 `vi.resetModules()` + 动态 import 每例隔离。
2. **`planningLoadError` state 死代码**：首版只 set 从不读；删掉，失败语义由「onApply 仅 success 调用 + console.error」承担。
3. **`persistPlanning` 的「写库期间又有更新」**：save 返回 `saved` 但 token 已非 current 时，属「确实写库但结果不再权威」，落在 `saved` 且 token 失效，调用方据 `isPlanningWriteCurrent` 不更新 UI。

### 3.2 线 B（另一位开发者）

1. `Group` 写死 `height:100%`：直接作 `h-[85vh]` 弹窗 flex 子项会按整窗算、和标题栏重叠；外面包 `flex-1 min-h-0`。
2. 拖动几何无 E2E，靠手测；关掉再开回 65/35 是刻意不记住。

### 3.3 整合

- 两线都在 `81856da` 分叉，`ObsidianImportPanel.tsx` 冲突；解法是正交合并（保留布局 + 叠加 commit 逻辑），不是整文件覆盖。

---

## 4. 验证结果（真实验证，最终门已过）

| 项 | 结果 |
|---|---|
| 全量 `npm run test` | **412/412**（基线 373 + Provider 13 + Planning 16 + split 3 + Preview 6 + 净增 1） |
| `build:main` / `build:renderer` | 通过 |
| Obsidian 导入 UI | **119/119**（含线 B 的 A5b–A5f + 线 A 的 commit 前 reserve） |
| 写作工作区 UI | 12/12 |
| 决策账本 UI | 16/16 |
| `rg "aiService\.configure" src` | 无匹配（exit 1） |
| `rg "dangerouslySetInnerHTML=" src` | 无匹配（exit 1） |
| `rg "invalidateCache" src/renderer` | 无匹配（exit 1） |
| `git diff --check 81856da..HEAD` | 无错（exit 0） |

外部供应商烟测未做（需单独授权）。

---

## 5. 明确没做

- 无数据库迁移（库版本仍 v20）；P1 未开；没 push、没合回 `feature/skill-engine`。
- 没改审稿/润色面板的渲染，没改写章 prompt（模型仍输出 HTML，章节仍存 HTML 原文）。

---

## 6. 下一步建议（按顺序）

1. **整分支审查（fresh reviewer）—— 已完成（2026-09-13 晚）**：`81856da..HEAD` 完整 diff 已交 fresh reviewer，四片分别给「规格符合性 + 代码质量」双结论，**全部 Approved，无 Critical、无 Important，可以合并**。结论摘要见下。
2. **遗留待办（Minor，不挡合并，记入后续收口）**：
   - `PROVIDERS` 数组在 6 个面板重复硬编码 + `PlanningWorkspace` 独立 `BASE_URLS`，厂商预设更名需同步 7 处（维护隐患）。
   - `PlanningWorkspace.loadFirstAiConfig` 用 `providerId` 当 `name`（现 `name===id` 不炸，将来 `name≠id` 会串）。
   - `AIChatPanel` 新增配置不持久化 `baseUrl`（custom 供应商隐患）。
   - `generated-preview` 尾段「前缀 + 未闭合 `<p>`」混合时整段 fallback（用户看到字面 `<p>`），属已知取舍，测试已锁定。
   - 拖动几何无 E2E；无故事方向时下半 35% 可能空一截；`candidates`/`plan` 全局 DOM id 隐患。
3. **合并（等人拍板）**：worktree 绿灯 ≠ 可合进脏的 `D:\ccx`。合并前先处理 `feature/skill-engine` 上大量未提交文件，并以 worktree 整合结果为准丢弃 `D:\ccx` 里未提交的分隔草稿。合入后才改 `CLAUDE.md`/`AGENTS.md` 标「已落地」。外部供应商烟测需单独授权。

### 终审结论（fresh reviewer，`81856da..6ff75e1`）

| 片 | 规格符合性 | 代码质量 |
|---|---|---|
| Provider | Approved | Approved with findings（Minor×2） |
| Planning | Approved | Approved |
| Obsidian 分隔 | Approved | Approved |
| Preview | Approved | Approved with findings（Minor×2） |

无 Critical、无 Important。所有 Minor 为维护性/边缘取舍，不阻塞合并。审查为只读，未改文件、未 commit、未 push。

### 不要做

- 不要开工 P1，不要写迁移，不要按冻结讨论稿复活 v21/v22。
- 不要 push。
