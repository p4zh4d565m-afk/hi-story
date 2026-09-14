# 叙事时间模型设计（P1，2026-09-14）

> **效力：** 本文是 P1 的独立设计 Spec，回答合同 `2026-09-13-ai-production-current-contract.md`「未批准」表里「叙事时间 as-of、事实时间字段、规划章稳定 key」的前置问题。**只设计，不编码。**
>
> **施工依据：** 冻结讨论稿 `2026-09-13-ai-long-novel-production-architecture-plan.md` 第 17.2～17.5 与第 18.3 Q1/Q2/Q5。第 1～11 节是历史提案，禁止据此写迁移；第 17.6～17.7（分析任务）不进本 Spec，归《章节分析任务设计》。
>
> **状态（2026-09-14）：** 已共同拍板，**采纳审查者替代方案**为正式方案（结论见第 8 节）。用户与开发者共同审过本 Spec 之后，不写 `migrations.ts`，不改事实/钩子/债务查询，不创建 `narrative-state-reducer` 实现文件；本 Spec 通过仅代表「模型可拆实施计划」，不自动授权迁移。

---

## 0. 一句话状况

P1 要解决的问题：AI 写/审/聊第 N 章时，只能按任务边界看到**第 N 章之前或及之前**有效的叙事状态，而不是「数据库此刻的最终状态」或「按 `created_at` 排的最后一条」。当前 `story_facts`/`character_knowledge`/`narrative_hooks`/`narrative_debts` 都**原地改 status 及其他业务字段**，没有可回放的时间截面；回看第 50 章时，一个在第 80 章才 `resolved` 的钩子，无法重建为 `open`，也无法还原它当时的 `description`/`subject`。

本 Spec 只做「模型」：定义故事时间序、状态回放语义、时间截面模式、规划章稳定 key、章节排序/删除不变量，以及锁死这些语义的**纯函数验收骨架**。不写任何迁移 DDL 或查询实现。

---

## 1. 已拍板约束（不可违反，来自合同）

以下约束已定案，本 Spec 的所有设计都必须服从：

1. **故事时间绑定稳定 `chapter_id`**；先后顺序在查询时按当前 `chapters.sort_order` 解析。不用标题里的「第 N 章」（作者改名会漂移），不用 `created_at`（那是数据库写入时间，不是故事时间）。
2. **旧债务整数期限 `promised_by_chapter` 不猜测映射**。不试图把整数「第 N 章」自动绑定到现有 `chapter_id`。
3. **as-of 不以完整 chapter-run 二期/三期为前置**。as-of 只需要稳定 `chapter_id` + 当前 `sort_order`，不依赖 `content_generation`、审稿两表、`chapter_runs`。
4. 事实/知识沿用 A5：**非 hook 事实与人物知识可自动落库**；hook、debt、推进、回收、偿还**只创建 proposal**，作者确认后才投影到正式表。
5. 非 hook 事实/人物知识可自动落库；**自动抽取不得静默覆盖 `source_decision_id IS NOT NULL` 的作者确认记录**。
6. 全局约束「AI 只能提候选」与 A5 的冲突已收敛为：自动抽取只落非 hook；状态机类变更（hook/debt 推进/回收/偿还）走 proposal。

---

## 2. 现状与证据（已核对 2026-09-14 HEAD）

### 2.1 四张叙事状态表的字段现状

| 表 | 已有的故事时间锚 | 缺什么（本 Spec 要补） |
|---|---|---|
| `story_facts` | `chapter_id`(FK SET NULL)、`status`(active/superseded/resolved)、`superseded_by`、`source_decision_id`、`source_kind` | 无 `state_key`；无「生效章」；`superseded`/`resolved` 无「发生在哪一章」；`fact_type` 混入 `hook` |
| `character_knowledge` | `learned_at_chapter_id`(SET NULL)、`status`(active/superseded)、`superseded_by`、`source_decision_id`、`source_kind` | `status` 原地改；`superseded` 无章锚（与 `story_facts` 同类缺口，需 `reduceKnowledgeAsOf`） |
| `narrative_hooks` | `chapter_id`(FK SET NULL)、`resolved_in_chapter_id`、`due_chapter_id`、`source_decision_id` | 后两项只是 TEXT，当前没有章节 FK；`status` 原地改；`partially_resolved`/`abandoned` 无章锚 |
| `narrative_debts` | `chapter_id`(FK SET NULL)、`promised_by_chapter`(**整数，旧**)、`paid_in_chapter_id`、`source_decision_id` | `paid_in_chapter_id` 只是 TEXT，当前没有章节 FK；`status` 原地改；`overdue`/`waived` 无章锚；无稳定 `promised_by_chapter_id` |

### 2.2 章节表与排序现状

- `chapters` 有 `id`(TEXT PK)、`sort_order`(INTEGER)；**无** `(project_id, sort_order)` UNIQUE，无 `deleted_at`。
- `chapter.repo.ts` 的 `reorder()`（159–173 行）只按下标 `UPDATE chapters SET sort_order = ?`，**不校验** `chapterIds` 是否恰好覆盖同项目全部章节、有无重复、有无跨项目 id。
- `chapter_history.chapter_id` 是 `ON DELETE CASCADE`；四张叙事表的主来源章锚（`story_facts.chapter_id`、`character_knowledge.learned_at_chapter_id`、`narrative_hooks.chapter_id`、`narrative_debts.chapter_id`）是 `ON DELETE SET NULL`。`resolved_in_chapter_id`、`due_chapter_id`、`paid_in_chapter_id` 当前只是 TEXT，没有 FK。**删章后行为不一致：** 短期快照被级联删光，主来源章锚被清空，其他章节引用则可能留下悬空字符串。

