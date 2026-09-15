# 二期实施计划：审稿版本账本（chapter-run 二期）

> 依据：`docs/superpowers/specs/2026-09-10-chapter-run-review-ledger-design.md`（v0.3，已批准）。
> 状态：审查意见已闭环（含 contentGeneration 回执、stale 落库、§12 与 createRevision 对齐），**待用户确认后**先改 Spec 迁号再编码。当前**禁止编码**。
> 本计划只覆盖**二期**（审稿账本）。三期（写章运行记录）另立计划，不混在本计划内。

## 1. 必须先在 Spec 上改一处冲突

Spec 里写「二期 v21、三期 v22」，但这两个迁移号已被占用：

- v21 = 叙事时间接入（`narrative_transitions`，见 `migrations.ts:561`）
- v22 = AI 对话清理（`conversation_messages` 软删列，见 `migrations.ts:674`）

**本计划改用 v23（二期）。** 动手前先改 Spec 正文里的迁移号表（第 345-349 行、第 128-152 行及相关「v21/v22」表述），避免按过时号施工。三期将用 v24，届时再改。

## 2. 目标（一句话）

让每份审稿持久化并绑定「正文世代」，旧审稿/旧修订不能冒充当前正文的有效结论；应用修订前打历史快照，冲突则不覆盖、可回退。

## 3. 现状依据（已核对代码）

- **审稿 prompt**：`src/renderer/services/ai-prompts/review.ts` — `REVIEW_SYSTEM_PROMPT` 输出 `{ totalScore, dimensions:[{passed}], issues }`，类型 `passed: boolean`，无三态、无 evidence。
- **解析**：`AIReviewPanel.tsx:364-389` — 在渲染端 `JSON.parse`，`passed` 计数；无覆盖率、无硬门禁聚合，失败抛「格式解析失败」。
- **修订应用**：`AIReviewPanel.tsx:475-497` — 直接 `db:chapter:update`，不比对世代；M3 已修 `'current'` 字面量但**未修版本冲突**。
- **叙事 as-of**：`AIReviewPanel.tsx` 已在「开始审稿」调 `db:narrative:buildAsOfContext`（`taskType:'review'`），失败 fail-closed。二期**不得退步**。
- **审稿结果**：仅存在于组件 state，关闭即失。
- **章节 Repo**：`chapter.repo.ts` — `update()` 用 `content !==` 打历史快照（第 154-156 行），**没有** `content_generation` 字段。
- **迁移**：当前最高 v22（`migrations.ts:674`），下一号 v23。
- **历史快照**：`ChapterHistoryRepo.addSnapshot` 已存在（`chapter.repo.ts:406`），可直接复用。

## 4. 数据模型（迁移 v23，只加不改）

### 4.1 `chapters.content_generation`

```sql
ALTER TABLE chapters ADD COLUMN content_generation INTEGER NOT NULL DEFAULT 1;
```

已有行迁移后视为世代 1。`create` 写 1；`update`/历史恢复/修订应用走纯函数递增。

**渲染端可读世代（定死）：** `Chapter` 类型与 `db:chapter:findByProject` / `create` / `update` / `restore` 等回执必须带 `contentGeneration`（库列 `content_generation`），供审稿面板在调用 `run` 前传入 `source_generation`。禁止渲染端自己猜世代或只读本地缓存不跟库对齐。

**历史快照判据（非验收阻塞）：** 世代与审稿新鲜度**必须**用 `normalizeChapterText`；`chapter_history` 是否打快照可暂留现有 `content !==`，或顺手改为同一纯函数。Spec 明确：统一历史判据建议做，**不作为二期验收阻塞**。

### 4.2 `chapter_reviews`（审稿账本）

按 Spec DDL，字段：`id / project_id / chapter_id / run_id(可空) / source_generation / prompt_version / provider_name / model_name / execution_status(completed|failed|cancelled) / quality_score / coverage / gate_status(pass|blocked|inconclusive) / delivery_status(pass|revise|blocked|inconclusive) / summary / dimensions_json / issues_json / created_at`。

索引 `(chapter_id, created_at DESC)`。行写入后不可变。`freshness_status` 不持久化（读时动态算）。

**`prompt_version` 常量（二期定死）：** `review-v2-2026-09-15`。以后改 prompt 必须改常量并改 Spec/单测。

### 4.3 `chapter_revision_proposals`（修订提案）

按 Spec DDL，字段含 `status(proposed|applied|rejected|stale) / source_generation / applied_generation / proposed_content`。

`UNIQUE INDEX ON chapter_id WHERE status='proposed'`（同章最多一个待处理修订）。

