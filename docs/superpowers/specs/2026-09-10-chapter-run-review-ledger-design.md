# 写章运行审计与审稿版本账本设计

> 状态：已批准设计（2026-09-12）。一期已落地并经第二人复核补丁；二期、三期尚未实施。
>
> 本文档可以修改，不是不可变合同。v0.1 按 2026-09-12 代码收口修订为 v0.2；v0.3 合并第二评审意见与复核。用户确认本版后，再拆成可独立交付的实施计划；实施中若与真实代码冲突，先改 Spec 再编码。

## 变更摘要

### v0.2 → v0.3（合并第二评审）

第二评审核对 HEAD 后确认 v0.2 的事实依据成立，但正文有五处未写死。本版全部采纳，并删掉文首「待确认、不改条款」的评论区，避免按过时段落施工。

1. **世代递增改用规范化纯文本。** 去 HTML 标签、合并空白后比较；等价 HTML 不 +1。禁止用 `content` 字符串 `!==`。
2. **二期必须改审稿 prompt / 解析 / 聚合。** 三态 + evidence 不是「只加两张表」。结构不合格 → `execution_status = failed`。
3. **一期写死渲染端拒收。** 采用 `streamId → projectId` 映射；切项目作废旧映射。主进程事件形状仍只带 `streamId`。
4. **非技术说明补上世代绑定的代价：** 改一个标点也要重审、旧修订作废，这是有意取舍。
5. **迁移号拆开：** 一期无表；二期 v21；三期 v22。禁止改 v20。若二、三期合并发布，合成一次迁移事务（版本号仍按当时最高未用号一次登记）。
6. **`ChatOptions.temperature` 保持 `number`。** v0.2 误写成 `string | number`，作废。
7. **一期点名接取消的面板：** `AIWritePanel`、`AIChatPanel` 必须接；`AIReviewPanel`、`AIPolishPanel` 同期接上（它们已在用 `chatStream`），避免只改写章、其它面板继续停不住。

### v0.1 → v0.2

对照 2026-09-12 的 A1–A6 收口、技术审查报告与目标对照评估：**方向对，整包五阶段工作流不适合按 v0.1 落地。**

1. **承认已落地工作，不再当缺口。** A1 已让 `create` 同步返回章节 id 并去掉 `sortOrder` 猜章与 `hi-story-pending-summary`；A5 已让写章抽取的 hook 走 `creative_decisions` 的 `proposed`；迁移 **v20 已被占用**（`planning_ideas` 去重 + `UNIQUE(project_id)`）。
2. **拆成三期，禁止一次换写章底座。** 一期只做真实取消；二期做审稿版本账本；三期才加轻量写章运行记录。
3. **废弃五阶段持久化状态机。** 运行只记草稿、是否已提交、失败/取消。
4. **废弃「抽取与钩子随正文原子提交」。** 正文优先；抽取异步；钩子走决策账本，**禁止**直写 `narrative_hooks`。
5. **「仅保存正文」改为主路径。**
6. **正文版本不用原始 HTML 的 SHA-256。** 改为 `content_generation`（v0.3 补上纯文本判据）。
7. **覆盖率阈值改为有效维度 ≥ 12/15。**
8. **测试覆盖与 A1/A2/A5 的交界。**

### 已作废条款（v0.1 / v0.2 残留）

- 迁移号 v20、四张表一次上齐、`chapter_run_stages` 五阶段 CHECK。
- `ChapterRunService.commit` 在同一 SQLite 事务写入摘要、事实、人物知识与 `narrative_hooks`。
- 渲染端不得再走 `db:chapter:create` 保存 AI 正文。
- 对 `content` 原始字符串计算 SHA，或用 HTML 字符串 `!==` 决定世代。
- `coverage < 1` 一律 `delivery_status = inconclusive`。
- 把流取消、审稿账本、写章状态机绑成同一实施计划。
- 「二、三期合并发布仍写 v21」这种含糊口径（改为：二期 v21、三期 v22；合并发布则一次事务）。

---

## 一句话目标

在不拆掉 A1/A5 的前提下：让 AI 流可真实取消且迟到结果不能落库；让审稿和自动修订绑定精确正文世代，旧报告与旧修订不能冒充当前正文的有效结论；必要时再给写章一次可恢复的轻量运行记录。

## 给非技术用户的说明

本功能主要解决三种仍在发生的风险（v0.1 里另两种已在 A1/A5 修好，不再当本期卖点）：

1. 用户点击「停止生成」后，后台实际上仍继续生成，浪费额度，迟到结果还可能写进界面。
2. 一份审稿针对旧正文生成，正文改过之后仍可能被当成有效；旧修订也可能覆盖作者的新内容。
3. 应用关掉后，未保存的 AI 草稿没有诚实的身份，无法区分「还在跑」「已经停」「可以继续保存」。

完成后：停止就是真的停；每份审稿都标明审的是第几版正文；写章草稿可以按运行单恢复，但正文仍是一点保存就进编辑器，不会等抽取或审稿。

**有意取舍：** 审稿绑定的是「字变了没有」，不是「你有没有点过保存」。作者改一个标点并保存后，旧审稿会显示过期，未应用的自动修订作废，需要重新审、再生成修订。这是为了避免旧修订盖住新正文，不是故障。只改字体/加粗、正文汉字没变，不会触发过期。