### 2.3 决策账本现状

- `creative_decisions` / `creative_decision_effects`（迁移 018）已存在。`effects` 有 `before_json`/`after_json`/`created_at`，但 `created_at` 是**墙钟**，`target_id` 无故事时间章锚。只有 `story_facts` / `character_knowledge` 有 `source_kind`（`legacy`/`chapter_extraction`/`author_decision`）；hook/debt 只能结合 `source_decision_id` 判断是否来自作者决策，不能声称四表都已用 `source_kind` 区分来源。

### 2.4 规划章现状

- `ChapterOutline`（types/index.ts 559–573 行）只有 `volumeIndex + chapterNumber`，**无持久化 `id`**。React key 用 `chapterNumber`（会随插章/换卷漂移）。hook/debt 绑定规划章时没有稳定 key 可绑。

---

## 3. 正式设计决策总览

| 讨论稿问题 | 正式决策（已采纳） | 关键点 |
|---|---|---|
| 17.2 历史状态回放 | **不可变完整快照转换行** | `transition_kind` + `after_snapshot`（必要时 `before_snapshot`），现有四表=最新物化投影，与转换日志同事务更新 |
| 17.3 时间截面 | **四模式 + Review 双区块** | `before_target`/`through_target`/`project_latest`/`planning_only`；Review 先验用 `before_target`，本章证据独立 |
| 17.4 规划章稳定 key | 给 `ChapterOutline` 加持久化 `id`，**内容不参与身份** | key=身份，chapterNumber/volumeIndex/标题/内容=位置；正文侧独立 `planning_outline_id` 绑定 |
| 17.5 + Q5 排序/删除/并章 | `(sort_order, id, ordinal, seq)` 全序 + **墓碑退出活跃排序** | 活跃章 `sort_order` 连续唯一；墓碑存 `deleted_sort_order`；永久删除前拒绝一切章节引用 |
| Q1 fact_type 状态/事件分类 | **分类型 `state_key` + 版本** | 状态型取目标章前最后一条，事件型范围内累计；`hook` 不再作为事实类型 |
| Q2 批量写章截面 | **临时摘要，不等分析** | 临时摘要绑前章文本 hash；未确认 proposal 不进后一章 |

下面逐节展开。

---

## 4. 核心设计

### 4.1 故事时间序：稳定 `chapter_id` + 全序比较

**故事位置比较键 = `(chapter.sort_order, chapter.id, at_chapter_ordinal, transition_seq)`。** 单看 `sort_order` 不构成全序（当前允许并列，且脏数据可能并列），必须逐级加 tie-break。

- 一条事实「属于哪一章」永远用 `chapter_id`，**重排/移章不改变事实的归属 id**。
- `sort_order` 只表达**顺序**，不表达**绝对章号**。作者把第 50 章移到第 30 章后，`sort_order` 变了，但 `chapter_id` 不变，发生在该章的事实随它一起移动。
- 全序前三段定位到「章」，第四段 `transition_seq` 只解决同一章锚 + 同一章内序号的完全并列，**不替代章内语义顺序 `at_chapter_ordinal`**。

**目标章不存在、跨项目或已删除时，as-of 必须返回显式错误，不得静默退化为 `project_latest`。**

### 4.2 历史状态回放（回答 17.2）：不可变完整快照转换行

**问题：** 现状 `status` 及 `subject`/`description`/`due_chapter_id`/`paid_in_chapter_id` 都原地改。只记状态名（`transition_kind`）无法回放完整历史——回看第 50 章会得到「旧状态 + 新描述/新期限」的混合快照。

**决策：引入不可变转换行，每条带完整 `after_snapshot`。这仍不是完整事件溯源——四张表继续保存最新投影，转换日志只负责历史回放。**

每条转换的语义字段（只定合同，本 Spec 不定 DDL）：

- `project_id`、`target_table`、`target_id`：三者共同校验归属，禁止跨项目引用。
- `transition_kind`：有限枚举（`created`/`superseded`/`resolved`/`paid`/`abandoned`/`waived`/`partially_resolved` …），不接受任意字符串。**`overdue` 不是转换行，见下「逾期是派生状态」。**
- `at_chapter_id`：**必填**的运行时故事章锚，必须属于同项目；规划章上的候选在正文创建前不得发布为运行时转换。
- `at_chapter_ordinal`：该变化在正文中的**章内语义顺序**。自动抽取取稳定的来源顺序；作者提议沿用所指证据的顺序；没有来源位置的新决策默认追加到本章末尾。**不得按确认墙钟赋序。**
- `transition_seq`：不可变的最终 tie-break，与当前投影更新在**同一写事务**分配。
- `after_snapshot`：该次转换后的完整、**版本化**业务快照（含 `snapshot_schema_version`）；回放结果从快照取得，不能再拼接四张表的当前可变字段。必要时带 `before_snapshot`。
- `decision_id`、`created_at`：只用于来源追踪和墙钟审计，**不参与故事时间比较**。