DDL 与 `_migrations` 登记在同一事务，`version: 23`。

**删除级联（按 Spec DDL）：** 删章节 → `chapter_reviews` / `chapter_revision_proposals` `ON DELETE CASCADE`；删项目 → 同样级联。`chapter_reviews.run_id` 二期不建外键（只存可选来源 id），不依赖 `chapter_runs` 存在。

## 5. 纯函数（主进程，测试共用）

新增 `src/main/ai/content-revision.ts`（或 `normalize-chapter-text.ts`）：

- `normalizeChapterText(html: string): string` — 去 HTML 标签、连续空白收成单空格、trim。
- `shouldBumpContentGeneration(oldHtml, newHtml): boolean` — `normalize(old) !== normalize(new)`。

约束：等价 HTML（标签顺序/空段落不同但汉字相同）不递增；改一个汉字或标点递增；只改标题/摘要/状态不递增。

## 6. 审稿流职责切分（混合契约，必遵守）

Spec 既要求「主进程拥有校验/落库」，又要求「保留渲染端提示词组装、不把全部上下文搬主进程」。本计划采用与三期写章同型的**混合契约**：

| 侧 | 职责 |
|---|---|
| **渲染端** | ① `db:narrative:buildAsOfContext`（`review` + `targetChapterId` + `hasActiveChapter:true`），失败 **fail-closed** 不发起审稿；② 组装 messages（人物/章纲/as-of 文本等）；③ 请求级 **完整 Provider 快照**（长篇 P0：含 apiKey/baseUrl/model 等开流所需字段，**不只** name）；④ 调用 `workflow:chapterReview:run`，传入 `projectId`、`chapterId`、messages、完整快照、启动时读到的 `source_generation` |
| **主进程** | ① 再读库内 `content_generation`，若 ≠ 传入的 `source_generation` → 返回 `REVIEW_SOURCE_STALE` / `executionStatus:'stale'`，**不落库、不开请求**；② **同章同时只允许一个进行中的 run**（第二路拒绝，可归 `REVIEW_SOURCE_STALE`）；③ 可取消（见下「取消契约」）；④ `provider.chat` + 解析 + 聚合；⑤ 请求成功后、落 `completed` **前再读一次世代**（见下「stale 落库」）；⑥ 写入不可变审稿行 |

禁止：

- 渲染端再 `JSON.parse` 后自己算总分当真相源；
- 主进程重做 Obsidian/罗盘等大上下文拼装（本批不搬）；
- 漏掉 as-of（相对现状退步）；
- 日志/错误串打印 API Key、Authorization 或完整 Provider 配置。

**`run` 返回模式（定死）：** 采用 **A（await 到终态）** —— 主进程 `provider.chat(messages, { signal })` 拿全文本 → 解析 → 落库 → 返回结果。渲染端 `await` 该 IPC，**不再自己开 `chatStream`**。

**主进程取全文本方式（定死）：** 用**一次性 `provider.chat`**，不用流式 `chatStream` 再收集。取消靠 `signal` abort（复用一期 AbortSignal）；逐字 Token 进度本批不做。

**`run` 返回契约（定死，UI 据此写）：**

```ts
IpcResult<{
  reviewId: string | null;
  executionStatus: 'completed' | 'cancelled' | 'failed' | 'stale';
}>
```

| `executionStatus` | 含义 | `reviewId` | 落库 |
|---|---|---|---|
| `completed` | 成功 | **非空** | `execution_status=completed` |
| `cancelled` | 用户取消 | **非空**（已落取消行） | `cancelled` + gate/delivery `inconclusive` |
| `failed` | 请求失败或解析失败 | **非空**（已落失败行） | `failed` + gate/delivery `inconclusive` |
| `stale` | 开请求前或落 `completed` 前世代已变 | **`null`** | 见下「stale 落库」 |

渲染端按 `executionStatus` 分支：`stale` → 「正文已变化，请重新审稿」；`cancelled` → 「已停止」；`failed` → 显示失败信息（可再 `list` 拉失败行详情）。

**stale 落库（定死，两处时机）：**

1. **开请求前**（校验 `source_generation` 已不等于库内世代，或同章已有进行中的 run）：**不落库**，直接返回 `executionStatus:'stale'`，`reviewId=null`。
2. **落 `completed` 前**（`chat` 已返回、解析将通过，再读世代发现已变）：**不落 `completed`**；**也不落 `failed` 行**（避免把「正文被改」记成模型失败）；返回 `executionStatus:'stale'`，`reviewId=null`。若解析已失败则仍走 `failed` 落库（与世代无关）。

