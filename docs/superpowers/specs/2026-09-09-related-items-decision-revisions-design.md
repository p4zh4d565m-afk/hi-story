# 疑似相关项提示与决策修订设计

## 目标

在现有 v18 创作决策确认账本上增加纯规则的“疑似相关项提示”和完整修订入口。作者确认提议前，可以看到当前项目中规则相关的活跃事实、人物知识、叙事钩子或叙事债务，并选择新增独立项、修订已有项或取消本次确认。

本功能不调用 AI 做匹配，不自动合并语义，也不静默覆盖运行时记录。匹配、目标归属校验、同目标待确认修订互斥和最终投影均在主进程完成；渲染端只展示结果、收集作者选择并调用账本 IPC。

## 范围与边界

本功能包括：

- 迁移 v19，为 `narrative_hooks` 和 `narrative_debts` 增加 `subject`。
- 四类决策提议的疑似相关项查询与确认前选择。
- 没有账本父决策、但明确指向活跃目标记录的修订。
- 同一运行时目标最多保留一个 `proposed` 修订。
- 已确认决策的“创建修订”入口。
- 项目切换、迟到回执、失败重试和重复点击防护。

以下内容不在本功能范围：

- 自动语义匹配或自动合并。
- 自动替作者判断人物知识是否应被取代。
- 修改或写回 Obsidian。
- 将新决策写入旧 `foreshadowings` 表。
- 改写 v18 已确认的四类不对称修订语义。

界面与文档中的功能名称统一使用“疑似相关项提示”。

## v19 数据迁移

迁移 v19 执行：

```sql
ALTER TABLE narrative_hooks
  ADD COLUMN subject TEXT NOT NULL DEFAULT '';

ALTER TABLE narrative_debts
  ADD COLUMN subject TEXT NOT NULL DEFAULT '';
```

迁移必须遵守现有原子迁移约束：两条 DDL 与 `_migrations` 的 v19 版本登记处于同一个 SQLite 事务。迁移保留全部旧数据；旧钩子和债务升级后的 `subject` 为 `''`。

`NOT NULL DEFAULT ''` 只防止数据库写入 `NULL`，不保证主体非空。应用层采用两套明确规则：

- 作者显式创建决策提议或修订 hook/debt 时，`subject` 必填，经过 `trim` 后不得为空。
- 自动章节同步仍兼容缺少主体的抽取结果，允许 `CreateHookInput.subject`、`CreateDebtInput.subject` 缺省或为空，并以 `''` 保存。

不得通过收紧底层 create 输入破坏现有章节自动同步链路。

## 类型与兼容性

共享类型按以下规则扩展：

- `NarrativeHook`、`NarrativeDebt` 增加 `subject: string`。
- `HookDecisionPayload`、`DebtDecisionPayload` 增加 `subject: string`。
- `CreateHookInput`、`CreateDebtInput` 增加可选的 `subject?: string`，专门兼容自动抽取和旧调用方。
- `UpdateHookInput`、`UpdateDebtInput` 增加可选的 `subject?: string`。
- AI 决策提取提示、渲染端解析和主进程载荷校验均要求新 hook/debt 提议包含非空 `subject`。

`NarrativeHooksRepo` 必须同步覆盖完整读写链路：`create`、`createDebt` 的 INSERT 写入 `subject`，`update`、`updateDebt` 的 UPDATE 能更新 `subject`，`rowToHook`、`rowToDebt` 将数据库列映射到共享类型。自动创建未传主体时写入 `''`，不能把 `undefined` 传入 SQLite。

旧 v18 的 hook/debt `payload_json` 可能不存在 `subject`。读取旧账本行时必须归一为 `subject: ''`，保证 UI 和类型稳定；不得因旧载荷缺字段导致整个账本加载失败。作者若要编辑、确认或创建修订，必须先补填非空主体。已确认旧决策仅用于历史展示时可以继续显示空主体。