**排序与折叠规则：**

- `before_target` 排除目标章全部转换；`through_target` 包含目标章并按章内序号折叠。
- 同一 `state_key` 的多条记录、以及同一记录的多次转换，都按上述四段全序比较。

**逾期是派生状态，不是转换行。** `overdue` 不是作者在某章点过一次的事件，而是「未偿还债务的 `due_chapter_id` 已被当前截面越过」推出来的。as-of 第 35 章时，一条「第 40 章到期」的债务应仍是 `unpaid`，不是 `overdue`。因此 `overdue` **不进入 `transition_kind` 枚举**，也不写转换行；它由查询在折叠出 `unpaid` 后、再按 `due_chapter_id` 与目标章位置派生。旧记录里已有的 `status='overdue'` 属当前投影的便利标记，迁移后应规范回「`unpaid` + 期限章已过」的派生，不得反向伪造一条「逾期」转换。

**作者确认的故事时间 = 决策绑定的源章节，不是点确认的墙钟。** 作者在第 80 章确认了第 20 章抽出的钩子推进，转换行的 `at_chapter_id` 是第 20 章。这是 17.2 追问「decision effect 的 `created_at` 如何绑定故事时间」的答案：**绑定决策 payload 里的源章节，源章节由结构化字段传入并由 Main 校验，不能从 `source_message_id`、标题或墙钟猜测。** 追溯修正较早章节属合法，但 UI 应提示「会改变该章及后续章节的历史截面」。

**冲突规则（作者确认 vs 自动抽取）：**

- 自动抽取（`source_kind='chapter_extraction'`）**不得**对 `source_decision_id IS NOT NULL` 的记录追加 `superseded`/`resolved` 转换。
- 作者记录比自动记录权威，**不等于**「作者记录永远覆盖所有后续自动状态」；自动抽取遇到同 `state_key` 的作者记录时，应创建冲突候选，由作者决定是否形成新的作者转换。

**四表与转换日志的双真相防线：** 任何创建、修订、推进、回收、偿还都必须在**同一事务**内追加转换并更新最新投影；事务任一步失败全部回滚。否则转换日志与当前表会形成两个互相冲突的真相源。

**章节重抽取的 P1 接入约束：** 当前重抽取会硬删该章非 `source_decision_id` 的事实/知识后重插（`story-facts.repo.ts:79–80`）。引入历史转换后这条路径**必须停止硬删**：同一事务内把旧自动投影标记 retired/superseded、追加对应转换，再插入新投影；作者确认来源仍受现有保护。否则转换日志会指向不存在的 target，事件型事实也会把旧抽取与新抽取重复累计。**这里定义的是 P1 接入约束，不把分析 job 扩进本 Spec。**

### 4.3 旧数据策略（不伪造历史）

- 旧 hook 有创建章且有 `resolved_in_chapter_id` 时，可构造「创建为 open、终点为 resolved」的有限兼容视图；旧 debt 同理用 `paid_in_chapter_id`。
- `partially_resolved`、`abandoned`、`waived` 若没有可靠章锚，**不伪造转换**。`overdue` 本就是派生状态（见 4.2），旧记录里的 `status='overdue'` 规范回「`unpaid` + 期限章已过」的派生，不伪造转换行。
- 缺少可靠历史的旧记录：`project_latest` 可继续显示当前投影；`before_target`/`through_target` **不把当前 status 当成历史事实注入 AI**，而是在 `historyWarnings` 返回分类计数和记录 id，交由 UI 提示。
- `promised_by_chapter` 整数继续原样展示为 legacy 元数据，**绝不**自动绑定规划 key 或 `chapter_id`。

> 这比「按当前 status 返回并附一句历史不完整」更保守——后者仍会把第 80 章的最终状态泄漏给第 50 章请求。

### 4.4 时间截面模式（回答 17.3）

定义四种时间模式：

| 模式 | 语义 | 用在哪 | 是否含目标章 |
|---|---|---|---|
| `before_target` | 只取目标章**之前**的状态 | 写章、重写目标章 | 不含 |
| `through_target` | 取目标章**及之前**（含本章已发生的状态变化） | 复盘/审查**已完成**章 | 含 |
| `project_latest` | 全书当前已发生事实 | 普通对话讨论「目前到哪了」 | 全量 |
| `planning_only` | 只读策划输入，不进运行时事实时间线 | 正文尚未创建的规划章 | 不适用 |

**决策：**

- **Main 按 `taskType` 固定映射**，Renderer **不得自由传任意截面**。Main 校验合法组合，避免入口误传。
- 建议映射（本 Spec 只给默认，ContextAssembler 实现时再收窄）：
  - 写章 / 重写章 → `before_target`
  - 审稿（已完成章）→ `before_target` 先验 + 本章证据双区块（见下）
  - 普通对话（有活动章）→ 默认 `through_target`（以活动章为边界，含本章），用户可显式切 `project_latest`
  - 普通对话（无活动章）→ `project_latest`
  - 规划章（无正文）→ `planning_only`
