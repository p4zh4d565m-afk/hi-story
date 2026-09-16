# 三期实施计划：轻量写章运行记录（chapter-run 三期）

> 依据：`docs/superpowers/specs/2026-09-10-chapter-run-review-ledger-design.md`（v0.3，已批准）。
> 状态：待用户确认后编码。本计划只覆盖**三期**（写章运行记录）。二期（审稿账本）已合入 master（PR #8）。

## 1. 必须先在 Spec 上改一处冲突

Spec 里写「三期 v22」，但 v22 已被「AI 对话清理」占用（`migrations.ts:674`），v23 已被二期占用（审稿账本）。**本计划改用 v24（三期）。** 动手前先改 Spec 正文里的迁移号（第 146 行、第 348-349 行、第 441 行、第 672 行、第 716 行等「v22」表述）。

## 2. 目标（一句话）

让一次 AI 写章成为可追踪、可恢复的正式任务：记录本次输入（大纲/人物/世界观/事实）、保存草稿、中断后恢复、防止重复写入、明确状态（生成中/已出草稿/已保存/失败/已取消）。

## 3. 现状依据（已核对代码）

- **单章生成**：`AIWritePanel.handleGenerate`（约 630-710 行）——组 prompt（创作罗盘/风格指纹/as-of）→ `aiService.chatStream` 流式到面板 state → 用户点「保存」→ `onSaveAsChapter`（App 调 `db:chapter:create`）。
- **草稿**：只存在于 `generatedContent` 组件 state，**关闭面板/重启即丢**。
- **保存**：`App.tsx` 的 `onSaveAsChapter`（约 1390-1406 行）——`db:chapter:create` 同步返回章节 id，带 `planningOutline` 施工卡。
- **抽取**：`generateAndSaveSummary`（约 739-779 行）在保存后异步跑，走 `aiService.chat` + `onPersistExtraction`，失败只 console.warn，**无重试入口**。
- **批量写章**：`runBatch`（约 490-620 行）逐章流式 + 保存，用 `batchProgress` 持久化到 localStorage 断点续写，**不经过任何 run 记录**。
- **取消**：一期已接 stream-registry + `ai:cancelStream`；但**无运行身份**（runId），取消无法绑定到具体 run。
- **迁移**：当前最高 v23，下一号 v24。

## 4. 数据模型（迁移 v24，只加一张表）

### `chapter_runs`（Spec DDL，第 441-474 行）

```sql
CREATE TABLE chapter_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  retry_of_run_id TEXT,
  source_outline_node_id TEXT,
  target_chapter_id TEXT,
  requested_title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('running','drafted','committed','failed','cancelled')),
  cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK(cancel_requested IN (0,1)),
  provider_name TEXT NOT NULL DEFAULT '',
  model_name TEXT NOT NULL DEFAULT '',
  input_summary TEXT NOT NULL DEFAULT '',
  draft_content TEXT,
  extract_status TEXT NOT NULL DEFAULT 'pending' CHECK(extract_status IN ('pending','running','completed','failed','skipped')),
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (retry_of_run_id) REFERENCES chapter_runs(id) ON DELETE SET NULL,
  FOREIGN KEY (target_chapter_id) REFERENCES chapters(id) ON DELETE SET NULL
);
CREATE INDEX idx_chapter_runs_project_updated ON chapter_runs(project_id, updated_at DESC);
```

约束：
- `source_outline_node_id` 只存标识，不建外键。
- `input_summary` 禁止 API Key、Authorization、完整 messages。
- `extract_status = skipped` 不是保存正文的前提。

DDL 与 `_migrations` 登记在同一事务，`version: 24`。

## 5. `input_summary` 记什么（定死）

**文本摘要，不含敏感信息**。由渲染端在 `start` 前组装，形如：

```
标题：第3章 入局
大纲：<outline_title 或章纲 chapterGoal 摘要>
人物：林岚、站长、神秘人
世界观：<命中世界观的名称列表，最多 5 条>
叙事事实：<as-of 文本的前 N 字摘要，或「条数 + 首条」>
模型：<provider_name>/<model_name>（主进程侧补，不入渲染端 input_summary）
```

禁止写入：API Key、完整 messages、完整 as-of 文本（只存摘要或条数）。

## 6. 混合契约（与二期同型）

| 侧 | 职责 |
|---|---|
| **渲染端** | ① as-of fail-closed（复用现有 `loadNarrativeAsOfForWrite`）；② 组装 messages + `input_summary`；③ 请求级完整 Provider 快照；④ 调 `workflow:chapterRun:start`，传入 projectId、requestedTitle、messages、Provider 快照、inputSummary、sourceOutlineNodeId（可选） |
| **主进程** | ① 创建 `chapter_runs`（`running`）；② 登记 stream-registry（带 runId）+ 发 `started`；③ `provider.chat` 拿全文本；④ 空草稿 → `failed`（EMPTY_DRAFT）；否则写 `draft_content` → `drafted`；⑤ 取消 → `cancelled`；请求失败 → `failed` |

**关键决策（需用户确认）：** 单章写章从「面板流式 + 手动保存」改为「start → drafted → 用户点保存 → committed」，草稿落库可重启恢复。逐字流式进度降级为可选（同二期），本批用 `provider.chat` 一次性拿全文本。

## 7. 状态机与 run 返回契约