`App.tsx` 的章节摘要/事实抽取自动同步链路必须保留豁免：从 `fact.subject` 读取主体并传给 `db:narrativeHooks:create`；该值缺失或归一化后为空时仍允许保存。空主体的自动同步记录不参加精确规则匹配，但会进入同类活跃项兜底区。

## 统一归一化规则

所有规则匹配使用同一个纯函数：

```ts
function normalize(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase();
}
```

归一化只用于生成比较键，不改写数据库原文。所有查询必须严格限制当前 `projectId`，只返回规则定义中的活跃记录。SQL 先按项目、状态和类型粗筛，主进程 JavaScript 再执行 NFKC 归一化与精确比较。

## 四类疑似相关项规则

### 故事事实

只查询 `status = 'active'` 的当前项目记录，匹配键按事实类型分档：

| `factType` | 匹配键 |
| --- | --- |
| `location`、`emotional_state` | `normalize(subject) + factType` |
| `event`、`knowledge`、`relationship`、`possession` | `normalize(subject) + factType + normalize(object)` |

`relationship` 和 `possession` 必须包含 `object`，避免把同一主体可累积的多段关系或多个持有物误判为同一项。不同 `object` 不返回为疑似相关项。

### 人物知识

人物知识不做自动取代判断，面板标题使用“相关已有条目”。只查询当前项目 `status = 'active'` 的记录：

- 提议有 `characterId` 时，仅按 `characterId` 查询。
- 提议没有 `characterId` 时，按 `normalize(characterName)` 查询。
- 结果按 `created_at DESC, id DESC` 排序，最多 20 条。

作者可以查看条目后自行选择是否修订。

### 叙事钩子

活跃状态固定为 `open`、`partially_resolved`。精确规则键为：

```text
hookType + normalize(subject)
```

提议或目标记录的 `subject` 归一化后为空时，不进入精确规则匹配。

### 叙事债务

活跃状态固定为 `unpaid`、`overdue`。精确规则键为：

```text
debtType + normalize(subject)
```

提议或目标记录的 `subject` 归一化后为空时，不进入精确规则匹配。

### 空主体兜底区

hook/debt 面板除精确规则结果外，增加独立分区：

> 同类活跃项（缺少主体，无法自动配对）

- hook：当前项目、相同 `hookType`、状态为 `open` 或 `partially_resolved`，且 `normalize(subject) === ''`。
- debt：当前项目、相同 `debtType`、状态为 `unpaid` 或 `overdue`，且 `normalize(subject) === ''`。
- 两类各自按 `created_at DESC, id DESC` 排序，最多 20 条。
- 作者可以对兜底条目选择“修订此项”。

选择后沿用当前 AI 提议内容，仅将所选目标 ID 写入 `payload.targetId`。保存和确认前仍要求当前提议的 `subject` 非空。该入口用于章节自动抽取、没有账本来源且主体为空的旧 hook/debt，不伪造父账本决策。

## 主进程查询边界

`CreativeDecisionRepo` 增加按已保存 `proposed` 决策查询疑似相关项的方法，并由新的 `db:creativeDecisions:*` IPC 暴露。请求至少携带 `projectId` 和 `decisionId`；仓储重新读取已保存载荷、校验决策归属和状态，再根据决策类型查询目标表。

返回结果区分：

- 规则精确匹配项；
- 人物知识的“相关已有条目”；
- hook/debt 的“同类活跃项（缺少主体，无法自动配对）”。

渲染端不得自行加载整张目标表后复刻匹配规则，也不得串联 `storyFacts`、`narrativeHooks` 等 IPC 完成确认。目标是否仍活跃、是否属于当前项目，必须由主进程在查询和确认时分别校验。

## 确认前选择

待确认提议存在相关项时，确认前展示三种结果：