- **开着活动章聊天不得默认看到全书最新。** `project_latest` 必须是**显式选择**，且 UI 明确标注「当前使用全书最新截面（含第 N 章之后的状态）」；否则作者开着第 20 章聊天会无意识地读到第 21 章之后的事实，重蹈「串章」旧病。

**Review 的双区块（重要修正）：** Review **不是**整体 `through_target`，而是两个明确区块：

1. `priorNarrativeState`：固定 `before_target`，表示进入本章之前模型可以知道的状态。
2. `targetChapterEvidence`：目标章正文，以及与**当前正文版本匹配**的本章派生结果。

若本章派生结果无法证明对应当前正文版本，就只审正文，不读取旧的本章抽取结果。由于本 Spec 明确不以前置 `content_generation` 为条件，第一阶段只提供正文；如何加入版本匹配的派生结果留给《章节分析任务设计》。

### 4.5 规划章稳定 key（回答 17.4）

**决策：给 `ChapterOutline` 增加持久化 `id`（TEXT），身份不参与内容。**

- `ChapterOutline.id` 是**不可变身份**；`volumeIndex`、`chapterNumber`、标题和内容**都不是身份材料**。插章、换卷、重排只改位置，不改 key。
- 旧 JSON 补 key 在**一次事务内**完成并持久化。事务提交前不存在外部引用，所以**无需用内容指纹追求跨回滚确定性**；若实施受 SQL-only 迁移限制，应先确定安全的应用层迁移机制，不在这里假定哈希算法。
- AI「重生成这一章」必须携带原 id；批量重生成先做旧/新章的一一映射，未映射项创建新 id，**不允许按相同位置暗猜身份**。
- Obsidian 只有在文档携带显式稳定 key、或作者确认过导入映射时才保留 key；路径 hash 只能作候选提示，**不能单独决定身份**（文件可移动，路径也可能被另一章复用）。

**key → chapterId 绑定：**

- 正文侧保存**独立 `planning_outline_id`** 绑定，不从 `planning_outline` 快照内容反推。绑定发生在 `create` 的**同一次 IPC/事务**（与 A1 同步返回 id 一致）。
- 一个规划 key 同时**最多绑定一个未永久删除的正文（含墓碑）**。软删保持绑定；恢复复用；显式「替换正文」时在事务内迁移绑定。**软删后不自动回到未绑定**——防止一个 key 同时对应墓碑与新正文。
- 「创建点」「期限点」「回收/偿还点」是**不同关系**。后续若 hook/debt 支持规划章，必须使用**带角色的引用**（`origin`/`due`/`resolution`），不能用一个含糊的 planning key 字段，再在建正文时无差别改写所有 `chapter_id`。

**未补 key 前，禁止把规划章写入 hook/debt 外键或期限模型。**

### 4.6 章节排序、删除、并章不变量（回答 17.5 + Q5）

**排序不变量（活跃章）：**

1. 活跃章（`deleted_at IS NULL`）的业务顺序 `sort_order` 连续且唯一（`0..n-1`）；数据库唯一约束也**只覆盖活跃行**。
2. `reorder`/`insertAfter` 在事务内**校验**：`chapterIds` 恰好覆盖该项目全部**活跃章**一次、无重复、全部属于该项目；校验失败不改任何行。
3. 插章、移章、拆章、并章完成后都走**同一个顺序规范化纯函数**，并有数据库级回归。
4. 任何唯一约束迁移都必须先按 `(sort_order, id)` 规范化旧脏数据；更新顺序时用两阶段临时值或可延迟约束方案，避免逐行更新撞唯一键。

**删除（墓碑，回答 Q5）：**

**决策：章节改为墓碑软删（`deleted_at`），不硬删除。**

- 删章 = 置 `deleted_at`，**保留** `chapter_history` 及四张叙事表的章节外键。墓碑**退出活跃排序**：把原位置写入 `deleted_sort_order`，再规范化其余活跃章。
- 恢复 = 插入 `min(deleted_sort_order, activeCount)`；先为后续活跃章腾位，再清墓碑并规范化。多个墓碑保存相同旧位置不构成冲突，恢复顺序由用户动作决定。
- as-of 查询**排除**已删除章，其上绑定的叙事状态**不丢归属**（`chapter_id` 仍指向墓碑）；这些状态**不称「孤儿」**（它们并未失去 `chapter_id`），UI 提示「有 N 条叙事状态位于已删除章节」，由作者决定迁移/归档/放弃。
- **永久删除前拒绝**：依赖检查不能只看四表的主 `chapter_id`，还要覆盖转换行的来源/终点/期限章、规划章绑定、章节历史，以及决策 payload 中尚未正规化的章节引用；仍有依赖就提示分类计数，要求作者先迁移、归档或明确放弃。**「有引用就拒绝」优先于依赖 `SET NULL` 或保留悬空 TEXT。** 删除整个项目的级联清理不走这个单章门禁。
- Undo 只恢复墓碑（清 `deleted_at`），不猜测重绑。
- 墓碑章上的来源、终点、期限转换全部从精确 as-of 排除并分类提示。

**并章（回答 17.5 + T4 的「谁留谁迁」）：**

并章 = 两章合一，**幸存章保留 `chapter_id` 与活跃顺序，被并章软删为墓碑**。被并章的内容融进幸存章，因此它不再是独立时间点——其上绑定的叙事状态**必须显式迁移到幸存章**，否则它们会跟着墓碑一起从 as-of 永久消失，等于「静默丢失」。迁移规则：

