# 叙事时间接入设计（完整纵向 · 选项 B，2026-09-14）

> **效力：** 本文是 P1 纯函数之后的**接入 Spec**。施工依据：[2026-09-14-narrative-time-model-design.md](./2026-09-14-narrative-time-model-design.md)。用户已授权完整纵向方案（选项 B）。
>
> **范围定案：** v21 迁移 + 叙事状态写路径双真相 + 章节软删/恢复 + 固定截面查询/Context + DB 回归。**不**永久删除、**不**并章 IPC/UI、`chapter_alias` 建表但本轮保持为空、**不**新增墓碑管理 UI。

---

## 0. 一句话

把已锁死的叙事时间纯函数接到 SQLite：表能存历史，写路径同事务更新投影与转换日志，读路径按任务固定截面折叠；章节删除改为墓碑软删以保住锚点。

---

## 1. 已拍板边界（不可违反）

1. **完整纵向**：禁止「只 DDL+读」或「连完整管理 UI」。
2. **选项 B 写路径**：叙事状态双写 **+** 章节软删/恢复；并章与永久删除另立授权。
3. **软删语义（对方建议原样采纳）**
   - `remove` → 事务内：保存 `deleted_sort_order`、设 `deleted_at`、退出活跃排序并规范化剩余活跃章。
   - `restore` → 优先唤醒原 ID 墓碑，插回 `min(deletedSortOrder, activeCount)`。
   - `findByProject` / 字数 / 计数 / 创建末尾位置 / `reorder` **默认只活跃章**。
   - `chapter_history` 与四类叙事状态章锚**必须保留**。
   - 内部 `findByIdIncludingDeleted`；普通业务不显示墓碑。
   - 现有删除/撤销 IPC 兼容，不新增墓碑页。
4. **本轮不提供永久删除**；不新增并章 IPC/UI；不写 alias 行。
5. **旧数据**：无转换行时 `before_target`/`through_target` → `data:null` + `historyWarnings`；`project_latest` 可回退当前投影；整数 `promised_by_chapter` 不猜测映射。
6. **复用 P1 纯函数**；禁止在仓储里重写折叠语义。

---

## 2. v21 DDL 合同

库版本 **20 → 21**，单事务。

### 2.1 `narrative_transitions`

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | TEXT PK | 预分配 UUID |
| `project_id` | TEXT NOT NULL | FK projects CASCADE |
| `target_table` | TEXT NOT NULL | `story_facts` / `character_knowledge` / `narrative_hooks` / `narrative_debts` |
| `target_id` | TEXT NOT NULL | |
| `kind` | TEXT NOT NULL | `created`/`superseded`/`resolved`/`paid`/`abandoned`/`waived`/`partially_resolved` |
| `at_chapter_id` | TEXT NOT NULL | 运行时章锚（可指向墓碑行，**不** ON DELETE SET NULL） |
| `at_chapter_ordinal` | INTEGER NOT NULL | 章内序；无证据时用 `defaultOrdinalForAppend` |
| `transition_seq` | INTEGER NOT NULL | 同事务分配的最终 tie-break |
| `after_snapshot` | TEXT NOT NULL | JSON：`{ schemaVersion, data }`，**完整**业务快照 |
| `decision_id` | TEXT NULL | 可选 |
| `created_at` | TEXT | 墙钟审计，**不**参与故事比较 |

索引：`(project_id, target_table, target_id)`、`(project_id, at_chapter_id)`。

### 2.2 `chapter_alias`

`from_chapter_id` UNIQUE、`to_chapter_id`、`ordinal_offset INTEGER NOT NULL CHECK(>=0)`、`created_at`。本轮**零写入**。

### 2.3 `chapters` 墓碑列

- `deleted_at TEXT NULL`
- `deleted_sort_order INTEGER NULL`
- 活跃章：`deleted_at IS NULL`；`sort_order` 连续 `0..n-1`（应用层 + 回归保证；SQLite 部分唯一索引若环境不支持则文档说明依赖应用层）

### 2.4 状态键与归档

- `story_facts`：`state_key TEXT`、`state_key_version INTEGER NOT NULL DEFAULT 1`、`archived INTEGER NOT NULL DEFAULT 0`
- 迁移：现有 `fact_type='hook'` 行设 `archived=1`，**不物理删**
- 知识/钩/债：本轮可不加 `state_key`（非状态型事实键）；副锚仍为 TEXT

