# 写章状态机与审稿版本账本设计

> 状态：评审草案 v0.1
>
> 本文档可以修改，不是不可变合同，也不代表已经批准开发。另一位开发者评审后，可以调整数据表、接口、实施顺序和验收标准；只有用户明确批准修订后的 Spec，才进入实施计划与编码阶段。

## 一句话目标

把 hi-story 目前由渲染端、`setTimeout` 和 `localStorage` 串联的 AI 写章流程，改造成可取消、可恢复、可核验、原子提交的持久化任务；同时把 AI 审稿保存为与正文版本绑定的账本，确保旧审稿和旧修订不能冒充当前正文的有效结论。

## 给非技术用户的说明

本功能主要解决四种风险：

1. 用户点击“停止生成”后，后台实际上仍继续生成甚至保存。
2. 界面显示“保存成功”，但正文或后续事实可能尚未真正写入数据库。
3. 正文、摘要、事实、人物知识和叙事钩子分批写入，某一步失败会留下半套数据。
4. 一份审稿报告针对旧正文生成，正文修改后仍可能被误认为有效；旧修订也可能覆盖作者的新内容。

完成后，每次 AI 写章都有一张可追踪的“运行单”，每份审稿报告都标明自己审的是哪一版正文。

## 当前实现与问题依据

### 写章链路

当前主要逻辑位于：

- `src/renderer/components/AIWritePanel.tsx`
- `src/renderer/App.tsx`
- `src/main/ipc/ai.ipc.ts`
- `src/main/db/repositories/chapter.repo.ts`

已确认的问题：

- `AIWritePanel.handleStop` 只把 React 的 `generating` 改为 `false`，没有中止主进程或供应商请求。
- 批量生成调用 `onSaveAsChapter` 后立即记录 `saved: true`，没有等待明确的保存结果。
- `App.tsx` 创建章节后使用延迟查询寻找排序最大的章节，再继续写正文，存在并发创建时指向错误章节的可能。
- 摘要、事实和人物知识通过全局键 `hi-story-pending-summary` 暂存，再用多个 `setTimeout` 写入；它没有项目、章节和请求代次组成的稳定身份。
- 正文、摘要、事实、人物知识和叙事钩子不是同一个 SQLite 事务，失败时无法整体回滚。

### 审稿链路

当前主要逻辑位于：

- `src/renderer/components/AIReviewPanel.tsx`
- `src/renderer/services/ai-prompts/review.ts`
- `src/renderer/types/index.ts`

已确认的问题：

- 审稿结果只存在组件状态中，关闭面板或退出应用后不能可靠追溯。
- 报告没有绑定正文内容 SHA，无法判断报告是否已因正文变化而过期。
- 当前提示词要求“没有问题时给 90 分以上”，没有区分“检查过且通过”和“因上下文不足无法检查”。
- 自动修订应用前不比较当前正文与审稿时正文，可能覆盖作者在审稿后进行的新编辑。
- 应用修订后没有强制进入“待复评”，无法证明问题已经解决且没有引入新问题。

## 范围

本期包含：

- 写章运行及阶段状态持久化。
- AI 流真正取消和迟到结果拒绝。
- 正文、摘要、事实、人物知识、叙事钩子的原子提交。
- 写章失败后的重试或明确“仅保存正文”。
- 审稿报告持久化。
- 审稿覆盖率、质量分、硬门禁和交付状态分离。
- 审稿与修订绑定精确正文版本。
- 过期审稿、过期修订和应用后待复评状态。
- 项目切换与迟到回执隔离。
- 单元测试、主进程集成测试和真实 Electron UI 回归。
- 更新 `AGENTS.md` 中的架构说明和已实现功能。

本期不包含：

- 正文选区批注和高亮。
- 审稿 DAG 或图形化节点界面。
- 分层上下文压缩。
- 多模型基准测试。
- 自动连续批量写完整本小说。
- Python、DSH、HTTP 后端或新的前端框架。
- 更换 TipTap、SQLite 或现有 AI Provider。
- Obsidian 写回；Obsidian 继续保持只读。

## 方案选择