---

## 当前实现与问题依据

核对日期：2026-09-12（A1–A6 已结案，HEAD 以仓库当时状态为准）。

### 已关闭（v0.1 依据失效）

- **A1 写章落库：** `App.tsx` 的 `onSaveAsChapter` 已同步 `db:chapter:create`（含正文与 `planning_outline`），用返回的章节 id 更新列表并选中，不再 `setTimeout` + `sortOrder` 猜章。
- **pending-summary 旁路：** 全仓已无 `hi-story-pending-summary`。
- **A5 钩子单轨：** 抽取 `factType === hook` 走 `db:creativeDecisions:createChapterExtractionProposals`；非 hook 仍 `batchUpsert`。禁止再双写 `story_facts` + `narrative_hooks`。
- **迁移 v20：** 只服务策划表唯一行，不能给本功能用。

### 仍存在的写章问题

主要逻辑：`AIWritePanel.tsx`、`App.tsx`、`src/main/ipc/ai.ipc.ts`。

- `handleStop` 只把 React 的 `generating` 改为 `false`，注释写明 IPC 流无法中止。
- `ai:chatStream` 返回 `streamId` 后在后台跑 Provider，没有 `ai:cancelStream`，也没有 AbortSignal 贯穿。
- 事件为 `sender.send('ai:streamToken', streamId, token)`，**不带 projectId**。渲染端 `ai.service.ts` 只按 `streamId` 过滤；写章等面板在 `App` 常驻，切项目不会拆掉 `for await`。
- Generic OpenAI 路径已有超时用的内部 `AbortController`，用户取消接不进去；Claude Provider 未传 abort。
- 批量生成已等待 `onSaveAsChapter` 的 id（A1），但停止/切项目时流仍可能继续。
- 摘要、事实、人物知识仍在正文保存之后异步多 IPC 写入；失败不挡正文（这是 **产品上要保留的行为**）。
- 没有「这次生成用了哪个模型、草稿存在哪」的运行审计（目标对照评估 B6）。
- 使用 `chatStream` 的面板：`AIWritePanel`、`AIChatPanel`、`AIReviewPanel`、`AIPolishPanel`。

### 仍存在的审稿问题

主要逻辑：`AIReviewPanel.tsx`、`ai-prompts/review.ts`。

- 审稿结果只在组件状态中，关闭面板或退出后不能追溯。
- 报告没有绑定正文世代。
- `REVIEW_SYSTEM_PROMPT` 输出 `{ id, name, score, passed, comment }`，要求「每个维度都要评分、不要跳过」「没问题就 90 分以上」。类型是 `passed: boolean`。没有 `status` 三态、没有 `evidence`、没有覆盖率与硬门禁。
- `handleAcceptRevision` 直接 `db:chapter:update`，不比较审稿时正文是否仍一致（M3 已修 `'current'` 与回写 App，**没有**修版本冲突）。
- 应用修订后不强制待复评。

### 与现有底座的硬约束（禁止违反）

来自 `AGENTS.md` / 目标对照评估，本 Spec 视为合同：

- **C2** 不重写 TipTap 手工保存状态机。
- **C5** 创作决策账本的「提议 → 确认 → 单事务投影」保留；写章抽取不得把 hook 当已确认运行时状态。
- **C6** Obsidian 只读，不回写。
- **C4** `chapters.planning_outline` 施工卡快照保留；`create` 仍要带上。
- 渲染端写库必须检查 `res.success`；跨项目必须用启动时 `projectId` 与当前项目比对。
- 不引入 Redux；不把全部 prompt 一次性搬到主进程。

---

## 范围

### 一期（P0）：AI 流真实取消

包含：

- Provider 与 `ChatOptions` 贯穿 `AbortSignal`。
- 主进程流注册表；`ai:cancelStream` 同时校验 `streamId + projectId`。
- 停止按钮等待主进程确认；取消后 Token / complete / error 一律拒绝。
- 窗口销毁时中止该窗口的流。
- 项目切换清空当前界面上的流，**不**自动取消旧项目请求；渲染端按下方数据流作废 `streamId → projectId` 映射，旧 Token 不得进入新项目 UI。
- `AIWritePanel`、`AIChatPanel`、`AIReviewPanel`、`AIPolishPanel` 的停止/关闭路径都走取消 IPC（审稿、润色若当时没有停止按钮，关闭面板或切项目也必须取消或至少拒收迟到结果）。
- 单测 + 写作 UI 回归覆盖「停止后迟到 Token 不显示、不保存」和「切项目后旧 Token 不进入新项目」。

不包含：新表、写章状态机、审稿持久化。一期无迁移。

### 二期（P0 产品）：审稿版本账本

包含：

- 迁移 **v21**：`chapters.content_generation` + `chapter_reviews` + `chapter_revision_proposals`。
- 世代按规范化纯文本递增（见术语与数据模型）。
- **改 `REVIEW_SYSTEM_PROMPT` 输出契约**为三态 + `evidence`；重写解析；用固定规则聚合覆盖率/均分/门禁。结构不合格不得落成完整审稿。
- 审稿报告持久化，绑定 `source_generation`。
- 读取时动态计算新鲜度。
- 自动修订提案持久化；应用时比对世代，冲突则拒绝覆盖并保留预览。
- 应用成功后进入待复评；只有新世代上的有效通过审稿才显示「当前版本通过」。
- 同章最多一个 `proposed` 修订。
- 项目切换与迟到回执隔离。
- 专项测试与真实 Electron 审稿回归。