1. **迁移手段：章节别名映射 + 章内顺序偏移，不改写、不复制快照。** 追加一条 `chapter_alias`（`from`=被并章 → `to`=幸存章，`ordinalOffset`=被并章转换解析到幸存章后的章内序号偏移，默认 = 幸存章已有转换最大 `at_chapter_ordinal` + 1，表达「被并章内容排在幸存章之后」）。as-of 折叠时，凡章节引用等于 `from` 的（转换行 `at_chapter_id`、事实/知识/钩子/债务的主章锚与 `due`/`resolved`/`paid`/`learned` 等副锚），先解析到 `to` 再定位；转换的章内序号经 `ordinalOffset` 调整后再参与排序，避免与幸存章原有转换的 `(ordinal, seq)` 撞车。**连续并章时 `ordinalOffset` 沿 alias 链递归累加**（A→B 再 B→C，A 的序号 = 原序号 + offset(A→B) + offset(B→C)）；**并章后幸存章新增转换的序号，必须按「直接绑定 + 经别名映射过来」全部转换的最大有效序号 + 1 分配**，不得重新占用已映射的序号。**不改写任何既有转换的 `at_chapter_id`（不可变），不追加只含「迁移后当前快照」的转换**——后者会把后来才 `resolved`/`paid` 的最终状态提前压到幸存章，导致回看并章前后章节时状态错位。
2. **可追溯，不静默改 id：** `chapter_alias` 本身就是迁移的可追溯记录（`from`→`to`）；被迁移状态的原 `chapter_id` 不丢、转换行不重写，历史可解释「这条状态原属于被并章」。
3. **规划绑定：** 幸存章 key 保留；被并章 key 进入「已废弃」（见 4.5）。被并章的正文绑定随墓碑处理，不自动绑到幸存章（幸存章已有自己的绑定）。
4. **作者确认：** 并章是破坏性结构操作，迁移前向作者展示「被并章上还有 N 条叙事状态将随别名映射归属幸存章」，确认后才执行；不静默自动并。

### 4.7 `fact_type` 状态/事件分类（回答 Q1）

**决策：确定性映射 + 分类型 `state_key`，不让模型临时分类。**

| `fact_type` | 类别 | as-of 语义 |
|---|---|---|
| `location` | **状态** | 同 `state_key` 只保留目标章之前最后一条 |
| `possession` | **状态** | 同上 |
| `relationship` | **状态** | 同上 |
| `emotional_state` | **状态** | 同上 |
| `event` | **事件** | 按章节范围**累计**（不互相取代） |
| `knowledge` | **走人物知识表** | 不在 `story_facts` 里再还原；as-of 用 `learned_at_chapter_id` |
| `hook` | **不再是事实类型** | A5 已把 hook 抽到 `narrative_hooks` proposal；停止新写；旧 `fact_type='hook'` 行迁移时**归档**（移出 `story_facts` 或加 `archived` 标记、保留原文），**不物理删除**，**不得双写** |

**`state_key` 按类型分别定义并版本化规范器**（原「`subject` + 谓词/对象 key」过宽，尤其把状态值 `object` 放进 key 会让「人在北京」「人在上海」无法互相取代）：

| 类型 | key 组成（规范化后） | object 是否进 key |
|---|---|---|
| `location` | 主体 + 位置维度 | 否，object 是当前值 |
| `possession` | 主体 + 物品身份 | 是，状态表示是否/如何持有该物 |
| `relationship` | 无向关系用排序后双方；有向关系保留方向；再加关系维度 | 另一方身份进 key，关系状态值不进 |
| `emotional_state` | 主体 + 情绪维度 | 否，object 是当前值 |

规范器输出同时带 `state_key_version`。无法确定主体身份或关系方向时**不猜测合并**：保留为独立记录并产生冲突提示。

### 4.8 批量写章的临时摘要边界（回答 Q2）

- 临时摘要只属于当次批量运行，来源必须绑定前一章本次生成文本的 hash；不写入正式事实、知识、hook、debt 或决策账本。
- 后一章只可读取已完成前序章的临时摘要；未确认 proposal 一律不注入。
- 作者改动任一已生成前序章、hash 不再匹配时，该章之后尚未开始的排队任务全部作废并要求重新排队；已经开始的请求按现有取消合同终止或丢弃迟到回执。
- 应用退出、批量取消或运行失败后临时摘要可丢弃，不把它伪装成可恢复的章节分析结果。是否持久化批量运行属于独立 chapter-run / 分析任务设计。

---

## 5. 纯函数验收骨架

以下是锁死上述语义的纯函数接口与测试矩阵（**只列签名与断言，不写实现**）。实现时落在 `src/main/ai/` 下的 reducer 文件，但本 Spec 阶段不建文件。

### 5.1 纯函数签名（设计意图）

