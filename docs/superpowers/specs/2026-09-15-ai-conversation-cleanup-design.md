# AI 对话清理设计（方案 4 · 软删除 + 短时撤销，2026-09-15）

> **效力：** 本文是「AI 对话隔离与清理」产品拍板后的**施工 Spec**。
> **前置：** #145 renderer 全量类型检查门槛已提交于分支 `codex/renderer-typecheck`（`25d96ce`）；叙事时间 fail-closed 已在 master。
> **本轮授权范围：** 项目级会话（**不绑章**）+ 消息软删除 + 约 10 秒撤销 + 清空/按轮删/删整会话。
> **本轮不做：** 按章强制隔离、完整回收站 UI、关应用后恢复、消息硬删除、编辑消息、会话重命名大改。
> **分支纪律：** Spec 可暂存在 `#145` 分支上便于审查；**批准编码后**须等 `#145` 合入最新 `master`，再从该 tip **新开**会话清理分支施工——禁止在 `codex/renderer-typecheck` 上直接叠编码提交。

---

## 0. 一句话

在**不绑章节**的前提下，让作者能按轮删除与一键清空当前会话，删除内容立即退出界面与模型上下文；误操作靠约 10 秒批次撤销挽回；关应用后不再提供撤销；删整会话仍走现有硬删除 + 二次确认。

---

## 1. 已拍板边界（不可违反）

1. **会话模型选 C**：`conversation_threads` **不**增加 `chapter_id`；切章不自动换会话；跨章污染靠作者可控的生命周期（新建 / 清空 / 按轮删 / 删会话）解决。
2. **清理能力三者都要**：
   - **按轮删除**
   - **一键清空当前会话**（保留会话壳）
   - **删除整个会话**（现有 `removeThread`，硬删除 + 二次确认，本轮保留）
3. **按轮范围**：以某条 **user** 消息为锚，隐藏该消息及其后、**下一条 user 之前**的全部 **assistant**（及同区间内若有的 system，见 §3.1）。不是「只删单条」。
4. **软删除 + 短时撤销（方案 4）**：消息行保留；`deleted_at` 非空即隐藏；约 **10 秒** UI 撤销；**关闭应用后不再提供撤销**（无回收站、无恢复列表）。
5. **撤销合同**：UI 只暴露**最近一次**删除批次的撤销；`restoreBatch` 必须校验 **projectId + threadId + batchId** 归属。墙钟「约 10 秒」**只由渲染端**控制（过期收起按钮、不持久化 pending）；服务端**不**校验过期——若客户端仍调用且批次仍在，允许恢复（便于测试；产品路径关应用后无入口）。
6. **统一过滤合同**：凡会话加载、UI 列表、消息计数、拼进模型的历史，一律 `deleted_at IS NULL`。禁止某条路径漏过滤导致「幽灵上下文」。
7. **流式互斥合同**：正在流式生成时，**禁止**按轮删、清空、切换会话；须先取消生成，再允许操作。**门闩仅渲染端**（§3.1 / §5.4）；Main 不做流式前置。
8. **创作决策来源**：软删保留 `conversation_messages` 行，使 `creative_decisions.source_message_id` 外键**不断裂**。软删**不**自动撤回已确认决策投影（另立账本路径）。
9. **删整会话例外**：`removeThread` 继续物理删除线程（CASCADE 消息）；`source_message_id` 现有 `ON DELETE SET NULL` 行为不变。本轮不改成会话级软删。
10. **渲染端守卫：** 清理写路径必须遵守 §5.0（项目守卫 + **单飞互斥**）；空清空不得伪造可撤销批次（§3.2）。
11. **清空确认：** 清空消息**不**弹确认；仅删整会话二次确认。

---

## 2. DDL 合同（迁移 v22）

库版本 **21 → 22**，单事务。

### 2.1 `conversation_messages` 新增列

| 列 | 类型 | 说明 |
|---|---|---|
| `deleted_at` | TEXT NULL | 非空 = 已软删；`NULL` = 活跃 |
| `deletion_batch_id` | TEXT NULL | 同一次「按轮删」或「清空」共享同一 UUID；活跃行必须为 NULL |

约束（**应用层保证，本轮不做 SQL CHECK**——避免迁移方言/重建表扩大范围；单测锁定「活跃行两列皆 NULL、软删行两列皆非空」）：

- `deleted_at IS NULL` ⇒ `deletion_batch_id IS NULL`
- `deleted_at IS NOT NULL` ⇒ `deletion_batch_id IS NOT NULL`

索引建议：

- `(thread_id, sort_order)` 已有；可补 `(thread_id, deleted_at)` 便于过滤（非必须）。
- `(deletion_batch_id)` 便于 `restoreBatch`。

### 2.2 不做的 DDL