### 三期（P1）：轻量写章运行记录

包含：

- 迁移 **v22**：`chapter_runs` 一张表（无五阶段子表）。
- 完整草稿保存在运行记录中；重启后 `drafted` 可继续保存；遗留 `running` 恢复为 `failed/PROCESS_INTERRUPTED`，不自动重放付费请求。
- 取消与运行绑定 `projectId + runId`。
- 保存仍走「正文优先」：`commit` 只保证章节正文（及施工卡）写入并返回真实 id；抽取仍异步，钩子仍进账本提议。
- 失败可重试抽取，不可把未确认钩子写成运行时状态。

若二、三期在同一发布里交付：把 v21 与 v22 的 DDL 放进**一次**迁移事务，只登记一个新版本号（当时最高未用号）。禁止改 v20。分开交付时必须是 v21 然后 v22，中间不能跳号。

### 三期都不包含

- 正文选区批注和高亮。
- 审稿 DAG 或图形化节点界面。
- 分层上下文压缩、多模型基准、自动连写全书。
- 更换 TipTap、SQLite、AI Provider 或前端框架。
- Obsidian 写回。
- 把创作罗盘、风格指纹、Obsidian 上下文、全部写章 prompt 搬到主进程。
- 拆 `App.tsx`、typed IPC、正规化策划表。
- 回退 A1/A5，或把 hook 原子写入 `narrative_hooks`。
- 只改格式（加粗、标题级别等）就让审稿过期。

---

## 方案选择

### 采用：分三期加固现有链路，主进程拥有取消、审稿账本和（三期）运行记录

保留 React 面板和渲染端提示词组装。主进程逐步收回：

- 一期：流生命周期与迟到拒绝；
- 二期：审稿校验、持久化、修订应用事务；
- 三期：写章运行身份、草稿恢复、取消与运行的绑定。

渲染端不能把「已保存 / 当前版本通过 / 已停止」标成真相源；这些状态以主进程回执为准。切项目后的 Token 以渲染端映射作废为准（主进程按产品决定可不杀旧流）。

### 未采用：v0.1 的五阶段写章工作流 + 原子提交附属数据

会和 A1、A5 打架，也把取消拖进大工程。

### 未采用：token 事件带上 projectId

能用，但要改 `electron.d.ts`、preload 与所有监听。一期改动更小的做法是渲染端映射。若实施时发现映射不可靠，再改事件形状，并先更新本 Spec。

### 未采用：全部上下文构建一次性搬主进程

长期可再迁，不改变本 Spec 数据契约，也不在这三期内做。

---

## 核心术语

- **规范化正文（`normalizeChapterText`）：** 对 `chapters.content` 去 HTML 标签、把连续空白（含换行）收成单个空格、再 trim。不解码成另一种文档模型，不做中英文分词。纯函数，主进程与测试共用同一份实现。
- **正文世代（`content_generation`）：** 章节行上的单调整数。仅当新旧 `normalizeChapterText` 结果不同时 +1（含手工保存、AI 写章提交、应用修订、历史恢复）。只改标题、摘要、状态，或 TipTap 重序列化导致 HTML 变了但纯文本相同，**不递增**。新建章节从 1 开始。
- **运行：** 一次 AI 写章任务（三期才持久化）。一期只有进程内 `streamId`。
- **迟到结果：** 用户取消、项目切换或运行终止后，供应商仍返回的 Token、完成或错误回调。
- **覆盖率：** 本次审稿得到有效判断（`pass` 或 `issue`）的维度数除以 15。
- **硬门禁：** 是否存在必须阻止交付的严重问题。
- **过期审稿：** 报告的 `source_generation` 与当前章节 `content_generation` 不同。
- **待复评：** 修订已应用到新世代，该世代尚无一份新鲜且达到交付条件的审稿。

---

## 总体数据流

### 一期：取消

1. 渲染端开始流式请求时，把**当时的 `projectId`** 传给 `ai:chatStream`（主进程登记用）。成功拿到 `streamId` 后，渲染端登记 `streamId → projectId`。
2. 主进程登记 `streamId + projectId + senderId + AbortController`。
3. 用户点停止：渲染端调用 `ai:cancelStream({ streamId, projectId })`，主进程先标 terminal，再 `abort()`。
4. 之后任何 Token / complete / error：主进程若发现 terminal 或 sender 已销毁则丢弃，不 `send`。
5. **渲染端拒收（采用映射，不改事件形状）：** `ai.service` 收到 `ai:streamToken/Complete/Error` 时，若该 `streamId` 无映射、或映射的 `projectId` 不是调用方发起时的项目、或映射已被作废，则不 yield、不更新 UI。切项目时立即作废旧项目下全部 `streamId` 映射；常驻面板用 `projectId` 变化结束旧 `for await`（即使主进程仍在跑）。
6. 取消成功回执到达后，界面才显示「已停止，不会保存」。