### 采用方案：渲染端组装创作请求，主进程拥有运行状态、AI 生命周期和数据库提交

保留现有 React 面板和提示词构建方式，减少一次性重构范围。渲染端提交结构化请求，主进程负责：

- 创建运行记录；
- 调用 AI Provider；
- 保存阶段结果；
- 管理取消控制器；
- 校验状态转换；
- 执行最终 SQLite 事务；
- 持久化审稿与修订。

渲染端不能直接把运行标记为完成，也不能再用多个 IPC 拼接一次提交。

### 未采用方案一：继续由渲染端编排，只新增几张日志表

改动较小，但渲染端仍可能在请求、项目切换、延迟定时器和数据库写入之间产生竞态，不能解决本功能的核心问题。

### 未采用方案二：把全部上下文构建和提示词系统一次性搬到主进程

长期架构更统一，但会同时牵涉创作罗盘、风格指纹、Obsidian 上下文和多个现有面板，超出本期 P0 范围。后续可以在不改变本 Spec 数据契约的前提下继续迁移。

## 核心术语

- **正文版本**：章节 `content` 原始字符串按 UTF-8 计算的 SHA-256，格式固定为 `sha256:<64 位小写十六进制>`。不去 HTML、不合并空白；任何字节变化都产生新版本。
- **运行**：一次 AI 写章任务，从准备上下文开始，到提交、失败或取消结束。
- **阶段**：运行内部可独立判断成功或失败的步骤。
- **迟到结果**：用户取消、项目切换或运行终止后，供应商仍返回的 Token、完成回调或错误回调。
- **覆盖率**：本次审稿得到有效判断的维度数除以全部 15 个维度。
- **硬门禁**：是否存在必须阻止交付的严重问题。
- **过期审稿**：报告记录的正文版本与当前正文版本不同。
- **待复评**：修订已经应用，但修订后的正文尚未产生一份有效且通过的当前版本审稿。

## 总体数据流

### 写章

1. 用户点击生成，渲染端提交项目、目标标题、大纲来源、提示消息和本次模型配置。
2. 主进程验证项目仍存在，创建 `chapter_runs` 和固定阶段记录。
3. 主进程计算完整 AI 消息的输入 SHA，启动流式请求，并把 Token 发回当前窗口。
4. 流正常结束后，主进程保存完整草稿并完成 `draft` 阶段；空回复、取消和失败均不得完成该阶段。
5. 用户点击保存后，主进程执行事实抽取、结构校验和原子提交。
6. 原子提交一次性写入章节、摘要、事实、人物知识与叙事钩子，并返回新章节的真实 ID。
7. 渲染端只在成功回执后显示“已保存”并选中新章节。

### 审稿和修订

1. 用户选择章节并开始审稿。
2. 主进程读取当前正文并计算 `source_revision`。
3. AI 返回后，主进程验证 15 个维度及问题结构，再保存不可变审稿记录。
4. 每次读取报告时，主进程重新计算当前正文版本；不一致时返回 `freshness_status = stale`。
5. 用户生成自动修订时，提案保存审稿 ID 和审稿正文版本。
6. 应用提案时，在同一个事务中比较当前正文版本；不一致则拒绝覆盖。
7. 修订应用成功后，提案记为 `applied`，旧审稿自然过期，界面显示“待复评”。
8. 只有修订后正文重新审稿并达到交付条件，才显示“当前版本通过”。

## 写章状态机

### 固定阶段

| 阶段 | 用途 | 成功产物 |
| --- | --- | --- |
| `context` | 固定本次输入、项目、大纲目标和提示消息版本 | 输入 SHA 与上下文摘要 |
| `draft` | 流式生成正文 | 非空完整草稿及正文 SHA |
| `fact_extract` | 生成摘要、事实、人物知识和叙事钩子候选 | 通过结构校验的 JSON |
| `validate` | 检查草稿、项目归属、目标和抽取结果 | 验证报告 |
| `commit` | 在单一 SQLite 事务内正式写入 | 真实章节 ID 与正文版本 |

`review` 不作为写章提交的前置条件，审稿由独立账本记录；若写章后自动发起审稿，`chapter_reviews.run_id` 用于关联来源运行。