- **不**给 `conversation_threads` 加 `chapter_id`。
- **不**新建回收站表。
- **不**给消息加永久 `purged_at`（若未来要物理清理，另立项）。

---

## 3. 写路径语义

### 3.1 `deleteTurn(projectId, threadId, userMessageId)`

前置：

- 线程属于 `projectId`。
- 目标消息存在、`role = 'user'`、`deleted_at IS NULL`、属于该 `threadId`。
- **流式互斥仅由渲染端强制**（见 §5.4）。主进程 `ConversationRepo` / conversation IPC **不**查询 `stream-registry`、**不**以「是否正在生成」为前置条件——主进程只校验项目/会话/消息归属与活跃态。

行为（**单事务**）：

1. 按 `sort_order`（并列用 `timestamp`, `id`）取该 user 之后、下一条 **活跃** user 之前的所有**活跃**消息。
2. 本批隐藏集合 = **锚点 user** ∪ 上述区间内全部消息（预期主要为 assistant；若夹有 system 一并隐藏，避免半截）。
3. 分配新 `deletion_batch_id`（UUID）；统一写入同一 `deleted_at`（ISO 墙钟）。
4. 更新线程 `updated_at`。
5. 返回：`{ batchId, threadId, deletedMessageIds, deletedAt }`。

边界：

- 锚点后无 assistant：仍可软删该 user 单独成批。
- 锚点已删或不存在：`success: false`，明确错误。

### 3.2 `clearThread(projectId, threadId)`

前置：线程属于 `projectId`（流式互斥同 §3.1，仅渲染端）。

行为（**单事务**）：

1. 统计该线程 `deleted_at IS NULL` 的消息。
2. **若活跃消息数为 0（空清空）：**
   - **不**分配 `deletion_batch_id`，**不**改写任何行（含 **不** touch `updated_at`）。
   - 返回：`{ batchId: null, threadId, deletedMessageIds: [], deletedAt: null, noop: true }`。
   - 渲染端：**不**展示撤销条（无批次可恢复）。
3. **若存在活跃消息：**
   - 全部标上同一新 `deletion_batch_id` 与同一 `deleted_at`。
   - **不**删除 `conversation_threads` 行。
   - 更新线程 `updated_at`。
   - 返回：`{ batchId, threadId, deletedMessageIds, deletedAt, noop: false }`（`batchId` 为非空 string）。

**禁止：** 为空清空伪造「从未写入库的 `batchId`」。否则 `restoreBatch` 因找不到行而失败，UI 却以为可撤销——这是合同级错误。

### 3.3 `restoreBatch(projectId, threadId, batchId)`

前置：

- 线程属于项目。
- 存在至少一条该线程消息：`deletion_batch_id = batchId` 且 `deleted_at IS NOT NULL`。

行为（**单事务**）：

1. 将这些行的 `deleted_at`、`deletion_batch_id` 置回 `NULL`。
2. 更新线程 `updated_at`。
3. 返回恢复后的消息 id 列表（或完整活跃快照片段）。

拒绝：

- 批次不存在 / 不属于该线程 / 项目不匹配 / `batchId` 为空。
- **不**要求服务端感知「10 秒」——时效由渲染端 UI 控制；过期后 UI 不再调用。关应用后本地不持久化 pending undo，故自然无法撤销。
- 对 `clearThread` 的 `noop: true` 响应，客户端**不得**调用 `restoreBatch`。

### 3.4 `removeThread`（现有）

- 保持硬删除 + 渲染端二次确认。
- CASCADE 删消息；创作决策 `source_message_id` SET NULL。
- 本轮 UI 不把「删会话」与「清空」混成同一按钮。

### 3.5 `appendMessage` / 加载

- `appendMessage` 只追加活跃消息；`sort_order` 仍对**全表**（含软删行）取 `MAX+1`，避免与软删行撞序导致恢复后乱序。
  **合同：** 排序键全局单调；过滤只影响可见集，不重排 `sort_order`。
- `findByProject`（及任何 list API）消息数组**仅含** `deleted_at IS NULL`。

---

## 4. 读路径与模型上下文

1. **会话快照**：`ConversationSnapshot.messages[threadId]` 不得含软删行。
2. **拼进 `chatStream` / `ai:chat` 的 history**：只使用上述活跃快照（或等价过滤后的数组）。
3. **计数 / 搜索（若有）**：同过滤；本轮若聊天内搜索存在，必须跳过软删，否则标为已知债并在 PR 写明。
4. **as-of 叙事截面**：与消息软删无关，仍按活动章 / taskType 合同；本 Spec 不改叙事时间。

---

## 5. 渲染端 UX 合同

### 5.0 项目守卫与清理单飞互斥（必做）