**取消契约（Mode A 必写清）：**

1. `run` 登记 stream-registry（持有 AbortController）后，立刻 `webContents.send('workflow:chapterReview:started', { streamId, projectId, chapterId })`，不等待终态。
2. 渲染端「停止」另调 `ai:cancelStream({ streamId, projectId })`，不依赖 `run` 的 await 先结束。
3. 取消成功后：`run` 的 await 以落库结束——`cancelled` + gate/delivery `inconclusive` + `dimensions_json=[]`，返回 `reviewId` 非空、`executionStatus:'cancelled'`。

流式 Token 逐字进度（B 形态）**降级为可选增强**，不作为二期验收项。

## 7. 审稿输出契约改造（二期必做，非附属）

### 7.1 prompt（`review.ts`）

- 15 维度缺一不可、不可重复、不可未知 id。
- 每维度改三态：`status: 'pass'|'issue'|'inconclusive'`，`score: number|null`（`inconclusive` 时 score 必须 null），`comment`，`evidence: string[]`（`issue` 必须有 evidence）。
- 仍须输出 **`issues[]`**（含 `severity`：`critical`/`warning`/…、`location` 等）；硬门禁聚合读 `issues` 的 `severity === 'critical'`，evidence 可与 `issues[].location` 同源。
- 删除「每个维度都要评分不要跳过」「没问题给 90 以上」等与三态冲突的句子。

### 7.2 解析与失败落库（主进程，定死）

解析失败（缺/重复/未知维度、inconclusive 带分、issue 无证据、非法 severity、非 JSON）或 **AI 请求失败（网络等）** → **必须落失败行**（不二选一）：

- `execution_status = failed`
- `gate_status = inconclusive`
- `delivery_status = inconclusive`
- `dimensions_json` / 必要时 `issues_json` 允许 `[]`，**不补假维度**

取消落库见第 6 节（`cancelled` + gate/delivery 均为 `inconclusive`）。

### 7.3 聚合（固定规则，写全）

```text
有效维度 = status 为 pass 或 issue 的维度
coverage = 有效维度数 / 15
quality_score = 有效维度 score 的算术平均（无有效维度则为 null）
```

| 条件 | gate_status | delivery_status |
|---|---|---|
| 解析/请求失败（见上） | `inconclusive` | `inconclusive` |
| 任一 issue `severity = critical` | `blocked` | `blocked` |
| 有效维度 &lt; 12（coverage &lt; 0.8） | `inconclusive` | `inconclusive` |
| 有效 ≥ 12、无 critical、`quality_score >= 70` | `pass` | `pass` |
| 有效 ≥ 12、无 critical、`quality_score < 70` | **`pass`** | **`revise`** |

注意：最后一行 **gate 仍是 pass**，只有 delivery 为 revise。阈值 12/15 与 70 分是产品常量，改须改 Spec + 单测。

## 8. 正文变更作废待处理修订

作者保存正文且 `shouldBumpContentGeneration` 为真时（含手工保存、历史恢复、其它写路径）：

1. 章节 `content_generation + 1`；
2. **同章所有 `status='proposed'` 的修订提案标为 `stale`**（写事务内完成）；
3. 界面提示审稿已过期、待处理修订已作废，需重新审——**语气不是「出错了」**（Spec 界面要求）。

应用修订路径已有世代比对；本条补的是「作者改字保存」旁路，避免旧提案仍显示可点「接受」。

**判据拆分（实施必须遵守，易踩坑）：** `chapter.repo.ts` 的 `update()` 里两处判断不同源，不得混用：

- **世代递增 + 作废 `proposed`**：用 `shouldBumpContentGeneration(old, new)`（normalize 判据，等价 HTML 不递增、不废审稿）；
- **打 `chapter_history` 快照**：暂留现有 `content !== chapter.content`（字符串全等），属非阻塞项，不强行统一。

同一函数内这两处判断**分开写**，禁止把「世代 +1」挂在 `content !==` 上，否则会违反「等价 HTML 不递增、不废审稿」。

## 9. 读侧状态机（界面真相源）

不持久化，由 list/loader 动态计算：