### 运行状态

- `running`：至少一个阶段正在进行。
- `drafted`：草稿已完整生成，等待用户保存或继续处理。
- `committed`：正文和附属数据已原子提交。
- `failed`：某阶段失败，任务暂停；草稿和已完成阶段仍可用于在同一运行内重试。
- `cancelled`：用户取消，后续回调均拒绝。

`committed` 和 `cancelled` 是不可逆终态；`failed` 是可重试的暂停状态。`drafted` 是可恢复的等待状态，不视为保存成功。

### 状态约束

- 阶段只能按表中顺序推进；重试只能从第一个 `failed` 阶段开始。
- 已完成阶段输入 SHA 未变化时可以复用；输入变化后从变化点起的后续阶段全部重置为 `pending`。
- `commit` 成功后不得再次提交同一运行；重复调用返回原章节 ID，不创建重复章节。
- `failed` 运行在输入未变化时原地重试失败阶段并增加 `attempts`；输入变化时创建新运行，并用 `retry_of_run_id` 关联旧运行。
- `cancelled` 运行不能恢复为 `running`。需要重新生成时创建新运行，并用 `retry_of_run_id` 关联旧运行。
- 所有修改运行状态的 IPC 同时校验 `projectId + runId`，不能只凭运行 ID。

## AI 流取消契约

### Provider 接口

`ChatOptions` 增加可选字段：

```ts
export interface ChatOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  signal?: AbortSignal;
}
```

Claude 与 OpenAI-compatible Provider 都必须把 `signal` 传给底层 SDK 或 `fetch`。取消应归一为明确错误码 `AI_STREAM_CANCELLED`，不能显示为普通网络失败。

### 主进程流注册表

主进程维护仅存在于进程内的：

```ts
Map<string, {
  controller: AbortController;
  senderId: number;
  projectId: string;
  runId: string;
  terminal: boolean;
}>
```

约束：

- API Key、完整提示词和正文不得写入该 Map 的日志。
- `ai:cancelStream` 必须同时匹配 `streamId`、`projectId` 和 `runId`。
- 取消时先在数据库设置 `cancel_requested = 1`，再调用 `abort()`。
- 每个 Token、完成和错误回调发送前都重新检查运行状态。
- `onComplete` 与 `onError` 只能有一个成为终态；完成后移除注册表记录。
- Electron 窗口销毁时，中止该窗口拥有的所有流，并把对应运行记为 `cancelled` 或 `failed`，不得留下永久 `running`。

## 数据模型

本功能使用迁移 **v20**。迁移 DDL 和 `_migrations` 的 v20 登记继续由现有迁移框架放在同一个 SQLite 事务中。

### `chapter_runs`

```sql
CREATE TABLE chapter_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  retry_of_run_id TEXT,
  source_outline_node_id TEXT,
  target_chapter_id TEXT,
  requested_title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN (
    'running','drafted','committed','failed','cancelled'
  )),
  cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK(cancel_requested IN (0,1)),
  provider_name TEXT NOT NULL DEFAULT '',
  model_name TEXT NOT NULL DEFAULT '',
  input_revision TEXT NOT NULL DEFAULT '',
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (retry_of_run_id) REFERENCES chapter_runs(id) ON DELETE SET NULL,
  FOREIGN KEY (target_chapter_id) REFERENCES chapters(id) ON DELETE SET NULL
);

CREATE INDEX idx_chapter_runs_project_updated
  ON chapter_runs(project_id, updated_at DESC);
```

`source_outline_node_id` 只保存来源标识，不增加外键，避免删除或重建大纲后破坏历史运行。

### `chapter_run_stages`

```sql
CREATE TABLE chapter_run_stages (
  run_id TEXT NOT NULL,
  stage_name TEXT NOT NULL CHECK(stage_name IN (
    'context','draft','fact_extract','validate','commit'
  )),
  status TEXT NOT NULL CHECK(status IN (
    'pending','running','completed','failed','cancelled','skipped'
  )),
  input_revision TEXT NOT NULL DEFAULT '',
  output_revision TEXT NOT NULL DEFAULT '',
  output_json TEXT,
  usage_json TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  error_code TEXT,
  error_message TEXT,
  started_at TEXT,
  completed_at TEXT,
  PRIMARY KEY (run_id, stage_name),
  FOREIGN KEY (run_id) REFERENCES chapter_runs(id) ON DELETE CASCADE
);
```