状态：`running → drafted → committed`；`failed`（进程中断/空草稿/请求失败，可重试）；`cancelled`（用户取消，不可逆为 running）。

`start` 返回：

```ts
IpcResult<{
  runId: string;
  executionStatus: 'drafted' | 'cancelled' | 'failed';
  draftContent: string | null;
}>
```

- `drafted`：流正常结束且草稿非空，runId + draftContent 均有效
- `cancelled`：用户取消
- `failed`：空草稿或请求失败

## 8. 保存（commit）契约

`workflow:chapterRun:commit`：

1. 校验 run 属于当前项目，状态为 `drafted`；
2. 调用 `ChapterRepo.create`（复用 A1 同步链路，带 planningOutline 施工卡）；
3. run 标 `committed`，`target_chapter_id` 写章节 id；
4. 按 `shouldBumpContentGeneration` 决定是否递增世代（与二期一致）；
5. **幂等**：重复 commit 返回原章节 id（`RUN_ALREADY_COMMITTED`），不建重复章节。

返回章节 id。渲染端只在成功回执后显示「已保存」。

## 9. 重启恢复（PROCESS_INTERRUPTED）

应用启动时（迁移后），主进程扫出所有 `status='running'` 的 run：

- 标 `failed` + `error_code='PROCESS_INTERRUPTED'`；
- **不自动重放付费请求**（不重新调模型）；
- 若 `draft_content` 非空，可继续保存（界面提供入口）；否则显示中断。

## 10. 抽取（extract_status，附属）

- 默认在 `committed` 之后异步执行，不阻塞保存（沿用现有 `generateAndSaveSummary` + `onPersistExtraction` 链路）。
- 非 hook 事实/知识可自动落库；hook 只走 `createChapterExtractionProposals`（A5）。
- `workflow:chapterRun:retryExtract`：失败后可重试抽取，不影响已保存正文。
- `extract_status`：`pending → running → completed/failed/skipped`。

## 11. 文件边界

新增：
- `src/main/db/repositories/chapter-run.repo.ts`
- `src/main/db/repositories/chapter-run.service.ts`（run 创建/状态迁移/commit 幂等/启动恢复）
- `src/main/ipc/chapter-run.ipc.ts`
- `src/renderer/services/chapter-run-loader.ts`（项目 ID + 代次守卫）

修改：
- `src/main/db/migrations.ts` — v24
- `src/main/ipc/index.ts` — 注册
- `src/main/index.ts` — 启动时恢复遗留 running → failed
- `src/main/ai/stream-registry.ts` — runId 已是可选字段，三期必填
- `src/renderer/components/AIWritePanel.tsx` — 单章走 workflow start/commit；批量另议
- `src/renderer/App.tsx` — onSaveAsChapter 改走 commit 或保留兼容
- `AGENTS.md` / `CLAUDE.md` — 收口时更新

## 12. IPC 契约（三期）

- `workflow:chapterRun:start` — 创建 run + 可取消流 + 落草稿，返回 runId/状态/草稿
- `workflow:chapterRun:get` / `list` — projectId + runId
- `workflow:chapterRun:cancel` — 绑定 projectId + runId
- `workflow:chapterRun:commit` — 只提交正文 + 施工卡，返回章节 id（幂等）
- `workflow:chapterRun:retryExtract`
- `workflow:chapterRun:retry` — 重新生成（新建 run，`retry_of_run_id` 关联）

错误码：`RUN_NOT_FOUND`、`RUN_PROJECT_MISMATCH`、`RUN_ALREADY_COMMITTED`、`EMPTY_DRAFT`、`PROCESS_INTERRUPTED`、`FACT_EXTRACTION_INVALID`。

## 13. 测试策略（TDD）

- 迁移：v23 无损升级 v24，DDL 与版本号同事务
- 空草稿不能进入 `drafted`
- 重复 commit 返回同一章节
- 进程中断 running → failed/PROCESS_INTERRUPTED，不自动请求模型
- commit 成功后抽取失败，章节正文仍在；hook 只进 proposed
- `planning_outline` 随 create 写入（施工卡不回归）
- 切项目后旧运行成功回执不写进新项目 UI
- 取消绑定 projectId + runId

## 14. 已定决策（2026-09-15 用户确认）

1. **单章交互**：采用**两段式落库**（start → drafted 草稿落库 → 手动保存 → committed），草稿落库可重启恢复。接受改变现在「面板即时流式」体验。
2. **批量写章**：**暂不纳入 run 记录**，继续用现有 localStorage 断点续写；批量接 run 另立 P2。
3. **流式进度**：**放弃逐字流式**，用一次性 `provider.chat` 拿全文本（同二期），进度条降级为可选增强。

> 这三条已由用户拍板，编码时不再摇摆。

## 15. 实施顺序

1. 改 Spec 迁移号（三期 v24）
2. 迁移 v24 + chapter-run.repo + 单测
3. chapter-run.service（run 创建/状态迁移/commit 幂等/启动恢复）+ 单测
4. workflow IPC + 注册 + stream-registry 接 runId
5. index.ts 启动恢复
6. AIWritePanel 单章走 workflow；App.tsx 保存/抽取接线
7. 全量回归 + 真实 UI 回归 + 报告；更新文档

---

**计划已确认。先改 Spec 迁移号（三期 v24），再按顺序编码。**