| 概念 | 规则 |
|---|---|
| `freshness_status` | `source_generation === 当前 content_generation` → `fresh`；否则 `stale` |
| `effective_delivery_status` | 若 stale → 对外 `stale`；否则用库内 `delivery_status` |
| **待复评** | 修订已应用到某世代（`applied` 且规范化正文曾 +1），且**该世代尚无**一份 `fresh` 且交付达标（`delivery_status === 'pass'` 且 `execution_status === 'completed'`）的审稿 |
| **当前版本通过** | 仅当存在针对**当前世代**的新鲜审稿，且 `delivery_status === 'pass'`（且非 failed/cancelled） |
| **世代未变的极端应用** | 修订稿与当前纯文本相同 → 世代不 +1，提案仍 `applied`，**界面不必进入待复评**（Spec §数据流第 8 步） |

过期报告可看历史，**不得**显示「当前版本通过」。

**「待复评」计算侧（定死）：** 由主进程 `list` / loader **动态计算并作为每章级布尔返回**（如 `pendingReReview: boolean`），依据上表「待复评」规则。渲染端直接展示、不自算，与「不持久化、list/loader 动态算」完全对齐。

## 10. 自动修订生成路径

`workflow:chapterReview:createRevision`：

1. **只能**基于「当前世代 + fresh + completed」的审稿生成；否则拒绝（`REVIEW_SOURCE_STALE` 或等价）。
2. 与 `run` 同型：完整 Provider 快照 + **`provider.chat`（非 chatStream）** + 先发 `workflow:chapterReview:started` + `ai:cancelStream` 可取消。
3. **取消策略（定死）：** 取消 **不落** `proposed`；若写提案前已占用唯一坑，事务回滚/删除，不得留下 `proposed` 或改标 `rejected` 充数。
4. 成功则写入 `chapter_revision_proposals`（`proposed`），带 `review_id` + `source_generation`；返回提案 id 与正文预览所需字段。
5. 同章已有 `proposed` → 写事务互斥拒绝（部分唯一索引兜底）。

`applyRevision` / `rejectRevision` 见第 13 节。`applyRevision` 成功回执须带更新后的章节字段（至少 `id`、`content`、`wordCount`、`contentGeneration`），供 `App.tsx` 回写列表，禁止再走裸 `db:chapter:update`。

## 11. 文件边界

新增：

- `src/main/ai/content-revision.ts`（normalize + shouldBump）
- `src/main/db/repositories/chapter-review.repo.ts`
- `src/main/db/repositories/chapter-review.service.ts`（解析/聚合/修订事务/正文变更作废 proposed）
- `src/main/ipc/chapter-review.ipc.ts`
- `src/renderer/services/chapter-review-loader.ts`（项目 ID + 代次守卫）

修改：

- `src/main/db/migrations.ts` — v23
- `src/main/db/repositories/chapter.repo.ts` — `create`/`update`/`restore` 接世代；回执带 `contentGeneration`；正文真变时作废同章 `proposed`
- `src/main/ipc/index.ts` — 注册
- `src/preload/index.ts` / `src/renderer/types/electron.d.ts` — 暴露 workflow invoke 与 `workflow:chapterReview:started` 事件
- `src/renderer/types/index.ts` — `Chapter.contentGeneration`；审稿三态类型
- `src/renderer/services/ai-prompts/review.ts` — 三态 prompt + issues[]
- `src/renderer/components/AIReviewPanel.tsx` — as-of + 组装 + workflow + 听 started 以便停止；历史列表；不再自解析/直写 update
- **`src/renderer/App.tsx`** — 接受修订走账本 IPC，用回执更新章节列表/字数/世代
- `AGENTS.md` / `CLAUDE.md` — 记二期账本与 v23（收口时）

## 12. IPC 契约（二期）

- `workflow:chapterReview:run` — 入参：`projectId`、`chapterId`、messages、**完整** Provider 快照、`source_generation`。主进程：`chat()`（非 stream）+ 先发 `started(streamId)` + await 终态。返回 §6 的 `{ reviewId, executionStatus }`（不是「只返回 id」）。
- `workflow:chapterReview:list` — 含动态 `freshnessStatus` / `effective_delivery_status` / `pendingReReview`（主进程按 §9 规则算好返回，渲染端不自算）
- `workflow:chapterReview:createRevision` — 同型 `chat()` + `started` + 可取消；取消不落 proposed
- `workflow:chapterReview:applyRevision` — 冲突 `REVISION_SOURCE_STALE`；成功带回章节快照（含 `contentGeneration`）
- `workflow:chapterReview:rejectRevision`
- 取消复用：`ai:cancelStream({ streamId, projectId })`（由 `started` 拿到 streamId）

错误码：

| 码 | 含义 |
|---|---|
| `REVIEW_RESPONSE_INVALID` | 结构不合格（通常伴随已落的 `failed` 行与 `executionStatus:'failed'`） |
| `REVIEW_SOURCE_STALE` | 开请求前世代已变 / 落 completed 前世代已变 / 审稿已过期不可生成修订 / 同章已有进行中的 run |
| `REVISION_SOURCE_STALE` | 应用时世代已变，提案标 stale，正文不动 |