`output_json` 只允许保存本阶段恢复所需产物：`draft` 保存完整草稿，`fact_extract` 保存结构化抽取，`validate` 保存验证摘要，`commit` 保存章节 ID 和正文版本。`context` 不保存 API Key，也不保存完整 Provider 配置。

### `chapter_reviews`

```sql
CREATE TABLE chapter_reviews (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  run_id TEXT,
  source_revision TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  provider_name TEXT NOT NULL DEFAULT '',
  model_name TEXT NOT NULL DEFAULT '',
  execution_status TEXT NOT NULL CHECK(execution_status IN (
    'completed','failed','cancelled'
  )),
  quality_score REAL,
  coverage REAL NOT NULL DEFAULT 0 CHECK(coverage >= 0 AND coverage <= 1),
  gate_status TEXT NOT NULL CHECK(gate_status IN (
    'pass','blocked','inconclusive'
  )),
  delivery_status TEXT NOT NULL CHECK(delivery_status IN (
    'pass','revise','blocked','inconclusive'
  )),
  summary TEXT NOT NULL DEFAULT '',
  dimensions_json TEXT NOT NULL DEFAULT '[]',
  issues_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
  FOREIGN KEY (run_id) REFERENCES chapter_runs(id) ON DELETE SET NULL
);

CREATE INDEX idx_chapter_reviews_chapter_created
  ON chapter_reviews(chapter_id, created_at DESC);
```

审稿记录写入后不可修改。`freshness_status` 不持久化，每次读取时由 `source_revision` 与当前正文 SHA 动态计算，避免正文更新和审稿更新分属两个事务造成漂移。

### `chapter_revision_proposals`

```sql
CREATE TABLE chapter_revision_proposals (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  review_id TEXT NOT NULL,
  source_revision TEXT NOT NULL,
  proposed_content TEXT NOT NULL,
  proposed_revision TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN (
    'proposed','applied','rejected','stale'
  )),
  applied_revision TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  applied_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
  FOREIGN KEY (review_id) REFERENCES chapter_reviews(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_chapter_revision_one_pending
  ON chapter_revision_proposals(chapter_id)
  WHERE status = 'proposed';
```

同一章节最多存在一个待处理自动修订，避免两个旧草稿竞争覆盖正文。已应用、拒绝或过期的历史不删除。

## 审稿判定规则

### 维度结果

现有 15 个审稿维度保持不变。每个维度增加：

```ts
type ReviewDimensionStatus = 'pass' | 'issue' | 'inconclusive';

interface ReviewDimensionV2 {
  id: number;
  name: string;
  status: ReviewDimensionStatus;
  score: number | null;
  comment: string;
  evidence: string[];
}
```

规则：

- `pass` 和 `issue` 必须有明确判断；发现问题时必须提供正文证据。
- `inconclusive` 的 `score` 必须为 `null`，并说明缺少什么上下文。
- 缺失、重复或未知维度 ID 均视为结构错误，不能伪装成完整审稿。

### 聚合

```text
coverage = 有效维度数 / 15
quality_score = 所有非 inconclusive 维度 score 的算术平均值
```

精确判定：

- AI 请求或 JSON 解析失败：`execution_status = failed`、`gate_status = inconclusive`、`delivery_status = inconclusive`。
- 任一问题 `severity = critical`：`gate_status = blocked`、`delivery_status = blocked`。
- `coverage < 1`：`gate_status = inconclusive`、`delivery_status = inconclusive`。
- 覆盖率为 1、无 critical 且 `quality_score >= 70`：`gate_status = pass`、`delivery_status = pass`。
- 覆盖率为 1、无 critical 且 `quality_score < 70`：`gate_status = pass`、`delivery_status = revise`。

