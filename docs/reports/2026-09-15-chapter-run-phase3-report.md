# 三期实施报告：轻量写章运行记录（chapter-run 三期）

日期：2026-09-15
依据：`docs/superpowers/specs/2026-09-10-chapter-run-review-ledger-design.md`（v0.3）+ `docs/superpowers/plans/2026-09-15-chapter-run-phase3-plan.md`

## 完成内容

1. **迁移 v24** — `chapter_runs` 一张表（无五阶段子表）：状态机 `running/drafted/committed/failed/cancelled`、`draft_content` 草稿、`input_summary` 输入摘要、`extract_status` 抽取状态、`cancel_requested`。
2. **run repo + service** — `chapter-run.repo.ts`（SQL 数据层）+ `chapter-run.service.ts`（commit 幂等、启动恢复 `recoverInterruptedAll`）。
3. **workflow IPC** — `workflow:chapterRun:start`（创建 run + 一次性 chat + 落草稿）、`cancel`（绑定 projectId + runId，`cancelByRunId`）、`commit`（幂等）、`get`、`list`。
4. **stream-registry 接 runId** — 三期写章运行必填 runId；新增 `cancelByRunId`。
5. **启动恢复** — `index.ts` 迁移后扫 `running` → 标 `failed/PROCESS_INTERRUPTED`，不自动重放付费请求。
6. **渲染端接 workflow** — `AIWritePanel` 单章生成走 `workflow:chapterRun:start`（放弃逐字流式），保存走 `commit`（幂等）；订阅 `started` 事件拿 streamId；`App.tsx` 加 `onChapterCommitted` 回写完整章节。

## 关键决策（已由用户拍板）

1. 单章采用两段式落库（start → drafted → 手动保存 → committed），草稿落库可重启恢复。
2. 批量写章暂不接 run 记录（继续 localStorage 断点续写，另立 P2）。
3. 放弃逐字流式，用一次性 `provider.chat` 拿全文。

## 修改文件

新增：
- `src/main/db/repositories/chapter-run.repo.ts`
- `src/main/db/repositories/chapter-run.service.ts`
- `src/main/ipc/chapter-run.ipc.ts`
- `tests/unit/db/migration-v24.test.ts`
- `tests/unit/db/chapter-run.service.test.ts`

修改：
- `src/main/db/migrations.ts`（v24）
- `src/main/ai/stream-registry.ts`（cancelByRunId）
- `src/main/ipc/index.ts`（注册）
- `src/main/index.ts`（启动恢复）
- `src/renderer/types/index.ts`（ChapterRun 类型 + 返回契约）
- `src/renderer/components/AIWritePanel.tsx`（单章走 workflow）
- `src/renderer/App.tsx`（onChapterCommitted）

## 遇到问题

- **commit 返回值演进**：最初返回 `{ chapterId }`，渲染端保存后无法把完整章节加进 App 列表 → 改为返回 `{ chapter: Chapter }`，`onChapterCommitted` 回写。
- **cancelByRunId 缺失**：cancel 需要 streamId 才能 abort，但 run 只有 runId → 给 stream-registry 补 `cancelByRunId`（遍历按 runId 匹配）。

## 下一步建议

- **真实供应商烟测未做**：三期主进程写章流、取消、落草稿链路经单测覆盖，未跑真实 AI 供应商烟测。
- **真实 UI 回归未跑**：`tests/ui/run-writing-workspace.cjs` 未针对「草稿恢复 / 中断 / 幂等保存」扩展 UI 断言。
- **批量写章接 run**：暂未做，继续 localStorage 断点续写，另立 P2。
- **抽取重试入口**：`extract_status` 字段已建，但 `workflow:chapterRun:retryExtract` IPC 未实现（计划里列了，本轮聚焦核心保存链路，抽取重试可跟进）。

## 自检结论

1. 满足需求 ✅（写章运行记录：input_summary 记输入、draft_content 存草稿、PROCESS_INTERRUPTED 恢复、commit 幂等防重复、状态机）
2. 不影响已有功能 ✅（622 测试全过、typecheck、build 全绿）
3. 边界情况 ✅（空草稿不 drafted、重复 commit 返回原章节、running→failed 不重放、取消绑定 runId）
4. 测试已同步 ✅（新增 migration-v24 + chapter-run.service 两个测试文件）
5. 技术债已记录 ✅（真实烟测、真实 UI 回归、批量接 run、抽取重试入口，见「下一步建议」）