切项目**不**自动 `abort` 旧项目流（避免误杀后台）。拒收只发生在渲染端；用户关掉窗口才由主进程中止该窗口的流。

### 二期：审稿和修订

1. 用户选择章节并开始审稿。
2. 主进程读取当前正文与 `content_generation`，启动可取消的审稿流。
3. AI 返回后按新契约解析 15 个维度；结构不合格则 `execution_status = failed`，不冒充完整审稿。
4. 通过结构校验后按固定规则聚合，写入不可变审稿行。
5. 每次读取时比较 `source_generation` 与当前世代；不一致则 `freshness_status = stale`。
6. 生成自动修订时保存 `review_id` 与 `source_generation`。
7. 应用提案时在同一写事务中比较当前世代；不一致则标 `stale`，不改正文。
8. 应用成功且规范化正文确实变化则世代 +1，提案 `applied`，界面待复评。若修订稿与当前纯文本相同，世代不 +1，提案仍标 `applied`（极端情况，界面不必待复评）。
9. 只有新世代上的新鲜审稿达到交付条件，才显示「当前版本通过」。

### 三期：写章运行（轻量）

1. 用户点击生成，渲染端提交项目、标题、章纲快照（若有）、已组装的 messages、模型配置。
2. 主进程校验项目，创建 `chapter_runs`（`running`），启动可取消的流。
3. 流正常结束且草稿非空 → `drafted`，草稿写入运行记录；空回复/取消/失败不得进入 `drafted`。
4. 用户点保存：写入正文 + 施工卡，返回真实章节 id，运行标 `committed`。按规范化正文决定是否递增世代。**不等待抽取。**
5. 抽取异步：摘要/非 hook 事实/知识尽力写入；hook 只创建 `proposed`。失败不回滚正文。
6. 渲染端只在章节创建/更新成功回执后显示「已保存」。

---

## 写章运行（仅三期）

### 状态

- `running`：正在生成草稿。
- `drafted`：完整草稿已在运行记录中，等待用户保存。不视为保存成功。
- `committed`：正文已写入章节并拿到真实 id。
- `failed`：可重试的暂停（含进程中断）。草稿若已完整仍可保存。
- `cancelled`：用户取消，不可恢复为 `running`；需要重新生成时建新运行并用 `retry_of_run_id` 关联。

`committed` 与 `cancelled` 不可逆。`commit` 成功后重复提交返回原章节 id，不创建重复章节。

### 不再持久化的「阶段」

下列只作为实现步骤或日志字段，不建 `chapter_run_stages`：

- 组装输入与 input 摘要（禁止存 API Key 与完整 Provider 配置）。
- 结构校验（commit 前的函数）。
- 事实抽取（提交后的异步附属任务，可用 `extract_status`，不是写章前置）。

### 与 A1 保存路径的关系

手工写作继续走 `ChapterRepo` + 章节历史。AI 写章在三期可以由 `ChapterRunService` 调用同一套 `create`/`update`，必须：

- 返回真实章节 id；
- 写入 `planning_outline`（若本次有章纲快照）；
- 按 `normalizeChapterText` 决定是否递增 `content_generation`；
- 成功后才允许界面显示已保存。

禁止再引入 localStorage 或 `sortOrder` 猜章。

### 抽取契约（三期，附属）

- 默认在 `committed` 之后执行，不阻塞保存。
- 非 hook 事实与知识可自动落库；必须检查 `res.success`。
- hook **只**走 `createChapterExtractionProposals`；失败记日志并可重试，不得改写已确认钩子。
- 不在写章抽取中产 `debt`（A5 已立 P2，本 Spec 不提前做）。
- 不提供「系统静默跳过抽取并假装全部成功」。界面若抽取失败，明确显示缺失项和重试。

---

## AI 流取消契约（一期即可，三期把 runId 挂上）

### Provider 接口

```ts
export interface ChatOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  signal?: AbortSignal;
}
```

`temperature` 保持现有 number 语义。Claude 与 OpenAI 兼容 Provider 都必须把 `signal` 传给底层 SDK 或 `fetch`。OpenAI 兼容路径已有超时 abort，必须与用户 signal **合并**（任一方 abort 都取消），不能互相覆盖。

取消归一为错误码 `AI_STREAM_CANCELLED`，不能显示为普通网络失败。

`ai:chatStream` 入参必须包含 `projectId`（与现有 config/messages/options 一起传），供注册表与取消校验使用。不把 `projectId` 加进 token 事件。

### 主进程流注册表

进程内：

```ts
Map<string, {
  controller: AbortController;
  senderId: number;
  projectId: string;
  runId?: string; // 一期可空，三期必填
  terminal: boolean;
}>
```

约束：

- API Key、完整提示词和正文不得写入该 Map 的日志。
- 取消必须同时匹配 `streamId` 与 `projectId`；三期再加上 `runId`。
- 先标 terminal（三期同时写 `cancel_requested = 1`），再 `abort()`。
- 每个 Token、完成、错误发送前都检查 terminal 与 sender 存活。
- `onComplete` 与 `onError` 只能有一个成为终态；完成后移除登记。
- 窗口销毁：中止该窗口所有流。三期把对应运行标为 `cancelled` 或 `failed`，不得留下永久 `running`。