与策划/会话加载一样要防切项目污染；**但清理写路径禁止用「每次 invoke 递增 epoch、仅最新 epoch 可 apply」**——那会在连点时把**已经成功写库**的回执丢掉，UI 与 SQLite 分叉（P1）。

定案：**同一聊天面板同一时刻只允许一个清理类操作在飞（单飞互斥）**，外加项目守卫。

1. **项目守卫：** invoke 前记下 `requestProjectId`；回执落地前若 `activeProjectId !== requestProjectId`，**忽略 UI 更新**（不改 `messages`、不弹/不改撤销条、不切 `activeThreadId`）。库侧已提交的软删不自动回滚。
2. **单飞互斥（替代 cleanupEpoch）：**
   - 面板级（或按 `threadId`）布尔 / Promise 锁：`cleanupInFlight`。
   - 覆盖：`deleteTurn` / `clearThread` / `restoreBatch` / `removeThread`。
   - 任一在飞时：禁用上述按钮与切换会话；新点击 **早退、不发起第二趟 IPC**。
   - 当前操作的成功回执（且通过项目守卫）**必须** `onApply`——不得因「又点了一次」而丢弃。
   - `finally` 清锁；失败同样清锁并展示错误。
3. **撤销条：** pending undo 记录 `{ batchId, threadId, projectId }`（**无 epoch**）。新一次**已成功**的删除/清空（`noop: false`）覆盖旧条；切项目、删整会话、撤销成功或 10s 到期时清除。
4. **切项目：** 清本地消息/撤销条并释放锁（或随面板卸载），再加载新项目快照；加载失败不得用空快照盖掉仍属该项目的旧成功态（沿用 `conversation-persistence` 合同）。
5. **与流式互斥叠加：** 生成中禁止清理（§5.4）；清理在飞时亦禁止开新流（发送按钮 disabled），避免「删完立刻发」与未落地回执交错。若产品允许先停流再清，顺序为：cancel → 流结束 → 再获清理锁。

### 5.1 按轮删除

- 以「一轮」为操作单元：UI 挂在该轮 user 气泡或轮次容器上（文案：「删除本轮」）。
- 成功（`noop: false` 且 `batchId` 非空）后：立即从本地 state 移除对应消息；弹出约 **10s**「已删除 · 撤销」（受 §5.0 守卫）。
- 撤销调用 `restoreBatch`；成功则按 `sort_order` 重载该线程活跃消息。

### 5.2 清空当前会话

- 独立入口（如会话菜单「清空消息」），与「删除会话」分开。
- **立即执行，不弹确认**（已有约 10 秒撤销）；仅当返回 `noop: true` 时静默或轻提示「已无消息」，不显示撤销条。
- 清空后会话壳与标题保留；列表仍显示该线程。
- **只有**「删除整个会话」保留二次确认（硬删不可短时撤销）。

### 5.3 删除整个会话

- 沿用现有 `×` + confirm + `removeThread`（及现有 localStorage 回收站逻辑若仍在，本轮不强制改）。
- **无** 10s 消息级撤销（整会话硬删）。

### 5.4 流式互斥（仅渲染端）

当该面板 `generating / streaming === true`：

- 禁用：按轮删、清空、切换 `activeThreadId`、会切走当前线程的新建聚焦。
- 允许：停止生成（现有 cancel）。
- 停止并确认流结束后，才解锁删除类操作。
- **Main 不实现流式前置**：不查 `stream-registry`、不以生成中拒写。正确性靠本条 UI 门闩 + handler 早退（无 IPC）+ §5.0 单飞互斥；回归必须锁「生成中不可点 / 不 invoke」「清理在飞时不可再点清理」。

### 5.5 关应用

- pending undo **只活在内存**（React state）；不写 `localStorage`。
- 关应用 / 刷新 / 切项目导致组件卸载 → 撤销条消失；软删行保持 `deleted_at` 非空。

### 5.6 新建 / 切换

- 现有能力保留；本轮可做小幅可见性加强，但不绑章、不自动按章建会话。

---

## 6. IPC 合同（建议名）

| Channel | 入参 | 成功 data |
|---|---|---|
| `db:conversation:deleteTurn` | `{ projectId, threadId, userMessageId }` | `{ batchId: string, threadId, deletedMessageIds, deletedAt, noop: false }` |
| `db:conversation:clearThread` | `{ projectId, threadId }` | 有删：`{ batchId: string, ..., noop: false }`；空清空：`{ batchId: null, deletedMessageIds: [], deletedAt: null, noop: true }` |
| `db:conversation:restoreBatch` | `{ projectId, threadId, batchId: string }` | `{ batchId, threadId, restoredMessageIds }`；`batchId` 空或命中 0 行 → `success: false` |
| 现有 `removeThread` / `createThread` / `findByProject` / `appendMessage` | 不变；`findByProject` 过滤软删 |