### 2.5 章纲稳定 ID

- `chapters.planning_outline_id TEXT NULL`（正文绑定）
- 迁移步骤（同事务）：扫描 `planning_ideas.chapter_outlines` JSON，缺 `id` 的项补 UUID 并写回

---

## 3. 章节软删 / 恢复 IPC

通道名不变：`db:chapter:remove` / `db:chapter:restore`。

| API | 行为 |
|---|---|
| `remove(id)` | 活跃章 → 墓碑；规范化其余活跃 `sort_order`；失败整事务回滚 |
| `restore(chapterData)` | `findByIdIncludingDeleted(id)`：若是墓碑则唤醒；若行不存在（旧硬删 Undo 数据）才允许 INSERT 兼容路径；插回位置 `min(deleted_sort_order, activeCount)` |
| `findById` | `deleted_at IS NULL`，否则 not found |
| `findByIdIncludingDeleted` | 仓储内部 / 测试；可不暴露 IPC |
| `findByProject` 等 | `WHERE deleted_at IS NULL` |
| `reorder` | 校验 `chapterIds` 恰好等于该项目全部活跃 id 一次、同项目；否则失败不改库 |
| `create`/`insertAfter` | MAX/移位只看活跃章 |

---

## 4. 写路径双真相

所有下列路径在**同一 SQLite 事务**内：更新投影 + 追加 `narrative_transitions`（完整 `after_snapshot`）。

| 路径 | 改动 |
|---|---|
| `StoryFactsRepo.batchUpsert` | 停止 `DELETE`；对可覆盖的旧自动投影写 `superseded` + 转换；插入新投影 + `created` 转换；`source_decision_id IS NOT NULL` 不覆盖 |
| `CreativeDecisionRepo.confirmMany` | `applyNew`/`applyRevision` 后追加转换；`at_chapter_id` 取决策源章（非确认墙钟）；`ordinal` 默认章末 append |
| hook 回收 / debt 偿还 | 经 confirm 投影；`overdue` **不**写转换 |

`after_snapshot.schemaVersion` 起步为 `1`，与 P1 `KNOWN_SNAPSHOT_SCHEMA_VERSION` 一致。

---

## 5. 查询 / Context

- Main：`resolveTimeMode(taskType, { hasActiveChapter })` + `validateTaskTimeMode`；非法组合抛错。
- 映射：write/review→`before_target`；chat+活动章→`through_target`；chat 无活动章→`project_latest`；planning→`planning_only`。
- 加载活跃章位置、空 alias 列表、相关转换 → 调用 P1 `reduce*AsOf` / `accumulateEventsAsOf`。
- 目标章跨项目/已删：显式错误。
- `historyWarnings` 有界注入或日志；不新 UI。
- 去掉用全书 `MAX(sort_order)` 冒充「当前章」的路径（若存在）。

---

## 6. 验收矩阵（DB 回归必须）

### 6.1 迁移

- v20→v21 原子成功；中途失败回滚；升级后可读；hook 事实 archived；章纲补 id。

### 6.2 软删

- 中间章软删、恢复、连续删除、恢复位置冲突（多墓碑同 `deleted_sort_order`）、历史保留、叙事锚保留、活跃序连续、跨项目拒绝、任一步失败回滚。

### 6.3 写路径

- 重抽取不硬删作者确认行；同事务有转换；confirm 后投影与末条快照一致（`verifyProjectionMatches` 或等价）。

### 6.4 as-of / Context

- 四模式注入冒烟；墓碑来源排除；字段不穿越；`project_latest` 旧投影回退。

### 6.5 本轮不测

- 并章写库、永久删除、非空 alias 路径（纯函数单测已覆盖）。

---

## 7. 明确不做

- 永久删除依赖检查 UI
- 并章确认流 / alias 写入
- ContextAssembler 大重构、chapter-run、分析 job、`content_revision`
- 新墓碑管理页面

---

## 8. 完成标准

- v21 已应用；软删/恢复 IPC 行为符合第 3 节；写路径无裸 `DELETE` 重抽取；AI 上下文按任务截面折叠；第 6 节 DB 回归全绿；`migrations.ts` 仅增 v21；未 push。