### 渲染端映射（一期必做）

进程内（渲染端模块级或 `ai.service` 内）：

```ts
Map<string, { projectId: string; ignored: boolean }>
```

- `chatStream` 成功后写入；complete/error/cancel 确认后删除。
- 切项目：该项目下所有条目 `ignored = true`（或直接删除）。
- yield 前检查：`ignored` 或 `projectId` 不匹配则丢弃。

---

## 数据模型

### 迁移号

| 期 | 迁移 | 内容 |
| --- | --- | --- |
| 一 | 无 | 仅代码 |
| 二 | **v21** | `content_generation` + 审稿两表 |
| 三 | **v22** | `chapter_runs` |

DDL 与 `_migrations` 登记必须在同一 SQLite 事务。只新增列/表/索引，不删除、不重写现有章节正文、策划 JSON、决策账本或 Obsidian 路径。**禁止改 v20。**

### `normalizeChapterText`（二期，纯函数）

与 `ChapterRepo` 现有字数统计不同：字数去标签后去掉全部空白计 CJK 长度；世代比较保留字与字之间的单空格，避免把「改空格」和「改字」混在一起时过度敏感，同时合并 TipTap 换行噪声。

递增规则（`shouldBumpContentGeneration(oldHtml, newHtml)`）：

```text
normalizeChapterText(oldHtml) !== normalizeChapterText(newHtml)
```

为 true 才 `content_generation + 1`。`chapter.history` 是否打快照可继续用现有「content 字符串是否变化」或改为同一纯函数；**世代与审稿新鲜度必须用纯函数，不得用字符串全等。** 建议历史快照也改用同一判据，避免无语义保存刷掉 30 份上限，但不作为二期验收阻塞。

### `chapters.content_generation`（二期 / v21）

```sql
ALTER TABLE chapters ADD COLUMN content_generation INTEGER NOT NULL DEFAULT 1;
```

已有行迁移后视为世代 1。`ChapterRepo.create` 插入 1；`update` / 历史恢复 / 修订应用走 `shouldBumpContentGeneration`。

### `chapter_reviews`（二期 / v21）

```sql
CREATE TABLE chapter_reviews (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  run_id TEXT,
  source_generation INTEGER NOT NULL,
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
  FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
);

CREATE INDEX idx_chapter_reviews_chapter_created
  ON chapter_reviews(chapter_id, created_at DESC);
```

`run_id` 二期可为空。**不建对 `chapter_runs` 的外键**，只保存可选来源 id。

审稿行写入后不可修改。`freshness_status` 不持久化。`execution_status = failed` 的行可以保存错误摘要，`dimensions_json` 允许空数组，不得填假维度凑覆盖率。

### `chapter_revision_proposals`（二期 / v21）