```ts
// 章节故事位置：比较用 (sort_order, id) 全序；sortOrder === null 表墓碑
type ChapterPosition = { id: string; projectId: string; sortOrder: number | null; deletedSortOrder: number | null };
function compareStoryPosition(a: ChapterPosition, b: ChapterPosition): number;   // 跨项目抛错
function chaptersBefore(chapters: ChapterPosition[], target: ChapterPosition): ChapterPosition[];
function normalizeChapterOrder(chapters: ChapterPosition[]): ChapterPosition[];  // 活跃章 0..n-1
function deleteChapter(chapters: ChapterPosition[], deletedId: string): ChapterPosition[];   // 活跃退出 + 记 deletedSortOrder
function restoreChapter(chapters: ChapterPosition[], restoredId: string): ChapterPosition[]; // 插回 min(deletedSortOrder, activeCount)

// 章节别名（并章）：被并章 → 幸存章；ordinalOffset 保持并章后章内顺序；不改写转换、不复制快照
type ChapterAlias = { from: string; to: string; ordinalOffset: number };
function mergeChapters(chapters: ChapterPosition[], aliases: ChapterAlias[], survivingId: string, mergedId: string, ordinalOffset: number): { chapters: ChapterPosition[]; aliases: ChapterAlias[] };
function resolveChapterId(id: string, aliases: ChapterAlias[]): string;  // 递归 + visited 防循环
function resolveTransitionOrdinal(atChapterId: string, atChapterOrdinal: number, aliases: ChapterAlias[]): number;  // 沿 alias 链递归累加每级 ordinalOffset（连续并章多级累加），visited 防环

// 版本化快照
type Snapshot = { schemaVersion: number; data: unknown };

// 转换行：含章内序号与最终 tie-break
type Transition = {
  targetId: string;
  kind: 'created' | 'superseded' | 'resolved' | 'paid' | 'abandoned' | 'waived' | 'partially_resolved';
  atChapterId: string;
  atChapterOrdinal: number;
  seq: number;
  afterSnapshot: Snapshot;
  decisionId?: string;
};

// 统一返回：data === null 表「无运行时状态」（planning_only / 旧记录被排除）；集合型用 data: [] 表空
type HistoryWarning = { kind: string; recordId: string; message: string };
type ReductionResult<T> = { data: T | null; historyWarnings: HistoryWarning[] };

function compareTransition(a: Transition, b: Transition, chapters: ChapterPosition[], aliases: ChapterAlias[]): number;

// 故事位置解析：resolveChapterId 别名 + 定位；跨项目/不存在/已删抛错
function storyPositionOf(chapterId: string, chapters: ChapterPosition[], aliases: ChapterAlias[]): ChapterPosition;

// 状态转换折叠：从 after_snapshot 折叠出目标时刻状态；planning_only 返回 data: null
function reduceTransitionAsOf(
  transitions: Transition[], chapters: ChapterPosition[], aliases: ChapterAlias[], target: ChapterPosition | null, mode: TimeMode,
): ReductionResult<unknown>;

// 状态型事实归约：同 state_key 取目标章前最后一条（不取 created_at 最新）
function reduceStateFactsAsOf(
  facts: Fact[], transitions: Transition[], chapters: ChapterPosition[], aliases: ChapterAlias[], target: ChapterPosition | null, mode: TimeMode,
): ReductionResult<Fact[]>;

// 事件型事实累计：目标章范围内累计，排除已 superseded 的退休事件
function accumulateEventsAsOf(
  facts: Fact[], transitions: Transition[], chapters: ChapterPosition[], aliases: ChapterAlias[], target: ChapterPosition | null, mode: TimeMode,
): ReductionResult<Fact[]>;

// 钩子/债务/知识回放：已 resolved/paid/superseded 的恢复到更早状态（含字段快照，不穿越）
function reduceHookAsOf(hook: Hook, transitions: Transition[], chapters: ChapterPosition[], aliases: ChapterAlias[], target: ChapterPosition | null, mode: TimeMode): ReductionResult<Hook>;
function reduceDebtAsOf(debt: Debt, transitions: Transition[], chapters: ChapterPosition[], aliases: ChapterAlias[], target: ChapterPosition | null, mode: TimeMode): ReductionResult<Debt>;
function reduceKnowledgeAsOf(knowledge: Knowledge, transitions: Transition[], chapters: ChapterPosition[], aliases: ChapterAlias[], target: ChapterPosition | null, mode: TimeMode): ReductionResult<Knowledge>;

// 逾期派生：unpaid + 期限章被目标章越过 → overdue（不进转换行）
function deriveDebtOverdue(debt: Debt, chapters: ChapterPosition[], aliases: ChapterAlias[], target: ChapterPosition | null): boolean;

// 分类型 state_key（relationship 需 directed 标志，调用方传入）
type StateKeyInput =
  | { factType: 'location' | 'possession' | 'emotional_state'; subject: string; predicate: string; object: string }
  | { factType: 'relationship'; subject: string; predicate: string; object: string; directed: boolean };
function deriveStateKey(fact: StateKeyInput): { key: string; version: number };

function verifyProjectionMatches(projection: unknown, transitions: Transition[], chapters: ChapterPosition[], aliases: ChapterAlias[]): boolean;
function canAutoExtractOverwrite(record: { sourceDecisionId: string | null }): boolean;

// 时间模式 + taskType 映射 + 非法组合校验
type TimeMode = 'before_target' | 'through_target' | 'project_latest' | 'planning_only';
type TaskType = 'write' | 'review' | 'chat' | 'planning';
function resolveTimeMode(taskType: TaskType, opts: { hasActiveChapter: boolean }): TimeMode;
function validateTaskTimeMode(taskType: TaskType, requestedMode: TimeMode): TimeMode;  // 非法组合抛错
```