查询时如果正文版本不一致，对外返回 `freshness_status = stale` 和 `effective_delivery_status = stale`；数据库内原始 `delivery_status` 不修改，用于历史审计。`effective_delivery_status` 的类型为数据库四种状态再加 `stale`。

## 原子提交契约

`ChapterRunService.commit` 必须在一个 `better-sqlite3` 写事务中：

1. 重新读取运行并校验项目、状态、取消标记和阶段状态。
2. 校验草稿输出 SHA 与阶段记录一致。
3. 创建新章节或更新明确指定的目标章节，并取得真实章节 ID。
4. 写入摘要。
5. 写入本章自动抽取的事实。
6. 写入本章人物知识。
7. 把抽取中的 hook 同步到 `narrative_hooks`。
8. 完成 `commit` 阶段并把运行标记为 `committed`。

任一步抛错时正式数据和 `commit` 成功状态全部回滚。事务回滚后，服务再用独立的最小写入把运行标记为 `failed/COMMIT_ROLLED_BACK`；如果连这次错误状态写入也失败，运行保持原来的 `drafted`，但绝不能显示或返回提交成功。完整草稿和抽取结果仍在阶段记录中，用户可以重试。

如果事实抽取持续失败，界面提供“仅保存正文”操作。该操作必须由用户明确点击，并把 `fact_extract` 标记为 `skipped`；它仍通过同一事务保存正文，但摘要保持空值，也不写事实、人物知识和叙事钩子，不得由系统静默降级。界面必须明确提示这些缺失项。

## 修订应用契约

应用修订必须在单个写事务中：

1. 校验提案属于当前项目和章节，且状态为 `proposed`。
2. 读取当前章节并计算正文 SHA。
3. 当前 SHA 不等于 `source_revision` 时，把提案标记为 `stale`，返回 `REVISION_SOURCE_STALE`，不得修改正文。
4. 保存当前正文到现有 `chapter_history`。
5. 写入提案正文和新的字数、更新时间。
6. 计算并保存 `applied_revision`，将提案标记为 `applied`。

旧审稿不需要更新，因为动态新鲜度判断会立即将其显示为过期。章节界面进入“待复评”。

## IPC 契约

所有 IPC 继续返回现有 `IpcResult<T>`，失败必须包含稳定错误码和中文消息。建议数据形态为：

```ts
interface DomainError {
  code: string;
  message: string;
  recoverable: boolean;
}
```

### 写章

- `workflow:chapterRun:start`：创建运行并开始流式生成，返回 `{ runId, streamId }`。
- `workflow:chapterRun:get`：按 `projectId + runId` 读取运行和阶段。
- `workflow:chapterRun:list`：读取当前项目最近运行。
- `workflow:chapterRun:cancel`：持久化取消并中断真实 AI 流。
- `workflow:chapterRun:extract`：运行事实抽取和结构校验。
- `workflow:chapterRun:commit`：原子提交全部结果。
- `workflow:chapterRun:commitDraftOnly`：用户明确选择后仅提交正文。
- `workflow:chapterRun:retry`：输入未变化时在同一运行内重试首个失败阶段；输入变化或旧运行已取消时拒绝，并要求调用 `start` 创建带 `retryOfRunId` 的新运行。

### 审稿

- `workflow:chapterReview:run`：针对当前正文运行并保存审稿。
- `workflow:chapterReview:list`：返回历史及动态 `freshnessStatus`。
- `workflow:chapterReview:createRevision`：根据审稿生成并持久化修订提案。
- `workflow:chapterReview:applyRevision`：正文 SHA 校验后应用。
- `workflow:chapterReview:rejectRevision`：拒绝待处理提案。

渲染端不得再通过 `db:chapter:create`、延迟查询、`db:chapter:update`、事实 IPC 和钩子 IPC 拼装 AI 写章提交。

## 项目切换和并发

- 每个请求携带 `projectId`，主进程根据数据库重新校验运行、章节、审稿和提案归属。
- 渲染端复用现有“项目 ID + 请求代次”守卫；切换项目时立即清空当前流、运行、审稿和修订的可见状态。
- 项目切换不自动取消旧项目运行，但旧 Token 不得显示在新项目；用户关闭窗口或明确停止时才取消。
- 同一运行只允许一个活跃 AI 流。
- 同一章节同一时刻只允许应用一个修订提案。
- 写章提交和修订应用均使用 SQLite 写事务，不依赖 React 状态判断唯一性。

