# 叙事时间接入 Implementation Plan（选项 B）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or implement task-by-task with TDD. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **合同：** `docs/superpowers/specs/2026-09-14-narrative-time-integration-design.md`

**Goal:** 将 P1 叙事时间纯函数接入 SQLite：v21 DDL、章节软删、投影/转换同事务写路径、固定截面 Context。

**Architecture:** 迁移扩表 → ChapterRepo 墓碑语义 → NarrativeTransitionRepo + 改 batchUpsert/confirmMany → AI 上下文加载器调用 reduce*AsOf。

**Tech Stack:** TypeScript、better-sqlite3、Vitest、现有 Electron IPC。

## Global Constraints

- 库版本 20→21；不并章、不永久删除、alias 表空。
- 复用 `narrative-time-order` / `narrative-state-reducer` / `narrative-planning-key`。
- 转换 `after_snapshot` 必须完整；折叠不泄漏当前投影。
- IPC 通道名不变；不新增墓碑 UI。
- 工作目录：本 worktree；不 push。

## 文件地图

- Modify: `src/main/db/migrations.ts`
- Create: `src/main/db/repositories/narrative-transition.repo.ts`
- Modify: `src/main/db/repositories/chapter.repo.ts`
- Modify: `src/main/db/repositories/story-facts.repo.ts`
- Modify: `src/main/db/repositories/creative-decision.repo.ts`
- Create: `src/main/ai/narrative-as-of-context.ts`
- Modify: `src/main/ai/context-builder.ts`（及必要 AI IPC）
- Create: `tests/unit/db/migration-v21.test.ts`
- Create: `tests/unit/db/chapter-soft-delete.test.ts`
- Create: `tests/unit/db/narrative-transition-write.test.ts`
- Create: `tests/unit/narrative-as-of-context.test.ts`
- Modify: `AGENTS.md` / `CLAUDE.md`（一条已实现）

---

### Task 1: v21 迁移

- [ ] 写迁移测试（版本升到 21、新表/列存在、hook archived、失败回滚）
- [ ] 实现 v21 SQL + 章纲补 id 应用层步骤（同事务）
- [ ] 定向测 PASS + commit

### Task 2: 章节软删

- [ ] 写软删矩阵失败测试
- [ ] 实现 remove/restore/find*/reorder/count/words/create 活跃过滤
- [ ] 定向测 PASS + commit

### Task 3: 转换写路径

- [ ] 写 NarrativeTransitionRepo + batchUpsert/confirmMany 失败测试
- [ ] 实现同事务投影+转换
- [ ] 定向测 PASS + commit

### Task 4: Context as-of

- [ ] 写 `buildNarrativeAsOfContext` 测试（四模式、跨项目抛错）
- [ ] 实现并接到 ContextBuilder / AI 加载
- [ ] 定向测 PASS + commit

### Task 5: 收口

- [ ] 全量相关测 + build:main
- [ ] 路径限定 status；更新 AGENTS/CLAUDE
- [ ] commit；不 push