### 5.2 测试矩阵（插章/移章/删章/并章 + as-of 回放）

| # | 场景 | 断言 |
|---|---|---|
| T1 | 在第 20 章前插入新章 | 原第 20 章事实随原 `chapter_id` 后移（`sort_order` 变 21），归属 id 不变 |
| T2 | 把第 50 章移到第 30 章后 | 发生在第 50 章的事实生效顺序随章节移动，`chapter_id` 不变 |
| T3 | 拆章 | 新拆出的章的事实只有作者确认/重新分析后才进入状态；原章 key 保留，新章 key 新建 |
| T4 | 并章 | 被并章软删为墓碑 + 追加 `chapter_alias`（被并章→幸存章）；as-of 折叠时被并章上的事实/知识/钩子/债务经别名解析到幸存章仍可见，不改写任何转换、不压扁历史；规划 key 幸存者留、被并者废弃 |
| T5 | 重写早期章节并重新抽取 | `created_at` 更新不改变它的故事位置（仍按 `chapter_id`+`sort_order` 定位） |
| T6 | 规划章未建正文 | 只使用 planning key，不进运行时事实表 |
| T7 | 回看已关闭钩子 | 第 80 章 `resolved` 的钩子，回看第 50 章（`through_target`）仍 `open` |
| T8 | 回看已偿债务 | 第 90 章 `paid` 的债务，回看第 60 章仍 `unpaid` |
| T9 | 回看 partially_resolved | 第 70 章 `partially_resolved`、第 90 章 `resolved` 的钩子，回看第 75 章是 `partially_resolved` |
| T10 | 删章墓碑关联项 | 绑定已删章的事实**不出现在 as-of**；归属 `chapter_id` 仍指向墓碑，UI 可提示 |
| T11 | `sort_order` 并列 | `(sort_order, id)` 保证全序：同 sortOrder 时按 id 字符串序，不产生「时而之前时而之后」 |
| T12 | 旧记录无转换行 | as-of 不进精确历史结果，进 `historyWarnings`；不伪造历史；整数期限不猜测映射 |
| T13 | 作者确认 vs 自动抽取 | 自动抽取不得对 `source_decision_id IS NOT NULL` 的记录追加 supersede/resolve |
| T14 | 事件型累计 | `event` 型在目标章范围内全部累计，不互相取代 |
| T15 | 状态型取最后一条 | 同 `state_key` 取目标章之前最后一条，不取 `created_at` 最新 |
| T16 | 批量中途改前章 | 前章文本 hash 改变后，后续未开始任务全部作废；临时摘要和未确认 proposal 不进入正式叙事状态 |
| T17 | 字段穿越 | 第 80 章修改 hook 描述并 resolved，回看第 50 章得到旧描述 + open，不出现字段穿越 |
| T18 | 同章多转换 | 同章先 partially_resolved 再 resolved，`through_target` 按 `at_chapter_ordinal`、`transition_seq` 得到 resolved，可复现 |
| T19 | 双真相防线 | 转换写入成功、当前投影更新失败，整个事务回滚，不出现双真相 |
| T20 | 旧记录仅当前 status | 历史截面不注入该状态，`historyWarnings` 可见 |
| T21 | 软删中间章再恢复 | 活跃顺序始终连续唯一；恢复到保存位置，墓碑绑定不丢 |
| T22 | 规划 key 正文软删后再创建 | 第二次绑定被拒；显式替换事务才允许迁移 |
| T23 | Obsidian 路径被另一章复用 | 不因路径 hash 相同而继承旧 key |
| T24 | location 从北京变上海 | 两条记录同 state_key，目标截面只取当时最后位置 |
| T25 | Review 目标章已有过时抽取 | 先验只取 `before_target`，过时本章抽取不进入证据区 |
| T26 | 目标章跨项目/已删除 | Main 明确拒绝，不退化到 latest |
| T27 | 同章重新抽取事实/知识 | 旧自动投影不硬删且不重复累计；作者确认记录不动，转换 target 始终可追溯 |
| T28 | 逾期是派生 | 第 40 章到期的债务，as-of 第 35 章仍是 `unpaid`，不是 `overdue`；`overdue` 不进转换行 |
| T29 | 人物知识回放 | 第 85 章 superseded 的知识，回看第 60 章仍 `active`；知识表 status/superseded_by 按转换行折叠 |

### 5.3 时间模式映射测试

| # | 场景 | 断言 |
|---|---|---|
| M1 | 写章用 `before_target` | 不含目标章自身的旧分析/未来信息 |
| M2 | 审稿先验用 `before_target` | 先验状态不含目标章；目标章正文/派生证据独立提供 |
| M3 | 普通对话无活动章 | 默认 `project_latest` |
| M4 | 普通对话有活动章 | 默认 `through_target`（活动章边界），不默认 `project_latest`；切 `project_latest` 需显式且 UI 标注 |
| M5 | 规划章无正文 | `planning_only`，只读策划输入 |
| M6 | Main 校验非法组合 | Renderer 传「写章 + through_target」被拒 |
| M7 | 目标章跨项目/已删除 | Main 明确拒绝，不静默退化为 `project_latest` |

