# AI 会话持久化到 SQLite 设计

## 范围

本次只把 AI 对话线程及消息从 localStorage 主存迁入 SQLite，保留现有多线程、搜索、删除和流式显示体验。不迁移 AI 配置、用量统计、快捷动作信号或回收站，也不实现“创作决策确认账本”。不得删除旧聊天记录。

## 数据模型

复用已有 `conversation_threads` 和 `conversation_messages`，通过迁移 v17 补齐：

- 线程：现有 `id`、`project_id`、`title`、`category`、`created_at`，新增 `updated_at`；新消息写入时更新线程时间。
- 消息：现有 `id`、`thread_id`、`role`、`content`、`provider_id`、`timestamp`，新增 `updated_at`、`sort_order`、`context_type`。
- 迁移状态：新增 `data_migration_state`，以 `project_id + migration_key` 唯一标识一次性数据迁移。

`category` 继续表示会话功能分类（人物、情节、世界、通用）；`context_type` 记录消息来源，例如普通聊天 `chat`、续写入口 `continue`。消息读取按 `sort_order`、创建时间和 ID 稳定排序。所有线程查询必须带项目 ID，消息操作必须验证线程归属。

## 组件与数据流

主进程新增会话 Repository 和 IPC，负责线程创建、删除、项目快照读取、消息追加及旧数据事务导入。渲染端新增独立持久化服务，把 IPC 结果转换为当前 `ThreadData`，并用“项目 ID + 请求代次”隔离异步加载。

项目切换时立即隐藏上一项目快照，再加载新项目；迟到的成功或失败都不能写入当前界面。同一项目刷新失败时保留现有快照并显示错误，不以空数组伪装成功。

发送流程：

1. 用户消息先写入 SQLite，成功后进入正式消息列表并发起现有 AI 流式调用。
2. AI token 只写入临时 `streamingText`，保持现有逐字体验。
3. 流正常结束且得到完整内容后，追加一条 assistant 消息。
4. 流中断或失败时只显示错误，不创建完整 assistant 消息；已经可靠保存的用户消息保留。
5. assistant 落库失败时显示保存错误，不把该回复宣称为已持久化成功。

线程创建、删除和搜索改为使用 SQLite 快照；正常的新会话记录不再写入项目聊天 localStorage。

## 一次性兼容迁移

每次项目首次加载时读取旧键 `hi-story-threads-{projectId}`：

- 没有旧数据时记录该项目已检查，随后读取 SQLite。
- 有合法旧数据时，将线程、消息及原时间戳按原数组顺序在一个 SQLite 事务中导入，再写迁移状态。
- 已有迁移状态时跳过导入，防止重复。
- JSON 解析、校验或数据库写入失败时不记录完成状态，并保留 localStorage 原值。
- 即使导入成功也不主动删除旧 localStorage，作为兼容备份；后续读取以 SQLite 为准。

迁移 API 返回“已导入 / 已迁移 / 无数据”状态，便于测试和诊断。

## 错误处理与兼容

- 数据加载错误必须在 AI 面板显示；已有同项目会话保持不变。
- 项目切换期间旧请求回执全部忽略，不能显示其他项目记录。
- 线程或用户消息写入失败时不继续制造无法持久化的 AI 对话链。
- AI 流失败不写 assistant 成功记录，临时流内容不冒充历史消息。
- 旧表和旧记录只做增量迁移，不删除、不重建。

## 测试与验收

自动测试覆盖：线程创建和项目读取、项目隔离、消息稳定顺序、线程更新时间、旧 localStorage 数据只导入一次、导入失败不写迁移状态且调用方保留旧值、项目切换竞态、加载失败不清空当前快照、流失败不提交 assistant 消息。最后运行完整 Vitest、`npm run build`、相关 Electron UI 回归及 `git diff --check`。