## 错误码

至少提供：

| 错误码 | 含义 | 是否可重试 |
| --- | --- | --- |
| `RUN_NOT_FOUND` | 写章运行不存在 | 否 |
| `RUN_PROJECT_MISMATCH` | 运行不属于当前项目 | 否 |
| `INVALID_STAGE_TRANSITION` | 阶段顺序错误 | 否 |
| `RUN_ALREADY_COMMITTED` | 运行已经提交 | 返回原结果 |
| `AI_STREAM_CANCELLED` | 用户取消 AI 流 | 否，需新建运行 |
| `LATE_RESULT_REJECTED` | 取消或终止后的迟到结果 | 否 |
| `EMPTY_DRAFT` | AI 没有返回有效正文 | 是 |
| `FACT_EXTRACTION_INVALID` | 摘要或事实结构无效 | 是或仅保存正文 |
| `COMMIT_ROLLED_BACK` | 原子提交失败并已回滚 | 是 |
| `REVIEW_RESPONSE_INVALID` | 审稿结构无效 | 是 |
| `REVIEW_SOURCE_STALE` | 审稿启动时正文已变化 | 是 |
| `REVISION_SOURCE_STALE` | 修订针对的正文已经变化 | 否，需重新生成修订 |

错误日志不得包含 API Key、Authorization 头或完整 Provider 配置。正文和提示词只保存在用户本地数据库，不写入普通控制台错误日志。

## 界面要求

### AI 写作面板

- 显示当前阶段：准备、生成正文、提取事实、验证、提交。
- “停止生成”必须等待主进程确认取消；取消成功后显示“已停止，不会保存”。
- 只有 `commit` 成功才能显示“已保存”。
- 失败时显示失败阶段、可读原因和“重试”。
- 事实抽取失败时额外提供“仅保存正文”，并显示缺失事实更新的影响。
- 批量写章逐章显示真实状态，不能预先显示成功。
- 应用重启后可以读取未完成运行：`drafted` 可继续保存，`running` 统一恢复为 `failed`，错误码为 `PROCESS_INTERRUPTED`，不得自动重放付费请求。

### AI 审稿面板

- 默认展示当前正文最新一份审稿。
- 明确显示：当前、过期、待复评、失败。
- 分别显示质量分、覆盖率、硬门禁和交付状态。
- 过期报告允许查看历史，但不能显示“当前版本通过”。
- 只能从当前正文对应的审稿生成修订。
- 修订应用冲突时保留修订预览，并提示作者正文已变化；不得自动覆盖。
- 修订应用成功后显示“待复评”，提供“重新审稿”。

## 预计文件边界

以下是评审用的建议边界，不要求文件名绝对不变，但职责不能重新混杂到一个巨型组件：

### 新增

- `src/main/db/repositories/chapter-run.repo.ts`：运行与阶段持久化、状态转换。
- `src/main/db/repositories/chapter-review.repo.ts`：审稿与修订提案持久化、新鲜度查询。
- `src/main/services/chapter-run.service.ts`：AI 生命周期、事实抽取、验证、原子提交。
- `src/main/services/chapter-review.service.ts`：审稿、聚合、修订生成与应用。
- `src/main/ai/stream-registry.ts`：AbortController 与终态互斥。
- `src/main/utils/content-revision.ts`：统一正文与输入 SHA-256。
- `src/main/ipc/chapter-workflow.ipc.ts`：写章和审稿工作流 IPC。
- `src/renderer/services/chapter-run-loader.ts`：项目 ID + 代次守卫。
- `src/renderer/services/chapter-review-loader.ts`：项目 ID + 代次守卫。
- `tests/unit/chapter-workflow/`：迁移、仓储、状态机、取消、事务和审稿聚合测试。
- `tests/ui/run-chapter-workflow.cjs`：真实 Electron 回归入口。

### 修改