## 13. 修订应用事务（关键）

单写事务：

1. 校验提案属于当前项目+章节且 `proposed`
2. 读当前 `content_generation`
3. 世代 ≠ `source_generation` → 提案标 `stale`，返回 `REVISION_SOURCE_STALE`，不改正文
4. `ChapterHistoryRepo.addSnapshot` 打当前快照
5. 写正文、字数；`shouldBumpContentGeneration` 为真则世代 +1
6. 记 `applied_generation`，提案标 `applied`

渲染端与 App **不得**再直接 `db:chapter:update` 绕过世代校验来「接受修订」。

## 14. 界面要求（AIReviewPanel）

- 显示：当前 / 过期 / 待复评 / 失败（规则见第 9 节）
- 分开展示：质量分、覆盖率、硬门禁、交付状态
- 过期报告可看历史，不显示「当前版本通过」
- 只能从当前世代对应的新鲜审稿生成修订
- 修订冲突时保留预览，提示正文已变化，不自动覆盖
- 应用成功且世代 +1 后显示待复评 + 「重新审稿」
- 作者保存改动导致过期时，提示需重新审（非错误语气）

**审稿历史列表范围（明确 UI 工作量）：** 面板从「单份 `result` state」改为「按 `chapter_reviews` 列表渲染 + 点选查看」。默认选中**当前世代**最新一份有效审稿；历史列表按 `created_at DESC` 展示，每条标注 fresh/stale/失败。这是实打实的 UI 改动，非仅换数据源。

## 15. 测试策略（TDD）

- 迁移：v22 无损升级 v23，DDL 与版本号同事务
- `normalizeChapterText`/`shouldBumpContentGeneration`：等价 HTML 不递增，改字/标点递增，只改标题不递增
- 解析：三态齐全/缺失/重复/未知 id、非法分数、issue 无证据 → `failed` + gate/delivery `inconclusive`
- 聚合：11 有效 → inconclusive；12 且 70 → gate pass + delivery pass；12 且 69.99 → **gate pass + delivery revise**；critical → blocked
- 修订事务：世代匹配成功+写历史；世代变化 proposal stale 正文不变；世代 +0 极端路径不必待复评
- 正文保存真变 → 同章 `proposed` 变 `stale`
- `REVIEW_SOURCE_STALE` / `executionStatus:'stale'`：开请求前不落库；落 completed 前世代变也不落 completed/failed，`reviewId=null`
- 取消：`started` 后 `cancelStream` → 落 `cancelled`（`reviewId` 非空）；createRevision 取消不落 proposed
- 请求/解析失败：必须落 `failed` 行（`reviewId` 非空）
- 同章最多一个 proposed；同章同时最多一个进行中的 run；归属不匹配拒绝
- 章节回执含 `contentGeneration`；apply 回执可更新 App 列表
- as-of 失败：不发起 run（渲染端先阻断）
- 真实 UI 回归：扩展过期 / 冲突 / 待复评 / 停止审稿（写作或审稿 UI 脚本）

编码前将本节拆成 checkbox Task（测→红→实现→绿→提交）；本文件保持契约与顺序，不代替逐 Task 清单。

## 16. 不在本计划范围

- 三期写章运行记录（`chapter_runs`，v24）
- 正文选区批注、审稿 DAG、多模型基准
- 把创作罗盘/风格指纹/Obsidian 上下文搬主进程
- 拆 typed IPC；**不**把 App 大重构当目标（仅接修订回写）
- 历史快照判据与世代纯函数强制统一（建议做，非阻塞）

## 17. 实施顺序

1. 改 Spec 迁移号（二期 v23、三期预告 v24）
2. 迁移 v23 + `content-revision.ts` + 单测
3. `chapter.repo.ts` 接世代递增（`create`/`update`/`restore` 三路径）+ 正文真变作废 `proposed`
4. 审稿 prompt 三态 + 类型 + `prompt_version` 常量
5. `chapter-review.repo.ts` + `service`（解析/聚合/应用/createRevision）
6. workflow IPC + 注册
7. `AIReviewPanel`：as-of + 组装 + workflow + 历史列表；`App.tsx` 修订回写
8. 全量回归 + 真实 UI 回归 + 报告；更新 AGENTS.md / CLAUDE.md

---

**请确认本计划。确认后先改 Spec 迁移号，再按顺序编码。**
