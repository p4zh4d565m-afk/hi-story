# P0 Provider / Planning / Preview 完成声明复核

日期：2026-09-13  
审查范围：`81856da..db755a2`  
执行 worktree：`C:\Users\Ariel\ccx-wt\codex-p0-provider-planning-preview`

## 结论

开发者对提交链、worktree 隔离、自动化测试和构建结果的主要陈述属实，但“整分支最终门已过”不成立，当前也不应合并。

原因有三项：策划成功回执仍缺少 current-token 判断，强制的片间审查没有完整证据，分支还混入了目标 checkout 中尚未提交的 Obsidian 分隔条功能。截图提出的“先派 fresh reviewer”是可执行且必要的下一步；“随后合并”目前不可执行，必须先修复并复审，再处理目标 checkout 的未提交文件。此次复核未派 reviewer、未合并、未 push。

## 已核实为真的内容

| 声明 | 独立复核结果 |
|---|---|
| 四个提交形成线性链 | 属实：`81856da → 87f8040 → eb835ab → 719a8b4 → db755a2` |
| 独立 worktree | 属实；分支为 `codex/p0-provider-planning-preview` |
| worktree 干净 | 属实；`git status --short --branch` 只有分支名 |
| 未合并到 `D:\ccx` | 属实；主 checkout 仍停在 `81856da` |
| 未 push | 远端只读查询未发现 `refs/heads/codex/p0-provider-planning-preview` |
| 全量测试 | 复跑通过：63 files，412/412 tests |
| 主进程 / Renderer 构建 | 复跑均通过；Renderer 只有大 chunk 警告 |
| Obsidian 导入 UI | 复跑通过：119/119 |
| 写作 UI / 决策 UI | 复跑通过：12/12、16/16 |
| `git diff --check` | `81856da..db755a2` 无错误 |
| Provider / Preview 主体改动 | 请求级配置快照、必填 projectId、文本节点预览及 HTML 原文保存均已接线 |

## 必须修正的问题

### 1. [Important] 迟到的成功回执仍会回退 committed 快照

位置：`src/renderer/components/PlanningWorkspace.tsx:169-176`、`:196-202`

`persistPlanning` 返回 `saved` 后，普通保存和 AI 后台写回都直接调用 `applyPlanningSnapshot` / `onPlanningCommitted`，没有先检查：

```ts
isPlanningWriteCurrent(projectId, outcome.token)
```

现有测试 `tests/unit/planning-persistence.test.ts:70-83` 已证明：写入发出后若出现更新，旧回执仍是 `saved`，但 token 已不是 current；测试注释也写明“调用方据此不更新 UI”。组件没有兑现这条约束。

可复现时序：旧 AI 完成并 reserve → save IPC 在途 → 用户保存并 reserve 新 token → 旧 AI 回执迟到 → 当前代码把旧结果重新写进策划页和 App committed。数据库最终值与界面快照也可能暂时不一致。

修订要求：两个 `saved` 分支都必须同时满足“项目仍当前 + token 仍 current”才允许更新本地/App；补组件级受控 Promise 回归，不能只测试 helper。

### 2. [Important / Process] 片间双重审查未完整执行或未留证

计划要求每片提交后由 fresh reviewer 同时做“规格符合性 + 代码质量”审查。SDD 目录目前只有：

- `task-1-report.md`
- `task-1-review-package.diff.txt`
- `progress.md`（只记录 Task 1 完成）

没有 Task 2、Task 3 的 brief/report/review package，也没有两片的审查结论。因此不能说已按选择的 Subagent-Driven 流程完成“片间审查”。截图也承认整分支 fresh final review 尚未执行。

修订要求：先修第 1 项，再补 Task 2/3 审查证据，最后才做 `81856da..HEAD` 的 fresh final review。可以合并为一次补充审查，但报告必须覆盖规格与代码质量两种结论。

### 3. [Important / Integration] 分支不是纯 P0 三片，合并目标当前会被未提交文件阻挡

提交 `719a8b4` 包含 Obsidian 导入弹窗纵向分隔功能：4 files，`+271/-162`。其中三个文件与 `D:\ccx` 当前未提交/未跟踪版本哈希一致，`ObsidianImportPanel.tsx` 则是在该功能之上又叠加 P0 reserve 接线。

这说明该提交是在吸收目标 checkout 的用户工作，不只是 P0 冲突修复。直接 merge 会遇到目标 checkout 的同路径未提交改动保护，并且会把计划外功能一起纳入分支历史。

修订要求：在任何合并前，先独立保存并确认 `D:\ccx` 的 Obsidian 分隔条改动；随后将 P0 重放/变基到其正式提交之上，或明确批准四提交整体进入。完成集成后必须在集成态重跑全部最终门。

### 4. [Minor] “三条 rg 全无匹配”这一门实际失败

复跑结果：

- `aiService\.configure`：无匹配；
- `invalidateCache`（renderer）：无匹配；
- `dangerouslySetInnerHTML`：命中 `src/renderer/services/ai/generated-preview.ts:5` 的注释。

代码没有使用危险渲染 API，但截图中“三条全无匹配”的字面声明不实，也不符合计划要求退出码必须为 1。应改写注释避开该标识，或把门禁改成只匹配真实 JSX 属性并同步修订计划。

### 5. [Minor] 文档与类型约束未完全按计划收口

- 分支没有更新 `AGENTS.md`，当前项目文档仍写“计划已批准、未施工”，与事实冲突。
- 计划要求新增 `planningLoadError` 并在成功时清除；当前 App 只 `console.error`，没有该状态。
- 计划要求 `onPlanningCommitStarted` 为必填；当前仍是可选 prop 和可选调用，降低了以后新增调用方时的编译期保护。

这些不一定单独阻断运行，但在宣布完成前应修正或由 reviewer 明确接受偏差。

## 下一步是否真的可执行

1. **fresh final reviewer：可以执行，而且必须执行。** worktree 当前干净，base/head 明确，可审查 `81856da..db755a2`。但审查输入必须附上本报告，不能把自动化全绿当作预设“通过”。
2. **合并到 `D:\ccx`：目前不可以执行。** 至少要完成第 1 项修复、审查通过、处理 Obsidian 未提交文件，并确认分支最终范围。
3. **集成后最终门：必须再跑。** worktree 内 412/412 与三个 UI runner 全绿，不能证明它与目标 checkout 现有改动组合后仍全绿。
4. **P1：仍未授权，不应启动。**

## 本次未执行的动作

- 未派任何 reviewer 或实现代理；
- 未修改 P0 实现；
- 未 merge / rebase / cherry-pick；
- 未 push；
- 未执行外部供应商烟测。