- **作为独立项确认**：将 `payload.targetId` 保持为 `null` 或明确改为 `null`，保存 proposal 后走新增投影。
- **修订此项**：将所选活跃目标记录 ID 写入 `payload.targetId`，保存 proposal 后再确认。
- **取消确认**：本次不确认也不拒绝，proposal 继续保持 `proposed`。

已经带有 `targetId` 的明确修订不重复弹出选择，只清楚展示目标记录以及“将修订哪一项”。有父修订不能改选独立项或其他目标。

批量确认逐项收集选择。选择“取消确认”的 proposal 不进入本次 `confirmMany`。任何 proposal 选择保存失败时，本次批量确认整体停止，不得调用 `confirmMany`，因而不能产生任何运行时写入。保存成功后才允许发起一次 `confirmMany`。

## 无父决策修订

章节自动抽取和旧数据可能没有 `creative_decisions` 来源。系统允许：

```text
parentDecisionId = null
payload.targetId = 当前项目中的活跃目标 ID
```

这类 proposal 确认后成为修订链的根决策，不创建虚假父决策，不 supersede 任何账本父项，但仍按 v18 写入 `creative_decision_effects`。该根决策确认后，可以通过普通 `createRevision` 继续形成后续修订链。

`confirmMany` 选择新增或修订路径只看 `targetId`：

```ts
const targetId = getTargetId(decision);
const applied = targetId
  ? this.applyRevision(decision)
  : this.applyNewDecision(decision);
```

不得再以 `parentDecisionId` 是否存在来决定投影路径。`applyRevision` 继续只依赖已经校验过的 `targetId`。

## 同目标待确认修订互斥

旧的“同一父决策不能同时确认多个修订”统一替换为“同一运行时目标只能有一个 pending 修订”。目标键固定为：

```text
targetTable + targetId
```

不为 `targetId` 新增数据库列或 JSON 索引。项目内 proposal 数量较少，仓储读取当前项目的 `proposed` 决策并解析 `payload_json` 后在内存比较。

三个入口必须独立防御：

1. `updateProposal`
   - 新 draft 带 `targetId` 时，扫描当前项目所有 `proposed` 决策。
   - 排除正在更新的 `decisionId`。
   - 已存在相同 `targetTable + targetId` 时拒绝保存。
2. `createRevision`
   - 从父决策 effect 找到固定投影目标。
   - 创建前检查同项目是否已有相同目标的 `proposed` 决策。
   - 该校验替代旧的按 `parentDecisionId` 查找 pending sibling。
3. `confirmMany`
   - 同一批次不能包含两个相同目标。
   - 批次中的待确认项不能与批次外现存的同目标 `proposed` 决策并存。
   - 目标互斥复检、目标活跃与归属校验、投影、effect 写入和状态更新必须在同一个 SQLite 事务内。

已经 `confirmed` 的决策重复确认继续保持 v18 幂等行为：返回原 effects，不重复投影，不因当前存在后续 pending 修订而破坏历史结果读取。

## 有父修订的不变量

`updateProposal` 可以整体替换 `type` 和 `payload`，因此对 `parentDecisionId !== null` 的 proposal 必须补强以下不变量：

- draft `type` 必须与父决策 `type` 严格一致。
- 仓储重新调用 `findProjectionTarget(parent)` 获取父决策实际投影目标。
- draft `payload.targetId` **必须存在且为非空字符串**，不得置为 `null`、`undefined` 或空字符串。
- draft `payload.targetId` 必须严格等于父决策的投影目标。
- 作者不能通过编辑 proposal 改成独立新增、改到其他目标或改变修订类型。

`UpdateCreativeDecisionProposalInput` 不增加也不接收 `parentDecisionId`。`updateProposal` 必须先用请求中的 `projectId + decisionId` 从数据库读取当前 proposal，再从该持久化记录取得 `parentDecisionId`；不得从 draft 或渲染端推断父项。父 ID 非空时，再按该 ID 读取父决策并执行上述不变量校验。