全部返回 `IpcResult<T>`；失败不部分提交。

---

## 7. 类型合同

- **公开** `ConversationMessage` / `ConversationSnapshot`：**不**增加 `deletedAt` / `deletionBatchId`。对外快照与 IPC 成功路径只返回活跃消息，调用方无需看见软删字段。
- **仓储内部**行映射（如 `ConversationMessageRow`）可含 `deleted_at` / `deletion_batch_id`，仅供 repo / 测试断言「行仍在、决策 FK 可 join」。
- `clearThread` / `deleteTurn` 成功 data 须含 `noop: boolean` 与 `batchId: string | null`（`deleteTurn` 成功时恒为非空 string + `noop: false`）。

---

## 8. 验收矩阵

### 8.1 迁移

- v21→v22 成功；中途失败回滚；旧消息 `deleted_at` / `deletion_batch_id` 均为 NULL。

### 8.2 按轮删

- 删中间一轮：前后轮仍在；模型下一请求看不到该轮。
- 删末轮、删仅有 user 无 assistant、连续删多轮（每轮新 batch；撤销只恢复最近 batch）。

### 8.3 清空

- 有消息：清空后线程仍在、列表空；撤销同 batch 全部恢复。
- 空清空：`batchId === null`，库不变，UI 无撤销条；不得调用 `restoreBatch`。
- 已软删行不被第二次 clear 再改 batch（只处理活跃行）。

### 8.4 撤销

- 10s 内撤销成功；伪造 batch / 跨项目 / 跨线程 / `batchId` 命中 0 行 → `success: false`。
- 新一次删除后，UI 只挂最近一次 pending undo；旧 batch 无按钮（行可保持软删）。
- 切项目后的迟到回执不更新当前 UI（§5.0 项目守卫）。
- 清理在飞时第二次点击不发起 IPC；成功回执不得被丢弃（禁止 cleanupEpoch 式「只认最新代次」）。

### 8.5 过滤

- `findByProject`、聊天 UI、组装 history 单测/回归：软删不出现。
- 直接 SQL 可见软删行仍在；带 `source_message_id` 的决策仍能 join 到消息行。

### 8.6 流式互斥

- 生成中：删/清空/切会话按钮 disabled 或 handler 早退，**无 IPC 写库**。
- cancel 后再操作成功。
- 不要求、也不测试「Main 因流式而拒绝」。

### 8.7 删整会话

- 二次确认后硬删；消息物理消失；决策来源置空（现有行为）。

### 8.8 本轮不测

- 关应用后的撤销（明确无此功能）。
- 按章隔离。
- 回收站浏览软删消息。

---

## 9. 非目标与后续

| 项 | 处置 |
|---|---|
| 完整回收站 / 长期恢复 | 延期；真需要时另 Spec |
| 按章绑定（原 A/B） | 不做；跨章靠清理 |
| 消息硬删除 / 定期 purge | 不做 |
| 软删自动撤销创作决策 | 不做 |
| #146 新章 before_target 语义 | 独立任务，不在本 Spec |

---

## 10. 实施顺序（供后续 plan，本轮不编码）

0. **#145 合入 master 后**，从最新 master 开新分支（勿在 `codex/renderer-typecheck` 上继续编码）。
1. 迁移 v22 + repo 过滤改造（先让所有读路径 fail-closed 过滤）。
2. `deleteTurn` / `clearThread`（含空清空 `batchId: null`）/ `restoreBatch` + 单测。
3. IPC 注册 + 共享结果类型（`batchId: string | null`）。
4. `AIChatPanel`：按轮删、清空（无确认）、10s 撤销条、流式禁用、项目守卫、清理单飞互斥。
5. 回归：现有会话加载 / 决策账本来源；`typecheck:renderer` + 全量测试。

---

## 11. 开放问题（已关闭）

| 问题 | 决议 |
|---|---|
| 绑不绑章？ | **C 不绑** |
| 按轮还是单条？ | **整轮（user + 至下一 user 前的回复）** |
| 硬删还是软删？ | **软删 + 10s 撤销** |
| 关应用后能否撤销？ | **否** |
| 清空是否保留壳？ | **是** |
| 清空要不要确认？ | **不要**；仅删整会话二次确认 |
| 流式中能否删？ | **否，先取消**；门闩仅渲染端 |
| 空清空如何撤销？ | **不产生 batch**；`batchId: null`，无撤销条 |
| 公开类型是否暴露软删字段？ | **否**；仅仓储内部行类型 |
| 连点/并发怎么防？ | **单飞互斥**，不用会丢成功回执的 cleanupEpoch |
| DDL 是否加 CHECK？ | **否**；应用层 + 单测保证 |