- `src/main/db/migrations.ts`：增加 v20。
- `src/main/ai/provider.ts`：增加 `AbortSignal`。
- `src/main/ai/providers/claude.ts`：传递取消信号。
- `src/main/ai/providers/generic-openai.ts`：传递取消信号。
- `src/main/ipc/ai.ipc.ts`：接入流注册与迟到回调防护。
- `src/main/ipc/index.ts` 或实际 IPC 注册入口：注册工作流 IPC。
- `src/renderer/components/AIWritePanel.tsx`：改用工作流状态，不再直接编排保存。
- `src/renderer/components/AIReviewPanel.tsx`：读取持久化账本和修订状态。
- `src/renderer/App.tsx`：删除 AI 写章的 `setTimeout + localStorage` 中转。
- `src/renderer/types/index.ts`：增加运行、阶段、审稿 v2 和修订类型。
- `src/renderer/types/electron.d.ts`：补充 IPC 类型。
- `src/preload/index.ts`：如果存在显式白名单则补充 channel；保持最小桥接原则。
- `AGENTS.md`：记录新架构、关键约束和真实验证命令。

## 数据迁移与兼容

- v20 只新增表和索引，不删除、不重写现有章节、历史版本、事实、知识、钩子或审稿 UI 数据。
- 现有项目首次启动后可以立即正常编辑；没有历史审稿记录时显示空状态。
- 不迁移旧组件内存中的审稿结果，因为它们从未持久化且没有可靠正文版本。
- 不迁移 `hi-story-pending-summary` 内容。新版本启动时应删除该旧临时键，不能把身份不明的数据写入项目。
- 原有手工章节保存继续使用 `ChapterRepo` 和章节历史；只有 AI 写章改走新工作流。
- 自动修订应用仍复用 `chapter_history` 保存应用前正文。

## 测试策略

实施必须采用 TDD：先写会失败的专项测试，确认失败，再完成最小实现并运行通过。

### 迁移测试

- v19 数据库无损升级到 v20。
- 四张新表、外键、CHECK 和索引存在。
- 制造 v20 中途失败时，DDL 和迁移版本号均不残留。
- 删除项目级联删除运行、审稿和提案；删除章节按设计处理运行关联并删除审稿和提案。

### 写章状态机测试

- 创建运行时五个阶段均存在且顺序固定。
- 未完成前置阶段不能完成后续阶段。
- 空草稿不能完成 `draft`。
- 重复提交返回同一章节，不产生第二章。
- 失败阶段可以合法重试，已成功阶段不重复调用付费模型。
- 取消后 Token、完成和错误迟到回调均被拒绝。
- 应用退出后遗留 `running` 恢复为 `failed/PROCESS_INTERRUPTED`，不自动重放。

### 原子事务测试

- 正文、摘要、事实、知识和钩子全部成功时一起提交。
- 在摘要、事实、知识、钩子和运行状态更新的每一个位置分别制造失败，数据库均恢复到提交前状态。
- 事务失败后草稿和抽取结果仍可读取并重试。
- “仅保存正文”只有显式请求才能把抽取阶段标为 `skipped`。
- 新章节 ID 由主进程直接返回，不再通过排序最大值推断。

### 审稿测试

- 15 个维度齐全时正确计算覆盖率和平均分。
- 缺失维度、重复 ID、未知 ID、非法分数和非法严重度均拒绝。
- `inconclusive` 不参与平均分且不能得到交付通过。
- critical 问题触发硬门禁。
- 质量分 69.99 为 `revise`，70 为 `pass`。
- 审稿保存后正文变化，读取时返回 `stale`，历史原始结果不变。
- 项目和章节归属不匹配时拒绝保存或读取。

### 修订测试

- 当前正文版本匹配时应用成功并保存章节历史。
- 当前正文变化时提案变为 `stale`，正文不变。
- 同章最多一个 `proposed` 提案。
- 应用修订后旧审稿变为过期，界面状态为待复评。
- 只有新正文产生通过审稿后，当前版本才显示可交付。

### 渲染端与真实 UI 测试