`confirmMany` 必须在事务内重新执行相同复检，不能只信任 proposal 创建或上次保存时的结果。父决策必须仍可修订，其 effect 必须能唯一定位目标；否则整批确认失败并回滚。

## 四类修订语义

继续复用 v18 的现有语义，不在本功能中重构：

- `story_fact`：插入新记录，旧记录改为 `status = 'superseded'` 并指向新记录。
- `character_knowledge`：插入新记录，旧记录改为 `status = 'superseded'` 并指向新记录。
- `narrative_hook`：原地更新目标记录。
- `narrative_debt`：原地更新目标记录。

hook/debt 原地修订时：

- `subject` 随当前决策载荷一并写入目标行。
- `source_decision_id` 更新为本次新确认决策 ID。
- 目标行不再保留原章节抽取来源。
- 原值仅保留在 `creative_decision_effects.before_json`，更新后值写入 `after_json`。

章节重抽取删除 `source_decision_id IS NULL` 的 superseded 事实仍是允许的；作者修订后生成的新事实带有非空 `source_decision_id`，不会被后续章节重抽取删除。

## 已确认决策的修订入口

账本历史仅对 `status = 'confirmed'` 的决策显示“创建修订”。`superseded` 和 `rejected` 不提供入口。

流程如下：

1. 点击后打开修订草稿编辑器。
2. 自动填充原决策的标题、理由和类型化载荷。
3. 主进程通过 `findProjectionTarget` 固定 `targetId`，渲染端只读展示，用户不能修改。
4. 旧 hook/debt 载荷没有 `subject` 时显示为空，作者补填后才能创建 proposal。
5. `createRevision` 只创建 `proposed`，不立即确认。
6. 新 proposal 后续仍走统一保存、疑似相关项展示和 `confirmMany` 流程。

创建请求进行中时禁用重复提交；失败时保留草稿和已输入内容。

## 项目切换与失败处理

疑似相关项查询、创建修订、保存选择和确认继续使用“项目 ID + 请求代次”双重守卫：

- 选择新项目时同步更新当前项目守卫，并立即清除旧项目可见的疑似相关项、确认选择、修订弹窗和忙碌状态。
- 旧项目迟到的成功或失败回执一律忽略，不能显示错误、覆盖草稿或触发刷新。
- 当前项目操作失败时保留 proposal、作者未保存草稿和选择，显示可重试错误。
- 每个异步入口在请求期间防重复点击；主进程幂等和事务校验作为第二道防线。
- `confirmMany` 成功后才刷新四类运行时状态；失败不能产生部分写入，也不能把 proposal 伪装成已确认。
- 渲染端不得直接调用目标表 IPC 完成修订或确认。

## 测试策略

实现必须使用 TDD：每一项先写失败测试并实际运行确认失败，再写最小实现并运行通过。

### 迁移测试

- 从 v18 数据库升级到 v19。
- 两表 `subject` 列存在，约束为 `NOT NULL`，默认值为 `''`。
- 旧 hook/debt 行升级后 `subject === ''`。
- DDL 与 v19 版本登记处于同一事务，制造失败时不留下部分迁移。

### 规则测试

- NFKC、首尾空白和大小写归一化。
- `location`、`emotional_state` 按 `subject + type`。
- `event`、`knowledge`、`relationship`、`possession` 额外比较 `object`。
- 不同 `object` 不返回为疑似相关项。
- 人物知识按角色返回最近 20 条活跃记录。
- hook/debt 按 `type + subject`。
- 空主体不进入精确规则匹配，但进入同类活跃兜底区。
- 非活跃记录和跨项目记录不返回。

### 仓储与事务测试

