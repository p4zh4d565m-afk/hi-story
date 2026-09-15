# 二期实施报告：审稿版本账本（chapter-run 二期）

日期：2026-09-15
依据：`docs/superpowers/specs/2026-09-10-chapter-run-review-ledger-design.md`（v0.3）+ `docs/superpowers/plans/2026-09-15-chapter-run-phase2-plan.md`

## 完成内容

1. **迁移 v23** — `chapters.content_generation`（世代列）+ `chapter_reviews`（审稿账本）+ `chapter_revision_proposals`（修订提案）+ 唯一索引（同章一个 proposed）+ 级联删除。
2. **正文世代纯函数** — `src/main/ai/content-revision.ts`：`normalizeChapterText`（去标签 + 合并空白）+ `shouldBumpContentGeneration`（normalize 判据）。
3. **章节 Repo 接世代** — `create` 写 1；`update`/`restoreSnapshot` 用 normalize 判据递增 + 正文真变时作废同章 proposed（与打历史快照的 `content !==` 判据分开）。
4. **审稿 prompt 三态改造** — `REVIEW_SYSTEM_PROMPT` 从 `passed:boolean` 改为 `status: pass/issue/inconclusive` + `evidence` + `issues[]`；`REVIEW_PROMPT_VERSION` 常量 `review-v2-2026-09-15`。
5. **审稿 service** — `parseReviewResponse`（15 维度完整性校验 + 三态解析）+ `aggregateReview`（coverage ≥12/15、critical 硬门禁、70 分门槛）+ `applyRevision`（世代冲突标 stale，事务内打快照 + 写正文 + 世代递增）。
6. **workflow IPC** — `run`（一次性 chat + 双重世代校验 + 同章互斥 + 可取消）、`list`（含 freshness/待复评）、`createRevision`（取消不落 proposed）、`applyRevision`、`rejectRevision`。
7. **渲染端接 workflow** — `AIReviewPanel` 不再自开 chatStream/自解析/直写 update，改走 workflow；新增审稿历史列表 + 待复评提示；`App.tsx` 的 `onChapterAccepted` 复用（回写 content）。

## 修改文件

新增：
- `src/main/ai/content-revision.ts`
- `src/main/db/repositories/chapter-review.repo.ts`
- `src/main/db/repositories/chapter-review.service.ts`
- `src/main/ipc/chapter-review.ipc.ts`
- `tests/unit/content-revision.test.ts`
- `tests/unit/db/migration-v23.test.ts`
- `tests/unit/db/chapter-generation.test.ts`
- `tests/unit/db/chapter-review.service.test.ts`

修改：
- `src/main/db/migrations.ts`（v23）
- `src/main/db/repositories/chapter.repo.ts`（世代 + 作废 proposed）
- `src/main/ipc/index.ts`（注册）
- `src/renderer/types/index.ts`（Chapter.contentGeneration + 审稿三态类型 + 账本类型）
- `src/renderer/services/ai-prompts/review.ts`（三态 prompt + prompt_version）
- `src/renderer/components/AIReviewPanel.tsx`（workflow + 历史列表）
- `src/renderer/components/AIReviewResult.tsx`（三态渲染适配）
- `docs/superpowers/specs/2026-09-10-chapter-run-review-ledger-design.md`（迁移号 v21/v22→v23/v24）

## 遇到问题

- **迁移 v23 原子回滚测试**：最初用 `BEFORE INSERT` trigger 制造失败，但 trigger 引用了迁移才建的表，导致 CREATE TRIGGER 本身就失败。改用「预建缺列同名表」让 CREATE INDEX 失败触发回滚。
- **applyRevision 世代冲突标 stale 被回滚**：最初把 `markProposalStale` + `throw` 放在同一事务里，`throw` 触发回滚把标 stale 也回滚了。修复：世代冲突的预检移到事务外，先持久化标 stale 再返回，不依赖事务回滚。
- **parseReviewResponse 缺完整性校验**：最初只校验单维度 id 合法性，没校验「恰好 15 个、id 无重复」。测试暴露后补上。
- **seedProposal 测试 helper bug**：`proposed_content` 占位符写成字面量 `'?'`，导致提案内容恒为 `'?'`，测试全挂。

## 下一步建议

- **三期（写章运行记录）** 未开工，迁移号 v24，需另立实施计划（`chapter_runs` 表 + 运行状态机 + 中断恢复 + commit 幂等）。
- **真实供应商烟测未做**：二期主进程审稿流、取消、落库链路经单测覆盖，但未跑真实 AI 供应商烟测。若需上线前验证，需配置真实 Key 手动跑一轮。
- **真实 UI 回归未跑**：`tests/ui/run-writing-workspace.cjs` 未针对「过期/冲突/待复评」扩展 UI 断言（计划 §15 要求，本轮未补 UI 脚本，仅做了单测 + 类型检查 + 构建）。
- **历史快照判据统一**：`chapter_history` 打快照仍用 `content !==`，与世代 `normalize` 判据未统一（Spec 明确非验收阻塞，留待后续）。

## 自检结论

1. 满足需求 ✅（二期审稿版本账本：正文世代 + 审稿持久化 + 修订事务 + 冲突回退 + 待复评）
2. 不影响已有功能 ✅（609 测试全过、renderer typecheck、build:main、build:renderer 全绿）
3. 边界情况 ✅（等价 HTML 不递增、改标点递增、世代冲突标 stale 不被回滚、取消不落 proposed、同章互斥、解析失败落 failed、维度完整性校验）
4. 测试已同步 ✅（新增 4 个测试文件，共 32 个断言，覆盖纯函数/迁移/世代/解析聚合/修订事务）
5. 技术债已记录 ✅（真实供应商烟测、真实 UI 回归、历史快照判据统一，见「下一步建议」）