```sql
CREATE TABLE chapter_revision_proposals (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  review_id TEXT NOT NULL,
  source_generation INTEGER NOT NULL,
  proposed_content TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN (
    'proposed','applied','rejected','stale'
  )),
  applied_generation INTEGER,
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

同一章节最多一个待处理自动修订。已应用、拒绝或过期的历史不删除。

### `chapter_runs`（三期 / v22）

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
  input_summary TEXT NOT NULL DEFAULT '',
  draft_content TEXT,
  extract_status TEXT NOT NULL DEFAULT 'pending' CHECK(extract_status IN (
    'pending','running','completed','failed','skipped'
  )),
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

- `source_outline_node_id` 只存标识，不建外键。
- `draft_content` 存完整草稿，不拆产物表。
- `input_summary` 禁止 API Key、Authorization、完整 messages。
- `extract_status = skipped` 不是保存正文的前提。
- **不创建 `chapter_run_stages`。**

---

## 审稿判定规则（二期）

### Prompt 与解析（二期必做，不是附属）

当前 `REVIEW_SYSTEM_PROMPT` 与 `ReviewDimension.passed` **废止为二期输入契约**。必须同时改：

- `src/renderer/services/ai-prompts/review.ts` 的系统提示与 JSON 示例；
- 解析器（主进程审稿服务；渲染端不得再自己算总分当真相源）；
- `src/renderer/types` 中的审稿类型。

新输出要求每个维度：

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

Prompt 必须明确：

- 现有 15 个维度，一个都不能缺、不能重复、不能换未知 id。
- 上下文不够做判断时用 `inconclusive`，`score` 必须为 `null`，comment 说明缺什么；**禁止**为凑覆盖率而硬给 pass 或高分。
- `pass` / `issue` 必须有判断；`issue` 必须有 evidence（可与 issues[].location 同源）。
- 删除「没问题就给 90 分以上」「每个维度都要评分不要跳过」这类与三态冲突的句子。

解析失败（缺维度、重复 id、未知 id、`inconclusive` 带了分数、`issue` 无证据、非法 severity、非 JSON）：`execution_status = failed`，`gate_status` 与 `delivery_status` 为 `inconclusive`，不得把残缺 JSON 补全成 15 个假维度。

`prompt_version` 写入审稿行，便于以后改 prompt 后区分旧报告。

### 聚合

```text
有效维度 = status 为 pass 或 issue 的维度
coverage = 有效维度数 / 15
quality_score = 有效维度 score 的算术平均值（无有效维度则为 null）
```

精确判定：

- AI 请求或 JSON 解析失败：`execution_status = failed`，`gate_status = inconclusive`，`delivery_status = inconclusive`。
- 任一问题 `severity = critical`：`gate_status = blocked`，`delivery_status = blocked`。
- 有效维度 < 12（coverage < 0.8）：`gate_status = inconclusive`，`delivery_status = inconclusive`。
- 有效维度 ≥ 12、无 critical、且 `quality_score >= 70`：`gate_status = pass`，`delivery_status = pass`。
- 有效维度 ≥ 12、无 critical、且 `quality_score < 70`：`gate_status = pass`，`delivery_status = revise`。

阈值 12/15 是固定产品规则。以后改阈值必须改本 Spec 并改单测。

查询时若世代不一致：对外 `freshness_status = stale`，`effective_delivery_status = stale`；库内原始 `delivery_status` 不变。

---

## 修订应用契约（二期）

单个写事务：

1. 校验提案属于当前项目和章节，且状态为 `proposed`。
2. 读取当前章节的 `content_generation`。
3. 当前世代 ≠ `source_generation`：提案标 `stale`，返回 `REVISION_SOURCE_STALE`，不改正文。
4. 把当前正文写入现有 `chapter_history`（沿用 `ChapterHistoryRepo.addSnapshot`）。
5. 写入提案正文、字数、`updated_at`；若 `shouldBumpContentGeneration` 为真则世代 +1。
6. 保存 `applied_generation`（应用后的当前世代），提案标 `applied`。

旧审稿不必更新行。界面在世代确实 +1 后进入待复评。

---

## IPC 契约

所有 IPC 继续返回 `IpcResult<T>`。失败包含稳定错误码和中文消息。

**一期取消优先复用现有 `{ success, error }`，不强制先上 `DomainError` 类型。** 需要时可在 message 前缀错误码。

### 一期

- `ai:chatStream`：增加 `projectId`，登记注册表。
- `ai:cancelStream`：`{ streamId, projectId }`，确认 terminal 后 abort。
- token 事件形状保持 `(streamId, token)`。
- 不强制改写章保存 IPC。

### 二期

- `workflow:chapterReview:run`
- `workflow:chapterReview:list`（含动态 `freshnessStatus`）
- `workflow:chapterReview:createRevision`
- `workflow:chapterReview:applyRevision`
- `workflow:chapterReview:rejectRevision`

审稿流必须可取消。应用修订不得再由渲染端直接 `db:chapter:update` 绕过世代校验。

### 三期

- `workflow:chapterRun:start`
- `workflow:chapterRun:get` / `list`（`projectId + runId`）
- `workflow:chapterRun:cancel`
- `workflow:chapterRun:commit`（只提交正文 + 施工卡，返回章节 id）
- `workflow:chapterRun:retryExtract`
- `workflow:chapterRun:retry`

**不提供** `commitDraftOnly`。  
**不提供** 把 hook 写入 `narrative_hooks` 的 commit 步骤。

---

## 项目切换和并发

- 每个请求携带 `projectId`，主进程按数据库重校验归属。
- 渲染端复用「项目 ID + 请求代次」；切项目立即清空当前流、审稿、修订的可见状态，并作废旧 `streamId` 映射。
- 切项目不自动取消旧项目流；关闭窗口或点停止才取消。
- 同一 `streamId` / 同一运行只允许一个活跃流。
- 同一章节同一时刻只允许一个 `proposed` 修订；写事务互斥。

---

## 错误码

| 错误码 | 含义 | 是否可重试 | 引入期 |
| --- | --- | --- | --- |
| `AI_STREAM_CANCELLED` | 用户取消 AI 流 | 否，需新开流/新运行 | 一 |
| `LATE_RESULT_REJECTED` | 取消或终止后的迟到结果 | 否 | 一 |
| `REVIEW_RESPONSE_INVALID` | 审稿结构无效 | 是 | 二 |
| `REVIEW_SOURCE_STALE` | 审稿启动后、落库前正文世代已变 | 是 | 二 |
| `REVISION_SOURCE_STALE` | 修订针对的世代已经不是当前正文 | 否，需重新审/重新生成修订 | 二 |
| `RUN_NOT_FOUND` | 写章运行不存在 | 否 | 三 |
| `RUN_PROJECT_MISMATCH` | 运行不属于当前项目 | 否 | 三 |
| `RUN_ALREADY_COMMITTED` | 运行已提交，返回原章节 | 返回原结果 | 三 |
| `EMPTY_DRAFT` | AI 没有返回有效正文 | 是 | 三 |
| `PROCESS_INTERRUPTED` | 应用退出时仍为 running | 否自动重放 | 三 |
| `FACT_EXTRACTION_INVALID` | 抽取结构无效（正文已保存） | 是（只重试抽取） | 三 |

错误日志不得包含 API Key、Authorization 或完整 Provider 配置。

---

## 界面要求

### 一期（写章 / 对话 / 审稿 / 润色流）

- 「停止生成」等待主进程确认；成功后显示「已停止，不会保存」。
- 取消后到达的文字不得追加到草稿。
- 切到另一项目后，旧流文字不得出现在新项目面板。

### 二期（审稿面板）

- 默认展示当前正文最新一份审稿。
- 明确显示：当前、过期、待复评、失败。
- 分别显示质量分、覆盖率、硬门禁、交付状态。
- 过期报告可看历史，不能显示「当前版本通过」。
- 只能从当前世代对应的审稿生成修订。
- 修订冲突时保留预览，提示正文已变化，不自动覆盖。
- 应用成功后显示待复评和「重新审稿」。
- 若作者保存了正文改动（含一个标点），提示审稿已过期、待处理修订已作废，需要重新审。不要用「出错了」的语气。

### 三期（写章面板）

- 显示生成 / 已出草稿 / 已保存 / 失败，不显示五阶段进度条。
- 只有章节写入成功才显示「已保存」。
- 抽取失败单独提示，提供「重试抽取」，不影响已保存正文。
- 批量写章逐章使用真实保存回执，不能预先标成功。
- 重启后可恢复 `drafted` 草稿；遗留 `running` 显示中断，不自动再请求模型。

---

## 预计文件边界

职责不能重新混进巨型组件。文件名可微调。

### 一期

新增：`src/main/ai/stream-registry.ts`  
修改：`provider.ts`、`claude.ts`、`generic-openai.ts`（合并用户 signal 与超时 abort）、`ai.ipc.ts`、`ai.service.ts`（映射与拒收）、`AIWritePanel.tsx`、`AIChatPanel.tsx`、`AIReviewPanel.tsx`、`AIPolishPanel.tsx`、`electron.d.ts`、preload 若有白名单。  
测试：取消与迟到拒绝；切项目作废映射；`tests/ui/run-writing-workspace.cjs` 或写章回归扩展停止按钮。

### 二期

新增：`normalize-chapter-text.ts`（或放在 `content-revision.ts`）、`chapter-review.repo.ts`、`chapter-review.service.ts`、`chapter-review-loader.ts`、审稿 workflow IPC。  
修改：`migrations.ts`（**v21**）、`chapter.repo.ts`（纯文本判据递增世代）、`ai-prompts/review.ts`、`AIReviewPanel.tsx`、`App.tsx`（接受修订走账本 IPC）、类型与 AGENTS.md。  
测试：规范化函数；等价 HTML 不递增；三态解析失败；审稿聚合与修订事务；真实 UI 过期 / 冲突 / 待复评。

### 三期

新增：`chapter-run.repo.ts`、`chapter-run.service.ts`、`chapter-run-loader.ts`。  
修改：`migrations.ts`（**v22**）、写章 IPC、`AIWritePanel.tsx`、`App.tsx` 保存与抽取仍遵守 A1/A5。  
测试：运行状态、重启恢复、抽取失败不回滚正文、hook 只出现在 `creative_decisions.proposed`。

---

## 数据迁移与兼容

- v21 / v22 只加列/表/索引。现有项目启动后可立即编辑。
- 无历史审稿时显示空状态；不迁移旧面板内存里的审稿。
- 不把任何旧 `hi-story-pending-*` 身份不明数据写入项目。
- 手工保存继续 `ChapterRepo` + `chapter_history`。
- 自动修订应用复用 `chapter_history`。
- 删除项目 CASCADE 审稿、提案、运行；删除章节 CASCADE 审稿与提案，运行的 `target_chapter_id` SET NULL。

---

## 测试策略

实施采用 TDD：先写会失败的专项测试，再最小实现。

### 一期

- 取消后 Token、complete、error 迟到回调均被拒绝。
- 用户 signal 与超时 abort 合并，互不吞掉。
- 停止按钮真实调用取消 IPC；取消后界面不显示后续文字。
- 切项目后：旧 `streamId` 映射作废，旧 Token 不进入新项目 UI；主进程可不 abort。
- 写章、对话、审稿、润色四条流都至少有「取消或切项目后不把迟到结果写进当前 UI」的覆盖（可用单测 + 一条 UI 回归，不必四条全上真实窗口）。

### 二期

- v20 库无损升级到 v21；中途失败时 DDL 与版本号均不残留。
- `normalizeChapterText`：标签顺序/空段落不同但汉字相同 → 相等；改一个汉字 → 不等。
- `shouldBumpContentGeneration`：等价 HTML 不递增；改字递增；只改标题不递增。
- 15 维度齐全时覆盖率与均分正确；缺失/重复/未知 ID、非法分数与严重度、`inconclusive` 带分数、`issue` 无证据 → `execution_status = failed`。
- `inconclusive` 不参与均分；有效维度 11 为 inconclusive，12 且均分 70 为 pass，69.99 为 revise。
- critical 触发硬门禁。
- 审稿保存后改正文（纯文本变化），读取为 stale；只保存等价 HTML，仍为当前。
- 世代匹配则修订成功并写章节历史；世代变化则提案 stale、正文不变。
- 同章最多一个 proposed。
- 应用后待复评；新世代通过审稿后才显示可交付。
- 归属不匹配拒绝保存或读取。

### 三期

- v21 库无损升级到 v22。
- 空草稿不能进入 drafted。
- 重复 commit 返回同一章节。
- 进程中断 running → failed/PROCESS_INTERRUPTED，不自动请求模型。
- commit 成功后抽取失败，章节正文仍在；hook 不得出现在 `narrative_hooks`，只出现在 proposed。
- `planning_outline` 随 create 写入（施工卡不回归）。
- 切项目后旧运行成功回执不写进新项目 UI。

### 回归

```text
npm run build:main
node tests/ui/run-writing-workspace.cjs
node tests/ui/run-creative-decision-ledger.cjs
node tests/ui/run-obsidian-import.cjs
npm run test
npm run build
git diff --check
```

二期/三期各自增加对应 `tests/ui/run-chapter-*.cjs`。未跑真实供应商烟测必须写「未验证」，不得用 mock 冒充。

---

## 验收标准

### 一期

- 点击停止后供应商请求被真实中断；迟到结果不能显示、不能保存。
- 切项目与关窗口不串流；旧 Token 不进入新项目。
- 写章、对话、审稿、润色都不再出现「界面停了、后台还在出字并写回当前面板」。

### 二期

- 每份审稿持久化并绑定 `content_generation`。
- 等价 HTML 保存不使审稿过期；改字后过期。
- 无法检查的维度为 `inconclusive`，不能靠虚高分抬总分；残缺 JSON 为失败而非凑满分。
- 质量分、覆盖率、硬门禁、交付状态分开展示；覆盖率阈值按 12/15。
- 正文改字后旧审稿自动过期，不能显示当前版本已通过。
- 旧修订不能覆盖作者新正文；冲突时正文不变且预览可看。
- 修订应用后必须重新审稿，只有新世代的新鲜通过审稿才可交付。
- 旧项目、手工保存、章节历史、决策账本、Obsidian 只读不回归。

### 三期

- UI 只在章节写入成功后显示「已保存」。
- AI 新章节由主进程返回真实 id。
- 抽取失败保留正文，可重试抽取；钩子只进确认账本。
- 重启不自动重放付费请求；`drafted` 可恢复。

### 共同

- `AGENTS.md` 记录最终架构、踩坑和实际验证命令。
- 专项测试、现有真实 UI 回归、全量测试和生产构建通过。

---

## 一期落地与复核补丁（2026-09-12）

首版实现见工作区 `ai-stream-cancel-report.md`（提交 `f0780ba` 附近）。第二人复核后补了三处正确性，**不改变分期**：二期审稿账本、三期写章运行记录仍未开工。

已补：

- `ignoreProjectStreams` 必须 `wake()` 并结束 `for await`（抛 `AI_IGNORED_MESSAGE`），禁止等到 complete 再把作废前正文 yield 进新项目。
- `streamRegistry.cancel` 先 terminal + abort，再 **从 Map 删除**；ipc 的 complete/error 无论是否 terminal 都 `finish()`。
- 审稿主路径改为 `chatStream`；审稿/润色关面板会 `cancelActiveStreams`。写章 yield 核对 `projectIdRef`，切项目清空面板草稿。

刻意保留、须在报告里写明的行为：

- 切项目 **仍不 abort** 主进程请求（烧额度直到供应商结束）。渲染端放弃接收后，旧对话若已写入用户消息、助手流尚未完成，**不会再落一条完整 assistant**（避免截断正文冒充成功）。
- `cancelActiveStreams(projectId)` 仍取消该项目下所有流，不是按 `streamId`。写章停止可能误伤同项目对话抽取。按流取消列为下一步，不阻塞一期。
- 写作 UI 回归尚未覆盖停止按钮；真实供应商烟测未做。

---

## 评审问题的锁定答复

### 原 v0.1 第十二节

1. **五阶段是否够用？** 过多。不建阶段表。
2. **草稿放 `output_json`？** 三期放 `chapter_runs.draft_content`。
3. **主进程管 Provider 与事务、渲染端组 prompt？** 采用。保存成功不等于工作流全部完成。
4. **AbortSignal？** 能接到现有 Provider；合并超时 abort；terminal 门禁 + 渲染端映射。
5. **抽取会不会堵住保存？** 本版规定抽取在保存之后。
6. **仅保存正文？** 默认行为。
7. **原始 HTML SHA？** 作废。世代用 `normalizeChapterText`，不用字符串全等。
8. **覆盖率必须为 1？** 过严。锁定 ≥ 12/15。
9. **同章一个待处理修订？** 采用。
10. **v20 外键？** 二期 v21、三期 v22；删除策略合理。
11. **文件拆分？** 兼容；新 service 禁止从 renderer 倒进口。
12. **五类最高风险测试？** 保留，并补施工卡、切项目、钩子提议、等价 HTML。

### 第二评审（已全部采纳）

1. 世代判据：规范化纯文本。
2. 三态是 prompt/解析大改，列入二期必做。
3. 旧 Token：渲染端 `streamId → projectId` 映射，切项目作废。
4. 改标点导致重审：非技术说明与界面文案写明是有意取舍。
5. 二期 v21、三期 v22。

---

## Spec 修改与批准流程

1. v0.1 → v0.2 → v0.3 的评审意见已纳入正文。一期已实施并复核补丁。
2. 二期、三期仍须用户确认后 **分别** 写实施计划。禁止把剩余两期写成一个巨型 plan。
3. 实施发现与真实代码冲突时，先改 Spec 再编码。
