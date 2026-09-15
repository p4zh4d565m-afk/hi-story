# AI 对话清理设计（方案 4 · 软删除 + 短时撤销，2026-09-15）

> **效力：** 本文是「AI 对话隔离与清理」产品拍板后的**施工 Spec**。  
> **前置：** #145 renderer 全量类型检查门槛已合入分支 `codex/renderer-typecheck`（`25d96ce`）；叙事时间 fail-closed 已在 master。  
> **本轮授权范围：** 项目级会话（**不绑章**）+ 消息软删除 + 约 10 秒撤销 + 清空/按轮删/删整会话。  
> **本轮不做：** 按章强制隔离、完整回收站 UI、关应用后恢复、消息硬删除、编辑消息、会话重命名大改。

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
7. **流式互斥合同**：正在流式生成时，**禁止**按轮删、清空、切换会话；须先取消生成，再允许操作。
8. **创作决策来源**：软删保留 `conversation_messages` 行，使 `creative_decisions.source_message_id` 外键**不断裂**。软删**不**自动撤回已确认决策投影（另立账本路径）。
9. **删整会话例外**：`removeThread` 继续物理删除线程（CASCADE 消息）；`source_message_id` 现有 `ON DELETE SET NULL` 行为不变。本轮不改成会话级软删。

---

## 2. DDL 合同（迁移 v22）

库版本 **21 → 22**，单事务。

### 2.1 `conversation_messages` 新增列

| 列 | 类型 | 说明 |
|---|---|---|
| `deleted_at` | TEXT NULL | 非空 = 已软删；`NULL` = 活跃 |
| `deletion_batch_id` | TEXT NULL | 同一次「按轮删」或「清空」共享同一 UUID；活跃行必须为 NULL |

约束（应用层保证，必要时 CHECK）：

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
- 当前无进行中的该会话流式生成（渲染端强制；主进程可再拒一次）。

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

前置同归属校验 + 无流式。

行为（**单事务**）：

1. 将该线程所有 `deleted_at IS NULL` 的消息标上同一新 `deletion_batch_id` 与 `deleted_at`。
2. **不**删除 `conversation_threads` 行。
3. 若无可删活跃消息：仍 `success: true`，返回新 `batchId` 与空 `deletedMessageIds`（便于 UI 统一处理；撤销对空批为 no-op 成功或「批次不存在」——实施时固定为 **restore 空批 → success + empty restored ids**）。
4. 返回形态同 `deleteTurn`。

### 3.3 `restoreBatch(projectId, threadId, batchId)`

前置：

- 线程属于项目。
- 存在至少一条该线程消息：`deletion_batch_id = batchId` 且 `deleted_at IS NOT NULL`。

行为（**单事务**）：

1. 将这些行的 `deleted_at`、`deletion_batch_id` 置回 `NULL`。
2. 更新线程 `updated_at`。
3. 返回恢复后的消息 id 列表（或完整活跃快照片段）。

拒绝：

- 批次不存在 / 不属于该线程 / 项目不匹配。
- **不**要求服务端感知「10 秒」——时效由渲染端 UI 控制；过期后 UI 不再调用。关应用后本地不持久化 pending undo，故自然无法撤销。

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

### 5.1 按轮删除

- 以「一轮」为操作单元：UI 挂在该轮 user 气泡或轮次容器上（文案：「删除本轮」）。
- 成功后立即从本地 state 移除对应消息；弹出约 **10s**「已删除 · 撤销」。
- 撤销调用 `restoreBatch`；成功则插回原相对顺序（按 `sort_order` 重载该线程消息最稳）。

### 5.2 清空当前会话

- 独立入口（如会话菜单「清空消息」），与「删除会话」分开。
- 建议轻确认（避免误触）；成功后同样 10s 批次撤销。
- 清空后会话壳与标题保留；列表仍显示该线程。

### 5.3 删除整个会话

- 沿用现有 `×` + confirm + `removeThread`（及现有 localStorage 回收站逻辑若仍在，本轮不强制改）。
- **无** 10s 消息级撤销（整会话硬删）。

### 5.4 流式互斥

当 `generating / streaming === true`（该面板当前流）：

- 禁用：按轮删、清空、切换 `activeThreadId`、新建会话切换焦点（至少禁止切走当前线程）。
- 允许：停止生成（现有 cancel）。
- 停止并确认流结束后，才解锁删除类操作。

### 5.5 关应用

- pending undo **只活在内存**（React state）；不写 `localStorage`。
- 关应用 / 刷新 / 切项目导致组件卸载 → 撤销条消失；软删行保持 `deleted_at` 非空。

### 5.6 新建 / 切换

- 现有能力保留；本轮可做小幅可见性加强，但不绑章、不自动按章建会话。

---

## 6. IPC 合同（建议名）

| Channel | 入参 | 成功 data |
|---|---|---|
| `db:conversation:deleteTurn` | `{ projectId, threadId, userMessageId }` | `{ batchId, threadId, deletedMessageIds, deletedAt }` |
| `db:conversation:clearThread` | `{ projectId, threadId }` | 同上（ids 可为该批全部） |
| `db:conversation:restoreBatch` | `{ projectId, threadId, batchId }` | `{ batchId, threadId, restoredMessageIds }` |
| 现有 `removeThread` / `createThread` / `findByProject` / `appendMessage` | 不变；`findByProject` 过滤软删 |

全部返回 `IpcResult<T>`；失败不部分提交。

---

## 7. 类型合同

`ConversationMessage` 增加可选或必填：

- `deletedAt: string | null`（对外快照可省略该字段——因为默认不返回软删行；内部 row 映射需要）
- `deletionBatchId: string | null`

对外 `ConversationSnapshot` **仍可不暴露**已删消息；测试可用内部/测试专用查询断言软删行仍在。

---

## 8. 验收矩阵

### 8.1 迁移

- v21→v22 成功；中途失败回滚；旧消息 `deleted_at` / `deletion_batch_id` 均为 NULL。

### 8.2 按轮删

- 删中间一轮：前后轮仍在；模型下一请求看不到该轮。
- 删末轮、删仅有 user 无 assistant、连续删多轮（每轮新 batch；撤销只恢复最近 batch）。

### 8.3 清空

- 清空后线程仍在、消息列表空；撤销同 batch 全部恢复。
- 已软删行不被第二次 clear 再改 batch（只处理活跃行）。

### 8.4 撤销

- 10s 内撤销成功；伪造 batch / 跨项目 / 跨线程失败。
- 新一次删除后，旧 batch 仍可被 API 恢复，但 UI 只挂最近一次——**产品**：UI 只保留一个 pending undo；新删覆盖提示条（旧 batch 不提供按钮，行保持软删）。

### 8.5 过滤

- `findByProject`、聊天 UI、组装 history 单测/回归：软删不出现。
- 直接 SQL 可见软删行仍在；带 `source_message_id` 的决策仍能 join 到消息行。

### 8.6 流式互斥

- 生成中点击删/清空/切会话：无写库、有提示或按钮 disabled。
- cancel 后再操作成功。

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

1. 迁移 v22 + repo 过滤改造（先让所有读路径 fail-closed 过滤）。
2. `deleteTurn` / `clearThread` / `restoreBatch` + 单测。
3. IPC 注册 + 类型。
4. `AIChatPanel`：按轮删、清空、10s 撤销条、流式禁用。
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
| 流式中能否删？ | **否，先取消** |