- 四类有父修订。
- 四类无父、带 `targetId` 修订。
- `confirmMany` 根据 `targetId` 而不是 `parentDecisionId` 选择投影路径。
- `updateProposal` 保持父类型和父投影目标不变量。
- 有父修订将 `targetId` 改为 `null`、`undefined`、空字符串或其他目标时均拒绝。
- 同批相同目标拒绝。
- 同目标已有 pending 时，`updateProposal` 和 `createRevision` 均拒绝。
- 并发或交错创建同目标修订时最多保留一个 pending。
- 重复确认保持幂等。
- 任一目标更新、effect 写入或状态更新失败时整批回滚。
- hook/debt 原地更新的 `before_json`、`after_json` 和 `source_decision_id` 正确。

### 渲染端测试

- 疑似相关项、人物知识“相关已有条目”和空主体兜底区措辞正确。
- 独立确认、选择修订和取消确认。
- 有父明确修订只读展示固定目标，不重复选择。
- 已确认历史可以创建修订并预填原内容。
- 旧 hook/debt 必须补填主体后才能保存或创建修订。
- `App.tsx` 章节自动同步会传递 `fact.subject`，且空主体仍允许创建 hook。
- 保存或确认失败保留未保存草稿。
- 项目切换忽略迟到回执并清空旧弹窗状态。
- 重复点击不产生重复 proposal 或重复确认。

### 真实 UI 回归

扩展 `tests/ui/run-creative-decision-ledger.cjs` 或增加同层真实 UI 脚本，覆盖：

- 规则疑似相关项提示。
- 空主体兜底。
- 四类修订的代表路径。
- 创建修订预填。
- 项目切换。
- 重复操作。
- 同目标并发修订。
- 确认失败后可重试，且事务无部分写入。

## 实施顺序与验证纪律

spec 审阅批准后，另行使用 `writing-plans` 生成逐任务实施计划。实施阶段顺序固定为：

1. v19 迁移与共享类型。
2. repo 事务路径、不变量和同目标互斥。
3. 主进程疑似相关项查询与 IPC。
4. 渲染端确认选择、历史修订入口和项目守卫。
5. 真实回归、全量验证和项目文档。

每个任务先运行目标测试观察失败，实现后运行专项测试并单独提交。每个阶段按影响范围运行必要的 `npm run build:main`、`npx vite build` 和 `npm run test`。

最终统一运行：

```text
新功能专项测试
node tests/ui/run-writing-workspace.cjs
node tests/ui/run-creative-decision-ledger.cjs
npm run test
npm run build
git diff --check
```

完成实现后更新 `AGENTS.md` 和 `docs/tool-builder/state.md`，记录最终架构、实际测试数字和已知限制。真实外部 AI 烟测仅在完整功能完成后进行；如因 API Key 或网络未执行，必须明确列为未验证项。

## 验收标准

- v18 数据可无损升级到 v19，旧 hook/debt 主体兼容为空字符串。
- 新 AI hook/debt 提议与作者修订必须具有非空主体；章节自动同步链路仍允许空主体并传递已有 `fact.subject`。
- 四类匹配遵循统一 NFKC 规则、类型分档、活跃状态和项目隔离要求。
- hook/debt 空主体记录可在兜底区找到并被作者选择为修订目标。
- 相关项存在时，作者可以新增独立项、修订所选项或取消确认。
- 无父但带 `targetId` 的 proposal 按修订投影，并成为可继续修订的账本根决策。
- 有父修订的类型和目标固定，`targetId` 不得缺失、置空或改指其他记录。
- 同一 `targetTable + targetId` 最多存在一个 `proposed` 修订；批量与交错操作均受事务防御。
- 四类修订保持 v18 既有语义，hook/debt 原地更新具备正确前后快照和新来源决策 ID。
- 只有已确认历史提供创建修订入口，创建动作只产生 `proposed`。
- 项目切换和失败不会串线、丢失草稿、产生重复操作或留下部分运行时写入。
- Obsidian、旧 `foreshadowings` 和用户现有 `App.tsx` 修改不受影响。