---

## 6. 明确不做（本 Spec 边界）

- **不写 `migrations.ts`**，不改任何现有查询、repo、IPC 实现，不建 reducer 实现文件。本 Spec 里出现的表/字段/函数签名都是**设计目标**，不是本轮编码产物。
- **不回答 17.6～17.7**（分析任务的「发布事务」、可恢复 job 的 Provider 契约）——它们归《章节分析任务设计》。
- **不创建 `chapter_analysis_jobs` / `ContextAssembler`**；不复活 `content_revision`。
- **不做 chapter-run 二期/三期**（审稿账本、写章运行单）——平行产品轨，不挡 P1。
- **不把 `content_generation` 当作 as-of 前置**；as-of 只依赖稳定 `chapter_id` + 当前 `sort_order`。
- **不猜测映射旧整数债务期限** `promised_by_chapter`。
- **不扫真实 vault**；规划章补 key 的既有数据回填用仓库内 fixture，不读用户 Obsidian 目录。
- **重抽取不硬删**是 P1 接入约束的定义，但**执行**归分析任务设计；本 Spec 不扩进分析 job 语义。

---

## 7. 实施顺序与完成标准（供批准后执行）

### 7.1 顺序（本 Spec 通过后）

1. 写失败测试：5.2 的 T1–T29、5.3 的 M1–M7（纯函数，先用 reducer 的 stub 签名）。
2. 实现纯函数：`compareStoryPosition` → `compareTransition` → `chaptersBefore` → `reduceTransitionAsOf` → 各 `reduce*AsOf` → `normalizeChapterOrder`/`deleteChapter`/`restoreChapter`。
3. 纯函数测试全绿后，才进入「迁移 DDL + 查询接入」的**下一份独立授权**（届时迁移号读 `MIGRATIONS` 定，不信讨论稿第七节旧号）。
4. 接入查询时，写章/审稿/对话**显式传目标章**，去掉 `MAX(sort_order)` 当「当前章」。

### 7.2 完成标准

- 上述 36 条测试（T1–T29、M1–M7）全绿；`compareStoryPosition` 与 `compareTransition` 的全序各有回归。
- 插章/移章/拆章/并章/删章/恢复的语义各有纯函数锁定，不依赖真实 DB。
- as-of 回看已关闭钩子/债务的恢复、字段不穿越、同章多转换可复现各有测试。
- 未写任何迁移 DDL、未改任何查询实现。

### 7.3 进入下一份授权前必须补进实施计划的已知项

1. **`at_chapter_ordinal` 的来源依赖分析任务。** P1 纯函数阶段只能先定义排序键规则 + 「无来源位置时默认追加本章末尾」的兜底；精确的章内语义序号（从抽取证据生成、作者可修正并保持稳定）要等《章节分析任务设计》。P1 落地时同章多变化只是「按追加序 + `transition_seq`」近似，不得宣称已做到精确章内排序。
2. **`after_snapshot` 的版本化。** `snapshot_schema_version` 必须从第一天就带上（与 `entity_revisions.schemaVersion` 同源考量），否则业务字段变更后旧快照无法解读。
3. **「决策 payload 里尚未正规化的章节引用」作为永久删除依赖检查项是必须的**，但「把 payload 章节引用正规化成结构化列」本身可能超 P1 范围：P1 至少做到「永久删除检查能发现 `creative_decisions.payload_json` 里的章节引用并拒绝/提示」，正规化留后续，不塞进 P1。

---

## 8. 已拍板结论（2026-09-14 共同评审）

本节记录原默认方案（已废弃）与审查者替代方案（已采纳）的逐项结论，作为追溯，不再保留两套并行正文。

| # | 分歧点 | 结论 |
|---|---|---|
| 1 | 转换内容 | **采纳替代案**：`transition_kind` + `after_snapshot`（必要时 `before_snapshot`），现有表=最新物化投影，与转换日志同事务更新 |
| 2 | 同章顺序 | **采纳替代案**：`at_chapter_ordinal + transition_seq`，禁止用墙钟/随机 id 推断故事顺序 |
| 3 | 旧数据 | **采纳替代案**：有可靠终点章的有限回放；其余进 `historyWarnings`，不注入当前 status |
| 4 | Review 截面 | **采纳替代案**：`before_target` 先验 + 本章证据双区块，而非整体 `through_target` |
| 5 | 规划 key 身份 | **采纳替代案**：内容不参与身份；软删正文继续占用绑定；路径 hash 只作候选提示 |
| 6 | 软删排序 | **采纳替代案**：活跃章 `sort_order` 连续唯一，墓碑存 `deleted_sort_order`，退出活跃唯一约束 |
| 7 | `state_key` | **采纳替代案**：分类型规范化 + `state_key_version`，object 是否进 key 按类型区分 |
| 8 | 重抽取 | **采纳替代案**：硬删改同事务退休旧投影 + 追加转换 + 插入新投影（P1 只定义约束） |

审查者替代方案的完整论证（字段穿越、章内顺序、墓碑排序、state_key 的 object 进 key bug、重抽取 target 悬空）已核对代码属实，见本文件第 2 节与第 4 节对应小节的「现状与证据」。