- 停止按钮真实调用取消 IPC。
- 取消后到达的 Token 不显示、不保存。
- 项目切换时旧项目 Token、错误、成功回执均不进入新项目界面。
- 保存失败不会显示成功，草稿仍可恢复。
- 批量生成逐章使用真实提交状态。
- 重启后可恢复 `drafted` 运行。
- 审稿历史、过期标签、冲突提示和待复评状态正确。

## 最终验证命令

实现完成后至少运行：

```text
npm run build:main
node tests/ui/run-chapter-workflow.cjs
node tests/ui/run-writing-workspace.cjs
node tests/ui/run-creative-decision-ledger.cjs
npm run test
npm run build
git diff --check
```

如果因外部 API Key 或网络未执行真实模型烟测，必须明确记录“未验证”，不能用模型替身测试冒充真实供应商通过。

## 验收标准

- 点击停止后供应商请求被真实中断，取消后的任何迟到结果都不能保存。
- UI 只在主进程原子提交成功后显示“已保存”。
- AI 新章节由主进程直接返回真实 ID，不再查询“排序最大章节”。
- 正文、摘要、自动事实、人物知识和叙事钩子在一个事务内全部提交或全部回滚。
- 事实抽取失败时保留完整草稿，可重试；仅在用户明确选择后允许只保存正文。
- 应用重启不会自动重放付费请求，未完成运行有诚实的中断状态。
- 每份审稿都持久化并绑定精确正文 SHA。
- 无法检查的维度记为 `inconclusive`，不能通过虚构高分提高总分。
- 质量分、覆盖率、硬门禁和交付状态分别展示并按固定规则聚合。
- 正文修改后旧审稿自动显示过期，不能显示当前版本已通过。
- 旧修订不能覆盖作者的新正文；冲突时正文保持不变且修订预览可查看。
- 修订应用后必须重新审稿，只有新正文的当前审稿通过才显示可交付。
- 项目切换和并发回执不串线。
- 旧项目、手工正文保存、章节历史、创作决策账本和 Obsidian 只读功能不回归。
- 所有专项测试、现有真实 UI 回归、全量测试和生产构建通过。
- `AGENTS.md` 已记录最终架构、踩坑和实际验证结果。

## 供另一位开发者重点评审的问题

请评审者优先回答以下问题；任何一项认为不合理，都可以直接修改本 Spec：

1. 五阶段状态机是否足以覆盖当前写章流程，是否存在不必要阶段或缺失阶段？
2. `chapter_run_stages.output_json` 保存完整草稿是否合适，还是应拆成独立产物表？
3. 主进程管理 AI Provider 与事务、渲染端保留提示词组装，边界是否清晰？
4. Provider 当前依赖是否都能可靠接收 `AbortSignal`，取消回调是否还有竞态窗口？
5. 自动抽取与正文原子提交是否会让长时间 AI 抽取阻塞用户保存，是否应先生成草稿、用户保存时再抽取？
6. “事实抽取失败后允许仅保存正文”的降级是否符合产品预期？
7. 正文版本直接对原始 HTML 字符串计算 SHA 是否稳定，是否存在编辑器无语义变更但 HTML 改写导致频繁过期的问题？
8. 审稿覆盖率必须为 1 才允许交付是否过严？如果放宽，应给出固定阈值和理由。
9. 同一章节最多一个待处理自动修订是否满足使用场景？
10. v20 外键删除策略、索引和事务边界是否存在 SQLite 实现问题？
11. 预计文件拆分是否与当前 Electron 主进程、preload 和 renderer 构建方式兼容？
12. 测试是否覆盖了保存失败、取消迟到、项目切换、事务回滚和修订覆盖这五类最高风险？

## Spec 修改与批准流程

1. 当前 v0.1 发给评审开发者。
2. 评审者可以在 Markdown 中直接批注、提出替代方案或修改字段。
3. 根据评审意见更新为 v0.2，并在文档顶部增加变更摘要。
4. 用户确认最终版本后，状态改为“已批准设计”。
5. 再单独生成逐文件、逐测试、逐提交的实施计划。
6. 实施发现 Spec 与真实代码冲突时先更新 Spec 和实施计划，再继续编码；不要求为了遵守旧文档而实现已知错误设计。
