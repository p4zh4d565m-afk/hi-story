# P1：叙事时间纯函数 reducer + 单测（不迁移）

> **合同：** `docs/superpowers/specs/2026-09-14-narrative-time-model-design.md`（已采纳审查者替代方案）
>
> **施工依据：** 上述 Spec 第 4 节 + 第 5 节。
>
> **范围：** 只做**纯函数 + 单测**。**不写 `migrations.ts`，不改任何 repo / 查询 / IPC / UI，不建 `ContextAssembler` / `chapter_analysis_jobs`，不复活 `content_revision`，不扫真实 vault。** 本计划通过并执行完成后，仅代表「时间模型语义已被纯函数锁死」，**不授权任何迁移**。
>
> **诚实边界：** Spec 里依赖运行时事实表、纯函数观察不到的断言（T3「拆章后新章无事实」）已降级为「ID 语义」的可测部分。下文逐条标注「可测 / 降级」。

**Goal:** 把叙事时间模型可纯函数化的语义锁死：故事时间序、章节别名（并章，含章内顺序保持）、as-of 折叠、状态规范化、规划章身份、批量运行不变量。

**Architecture:** 三个纯函数模块，零副作用、零 DB、不生成随机 ID：

1. `narrative-time-order` — 故事时间序 + 章节别名（含 `ordinalOffset` 保持并章后章内顺序）。
2. `narrative-state-reducer` — as-of 折叠（`ReductionResult<T>`）、状态规范化、写入守卫。
3. `narrative-planning-key` — 规划章身份、绑定、批量运行状态。

**Tech Stack:** TypeScript + Vitest（纯函数，无 Electron、无 better-sqlite3、无 React）。

## Global Constraints

- **不碰迁移**：库版本保持 v20。表/字段只以「纯数据接口」形式出现在入参里。
- **纯数据接口，不 import DB 类型**。
- **纯函数不生成 ID**：ID 由调用方预分配传入。
- **转换行不可变**：并章不改写任何既有转换，用章节别名映射表达「被并章内容融进幸存章」。
- **并章后章内顺序保持**：`ChapterAlias` 携带 `ordinalOffset`，被并章转换解析到幸存章后其 `atChapterOrdinal` 加上偏移，避免与幸存章原有转换的 `(ordinal, seq)` 撞车；`compareTransition` 的最终 tie-break 含 `targetId`，杜绝不同转换被判相等。
- **所有 reducer 统一返回 `ReductionResult<T>`**：`{ data: T | null; historyWarnings: HistoryWarning[] }`。`planning_only` 的「无运行时状态」由 `data: null`（实体）/ `data: []`（集合）表达；T12/T20 的「历史不完整」由 `historyWarnings` 携带。
- **快照版本化**：`Transition.afterSnapshot` 是 `Snapshot = { schemaVersion, data }`，`schemaVersion` 未知抛错（T30）。
- **写入策略与只读折叠分离**：T13 是写入守卫 `canAutoExtractOverwrite`。
- `npm run test` 不转发 argv，全量。定向测用 Windows `Invoke-TargetedVitest`。

## 执行前置（不是功能片）

- 当前 `feature/skill-engine`（`60113dd`）比 `origin/master`（`2b4e340`）落后 3 个提交。**必须从 `origin/master` 新建 `codex/p1-narrative-time-reducer` worktree**，base = `2b4e340`。
- **文档未入库**：Spec 与本计划是源 checkout `D:\ccx` 的未跟踪文件，worktree 看不到。controller 建 worktree 后必须从源 checkout 绝对路径把两份文档复制进 worktree，或把关键接口/断言写进 task brief。文档提交另行授权。
- 共享 checkout `D:\ccx` 带多份未提交文档改动，**不在其中写代码**。
- worktree 建立后执行 `git rev-parse HEAD | Set-Content (Join-Path (git rev-parse --git-path sdd) 'base-commit.txt')`。
- 收口检查**用路径限定**。

## 文件地图

- Create: `src/main/ai/narrative-time-order.ts`
- Create: `src/main/ai/narrative-state-reducer.ts`
- Create: `src/main/ai/narrative-planning-key.ts`
- Create: `tests/unit/narrative-time-order.test.ts`
- Create: `tests/unit/narrative-state-as-of.test.ts`
- Create: `tests/unit/narrative-planning-key.test.ts`

## 测试分配（42 条 → 3 文件）

| 文件 | 测试 | 条数 |
|---|---|---|
| `narrative-time-order.test.ts` | T1、T2、T4、T5、T11、T21 | 6 |
| `narrative-state-as-of.test.ts` | T4b、T6、T7、T8、T9、T10、T12、T13、T14、T15、T17、T18、T19、T20、T24a–d、T25、T26、T27、T28、T29、T30、M1–M7 | 31 |
| `narrative-planning-key.test.ts` | T3、T16、T22、T23、T31 | 5 |

---

### Task 1: 故事时间序 + 章节别名（`narrative-time-order.ts`，6 条）

**Interfaces:**

```ts
export type ChapterPosition = {
  id: string;
  projectId: string;
  sortOrder: number | null;          // null = 墓碑
  deletedSortOrder: number | null;   // 软删时保存的原位置
};

export function compareStoryPosition(a: ChapterPosition, b: ChapterPosition): number; // 跨项目抛错
export function chaptersBefore(chapters: ChapterPosition[], target: ChapterPosition): ChapterPosition[];
export function normalizeChapterOrder(chapters: ChapterPosition[]): ChapterPosition[]; // 活跃章 0..n-1；重复/跨项目/缺 id 抛错
export function deleteChapter(chapters: ChapterPosition[], deletedId: string): ChapterPosition[];
export function restoreChapter(chapters: ChapterPosition[], restoredId: string): ChapterPosition[];

// 章节别名：被并章 → 幸存章。ordinalOffset 保持并章后章内顺序（见下）
export type ChapterAlias = {
  from: string;
  to: string;
  ordinalOffset: number;   // 被并章转换解析到幸存章后，atChapterOrdinal 加上的偏移
};

// 并章：mergedId 软删为墓碑 + 追加 alias；ordinalOffset 由调用方计算传入（内容合并方向 + 幸存章已有转换的最大 ordinal）
export function mergeChapters(
  chapters: ChapterPosition[],
  aliases: ChapterAlias[],
  survivingId: string,
  mergedId: string,
  ordinalOffset: number,
): { chapters: ChapterPosition[]; aliases: ChapterAlias[] };

// 别名解析：递归，visited 集合防死循环；循环抛错
export function resolveChapterId(id: string, aliases: ChapterAlias[]): string;

// 有效章内序号：沿 alias 链递归累加每级 ordinalOffset（连续并章多级累加），visited 防环
export function resolveTransitionOrdinal(atChapterId: string, atChapterOrdinal: number, aliases: ChapterAlias[]): number;
```

**为什么需要 `ordinalOffset`（Critical 修复）：** 并章后，幸存章与被并章的转换都定位到幸存章，但它们的 `atChapterOrdinal` 可能都是 `0,1,...`、`seq` 也可能都从 `0` 起。若别名只记录 `from→to`，解析后两批转换拥有完全相同的比较键，`compareTransition` 会把不同转换判成相等，状态归约结果取决于输入顺序。`ordinalOffset` 让被并章转换的 ordinal 整体偏移（默认 = 幸存章已有转换最大 ordinal + 1，表达「被并章内容排在幸存章之后」），配合 `compareTransition` 末尾的 `targetId` 兜底，保证全序唯一、归约稳定。

**连续并章累加：** `resolveTransitionOrdinal` 沿 alias 链**递归累加每一级的 `ordinalOffset`**，不是只加一级。例如 A→B(offset=10)、再 B→C(offset=20)，A 的转换 `ordinal=5` 最终有效序号 = `5 + 10 + 20 = 35`。这保证多级并章后，越早被并的章其内容排得越靠后，且每级偏移都保留。用 `visited` 集合防环（与 `resolveChapterId` 一致）。

**mergeChapters 非法输入校验（违反抛错）：**

1. **self-alias**：`mergedId === survivingId`。
2. **跨项目**：`mergedId` 与 `survivingId` 的 `projectId` 不同。
3. **源/目标不存在**：`mergedId` 或 `survivingId` 不在 `chapters`。
4. **源/目标已软删**：`mergedId` 或 `survivingId` 的 `sortOrder === null`。
5. **重复 from**：`aliases` 已存在 `from === mergedId`。
6. **循环**：`resolveChapterId(survivingId, aliases)` 的最终归属是 `mergedId`。
7. **非法 offset**：`ordinalOffset < 0`（负偏移会让被并章排到幸存章之前，属调用方错误；本计划只允许「排在幸存章之后」，方向由调用方在计算 offset 前自行调整幸存章转换）。

- [ ] **Step 1: 写 6 条失败测试**

T1 插章：`[c19(19), c20(20)]` 在 c20 前插 c20b → `normalizeChapterOrder` 得 `c19→0, c20b→1, c20→2`；`c20.id` 不变。（可测）
T2 移章：`c50` 移到 `c30` 后，`compareStoryPosition(c30, c50) < 0`。（可测）
T4 并章（可测）：`mergeChapters` 断言——(a) `mergedId` 软删为墓碑；(b) 追加 `alias {from: mergedId, to: survivingId, ordinalOffset}`，`resolveChapterId(mergedId, aliases) === survivingId`、`resolveTransitionOrdinal(mergedId, 0, aliases) === ordinalOffset`；(c) 七类非法输入各自抛错。
T5 重写早期章：`compareStoryPosition` 只由 `(sortOrder,id)` 决定。（可测）
T11 并列：`sortOrder=5`、`id=a`/`b`，`(a,b)<0`、`(b,a)>0`，稳定。（可测）
T21 软删恢复：删中间章→活跃序连续唯一→恢复 `min(deletedSortOrder, activeCount)`。（可测）

- [ ] **Step 2: 定向测 FAIL → Step 3 实现 → Step 4 PASS**

Run: 定向测 `tests/unit/narrative-time-order.test.ts`

---

### Task 2: as-of 折叠 + 状态规范化（`narrative-state-reducer.ts`，31 条）

**Interfaces:**

```ts
import type { ChapterPosition, ChapterAlias } from './narrative-time-order';
import { resolveChapterId, resolveTransitionOrdinal } from './narrative-time-order';

export type TimeMode = 'before_target' | 'through_target' | 'project_latest' | 'planning_only';
export type TaskType = 'write' | 'review' | 'chat' | 'planning';
export function resolveTimeMode(taskType: TaskType, opts: { hasActiveChapter: boolean }): TimeMode;
export function validateTaskTimeMode(taskType: TaskType, requestedMode: TimeMode): TimeMode;

export type Snapshot = { schemaVersion: number; data: unknown };

export type Transition = {
  targetId: string;
  kind: 'created' | 'superseded' | 'resolved' | 'paid' | 'abandoned' | 'waived' | 'partially_resolved';
  atChapterId: string;
  atChapterOrdinal: number;
  seq: number;
  afterSnapshot: Snapshot;
  decisionId?: string;
};

// 返回最终归属 chapterId 的所有转换（直接绑定 + 经别名映射过来）的最大**有效** ordinal + 1
export function defaultOrdinalForAppend(transitions: Transition[], chapterId: string, aliases: ChapterAlias[]): number;

export type HistoryWarning = { kind: string; recordId: string; message: string };
export type ReductionResult<T> = { data: T | null; historyWarnings: HistoryWarning[] };

export function storyPositionOf(chapterId: string, chapters: ChapterPosition[], aliases: ChapterAlias[]): ChapterPosition;

// 比较键：(storyPosition, resolveTransitionOrdinal(...), seq, targetId)；末尾 targetId 兜底，杜绝不同转换判相等
export function compareTransition(a: Transition, b: Transition, chapters: ChapterPosition[], aliases: ChapterAlias[]): number;

export function reduceTransitionAsOf(transitions: Transition[], chapters: ChapterPosition[], aliases: ChapterAlias[], target: ChapterPosition | null, mode: TimeMode): ReductionResult<unknown>;
export function reduceStateFactsAsOf(facts: FactInput[], transitions: Transition[], chapters: ChapterPosition[], aliases: ChapterAlias[], target: ChapterPosition | null, mode: TimeMode): ReductionResult<FactInput[]>;
export function accumulateEventsAsOf(facts: FactInput[], transitions: Transition[], chapters: ChapterPosition[], aliases: ChapterAlias[], target: ChapterPosition | null, mode: TimeMode): ReductionResult<FactInput[]>;
export function reduceHookAsOf(hook: HookInput, transitions: Transition[], chapters: ChapterPosition[], aliases: ChapterAlias[], target: ChapterPosition | null, mode: TimeMode): ReductionResult<HookInput>;
export function reduceDebtAsOf(debt: DebtInput, transitions: Transition[], chapters: ChapterPosition[], aliases: ChapterAlias[], target: ChapterPosition | null, mode: TimeMode): ReductionResult<DebtInput>;
export function reduceKnowledgeAsOf(knowledge: KnowledgeInput, transitions: Transition[], chapters: ChapterPosition[], aliases: ChapterAlias[], target: ChapterPosition | null, mode: TimeMode): ReductionResult<KnowledgeInput>;

export function deriveDebtOverdue(debt: DebtInput, chapters: ChapterPosition[], aliases: ChapterAlias[], target: ChapterPosition | null): boolean;

export type StateKeyInput =
  | { factType: 'location' | 'possession' | 'emotional_state'; subject: string; predicate: string; object: string }
  | { factType: 'relationship'; subject: string; predicate: string; object: string; directed: boolean };
export function deriveStateKey(fact: StateKeyInput): { key: string; version: number };

export function verifyProjectionMatches(projection: unknown, transitions: Transition[], chapters: ChapterPosition[], aliases: ChapterAlias[]): boolean;
export function canAutoExtractOverwrite(record: { sourceDecisionId: string | null }): boolean;
```

**返回类型语义：** `data: null` 表「无运行时状态」（planning_only / 旧记录被排除）；集合型用 `data: []` 表空；`historyWarnings` 携带「历史不完整」等非致命告警。

**别名消费规则：** 所有章节引用（`transition.atChapterId`、`fact.chapter_id`、`hook.due_chapter_id`/`resolved_in_chapter_id`、`debt.paid_in_chapter_id`、`knowledge.learned_at_chapter_id`）折叠前先 `resolveChapterId` 再 `storyPositionOf`；转换的章内序号用 `resolveTransitionOrdinal` 调整后再参与排序。

- [ ] **Step 1: 写失败测试**

T4b 并章后 as-of 可见 + 不压扁 + 不撞车（可测，**表驱动**，覆盖 fact/knowledge/hook/debt 四类及其副锚）：

| 用例 | 记录 + 转换 | 并章后断言 |
|---|---|---|
| fact 主锚 | fact.chapter_id=mergedId | `reduceStateFactsAsOf` target 在 survivingId 之后 `data` 含该 fact |
| knowledge 主锚 | knowledge.learned_at_chapter_id=mergedId | `reduceKnowledgeAsOf` target 在 survivingId 之后 `data` 非 null |
| hook 主锚+副锚 | hook.chapter_id=mergedId、due_chapter_id=mergedId、resolved_in_chapter_id=ch80 | target 在 ch80 之后 `data` resolved；target=ch60 `data` open（不压扁）；due/resolved 副锚经 alias 正确解析 |
| debt 主锚+副锚 | debt.chapter_id=mergedId、paid_in_chapter_id=ch90 | target 在 ch90 之后 `data` paid；target=ch60 `data` unpaid；paid 副锚正确 |
| 不撞车 | 幸存章有转换 ordinal=0..k、被并章转换 ordinal=0..m | `compareTransition(幸存章转换, 被并章转换)` 恒非 0；归约结果与输入顺序无关（乱序输入两次结果相同） |
| 连续并章累加 | alias `A→B`(offset=10)、`B→C`(offset=20)，A 的转换 ordinal=5 | `resolveTransitionOrdinal('A', 5, aliases)` === 35（逐级累加 10+20） |
| 并章后追加避让 | 幸存章 C 已映射过来 A、B 的转换，另有直接绑定 C 的转换 | `defaultOrdinalForAppend(transitions, 'C', aliases)` 返回「全部最终归属 C 的转换（直接 + 别名映射）最大有效 ordinal + 1」，不重新分配已被别名占用的序号 |

每例都断言：传入 `transitions` 数组折叠后深度相等、未被改写。

T6 planning_only 零运行时（可测）：`reduceStateFactsAsOf(..., 'planning_only')` 返回 `{ data: [], historyWarnings: [] }`；`reduceHookAsOf(..., 'planning_only')` 返回 `{ data: null, ... }`。
T7 回看关闭钩子：第 80 章 resolved，回看第 50 章 `data` 仍 open。（可测）
T8 回看偿债：第 90 章 paid，回看第 60 章仍 unpaid。（可测）
T9 partially：70 partially、90 resolved，回看 75 是 partially_resolved。（可测）
T10 删章排除：绑定墓碑的记录不出现在 as-of，归属仍指墓碑。（可测）
T12 旧记录无转换：`reduceHookAsOf(hook, transitions=[], ..., 'before_target'/'through_target')` 下 `data` null 且 `historyWarnings` 含「历史不完整」；整数 `promisedByChapter` 不猜测映射。（可测）
T13 写入守卫：`canAutoExtractOverwrite({sourceDecisionId:'d1'})`=false；`({sourceDecisionId:null})`=true。（可测）
T14 事件累计：`event` 范围内累计、不互相取代。（可测）
T15 状态取最后：同 `state_key` 取目标章前最后一条。（可测）
T17 字段穿越：第 80 章改描述并 resolved，回看第 50 章得旧快照旧描述 + open。（可测）
T18 同章多转换：先 partially 再 resolved，`defaultOrdinalForAppend(transitions, chapterId, aliases)` 生成章末有效 ordinal，按 ordinal/seq 折叠得 resolved，可复现。（可测）
T19 双真相等价：`verifyProjectionMatches` 一致 true / 不一致抛错。（可测）
T20 旧记录仅 status：`before_target`/`through_target` 下 `data` null，`historyWarnings` 可见。（可测）
T24 分类型 state_key（可测，四子断言）：
  - T24a `location`：`object='北京'`/`'上海'` 得**相同 key**；
  - T24b `possession`：`object='剑'`/`'刀'` 得**不同 key**；
  - T24c `relationship`：`directed:true` 时 `A→B` 与 `B→A` 不同 key；`directed:false` 排序双方、两者同 key；
  - T24d `emotional_state`：`object='愤怒'`/`'平静'` 相同 key。
  且都带 `version`。
T25 Review 双区块：先验 `before_target` 不含目标章自身转换。（可测）
T26 跨项目/已删目标章：`storyPositionOf`/reduce 抛错，不退化 latest。（可测）
T27 重抽取纯函数等价：`accumulateEventsAsOf` 含 superseded 转换后，退休事件不重复累计。（可测）
T28 逾期派生：第 40 章到期债务，as-of 第 35 章 `deriveDebtOverdue`=false、第 41 章=true。（可测）
T29 知识回放：第 85 章 superseded 的知识，回看第 60 章仍 active。（可测）
T30 未知快照版本：`afterSnapshot.schemaVersion` 未知时折叠抛错。（可测）

M1 `resolveTimeMode('write',*)`=before_target；M2 `('review',*)`=before_target；M3 `('chat',{false})`=project_latest；M4 `('chat',{true})`=through_target；M5 `('planning',*)`=planning_only；M6 `validateTaskTimeMode('write','through_target')` 抛错、`('chat','project_latest')` 合法；M7 跨项目/已删目标章抛错（与 T26 同）。

- [ ] **Step 2: 定向测 FAIL → Step 3 实现 → Step 4 PASS**

Run: 定向测 `tests/unit/narrative-state-as-of.test.ts`

---

### Task 3: 规划章身份 + 批量运行（`narrative-planning-key.ts`，5 条）

**Interfaces:**

```ts
export type OutlineIdentity = { id: string; volumeIndex: number; chapterNumber: number; title: string };
export type OutlineDraft = Omit<OutlineIdentity, 'id'>;

export function sameOutlineIdentity(a: OutlineIdentity, b: OutlineIdentity): boolean; // 只比 id

export function splitOutlineIdentity(original: OutlineIdentity, newChapterId: string): { original: OutlineIdentity; newChapter: OutlineIdentity };

// 校验：oldId 存在且不重复、newIndex 不重复且不越界、freshIds 的 index 不越界、
//       mapping 与 freshIds 的 newIndex 不冲突、最终 id 不重复；违反抛错
export function mapRegeneratedOutlineIds(
  oldOnes: OutlineIdentity[],
  newOnes: OutlineDraft[],
  mapping: Array<{ oldId: string; newIndex: number }>,
  freshIds: Record<number, string>,
): OutlineIdentity[];

export type PlanningBinding = { outlineId: string; chapterId: string; tombstoned: boolean };
export function canRebindPlanningKey(existing: PlanningBinding[], outlineId: string): boolean;
export function replacePlanningBinding(existing: PlanningBinding[], outlineId: string, newChapterId: string): PlanningBinding[];

export function resolveObsidianOutlineIdentity(candidate: { explicitId?: string; pathHash: string }): { id: string | null; reason: 'explicit' | 'no-key' };

export type BatchChapter = { chapterId: string; textHash: string; status: 'pending' | 'running' | 'done' | 'cancelled' };
export type BatchRunState = {
  chapters: BatchChapter[];
  tempSummaries: Array<{ forChapterId: string; sourceHash: string; text: string }>;
  unconfirmedProposals: Array<{ forChapterId: string }>;
};
export function invalidateBatchAfterChapter(state: BatchRunState, changedIndex: number): BatchRunState;
```

**批量作废语义：** `changedIndex` 之后、`status` 为 `pending` 或 `running` 的章节一律标 `cancelled`（不删除）；这些章节的 `tempSummaries`/`unconfirmedProposals` 移除，不落正式状态；`changedIndex` 及之前 `done` 的章节不变。

- [ ] **Step 1: 写失败测试**

T3 拆章 + 身份（可测）：`splitOutlineIdentity(original, newId)` 原章保留 `id`、新章 `id === newId`；`sameOutlineIdentity` 只比 id——改 `volumeIndex`/`chapterNumber`/`title` 后仍判同一身份。**「新章无事实」降级**。
T16 批量改前章（可测）：改第 N 章后，N+1 起 `pending` 与 `running` 都标 `cancelled`（不删除）、其 tempSummaries/unconfirmedProposals 移除、done 章节不变。
T22 软删后再创建（可测）：`canRebindPlanningKey` 对 `tombstoned=true` 的 key 返回 false；`replacePlanningBinding` 显式替换才迁移。
T23 Obsidian 路径复用（可测）：无 `explicitId` 返回 `{id:null, reason:'no-key'}`，不因 pathHash 相同继承旧 key。
T31 批量映射校验（可测）：`mapRegeneratedOutlineIds` 非法输入各自抛错——(a) `oldId` 不存在于 oldOnes；(b) `oldId` 重复；(c) `newIndex` 重复；(d) `newIndex`/`freshIds` 的 index 越界；(e) mapping 的 `newIndex` 与 `freshIds` 的 index 冲突；(f) 两个不同 fresh index 使用**同一新 ID**；(g) fresh 新 ID 与某个 mapping 复用的旧 ID **相同**。合法路径断言：映射项复用旧 id、未映射项用 freshIds 新 id、最终 id 不重复。

- [ ] **Step 2: 定向测 FAIL → Step 3 实现 → Step 4 PASS**

Run: 定向测 `tests/unit/narrative-planning-key.test.ts`

---

### Task 4: 收口

- [ ] **Step 1: 全量 + 构建**

```powershell
npm run test
npm run build:main
npx vite build
```

Expected：全量 PASS（含新增 42 条断言）；`build:main` 与 vite 通过。

- [ ] **Step 2: 路径限定交接（不 push、不合入、不动库）**

```powershell
git status --short -- src/main/ai/narrative-time-order.ts src/main/ai/narrative-state-reducer.ts src/main/ai/narrative-planning-key.ts tests/unit/narrative-time-order.test.ts tests/unit/narrative-state-as-of.test.ts tests/unit/narrative-planning-key.test.ts
git diff --name-only HEAD -- src/main/db/migrations.ts   # 必须为空
```

Expected：路径限定只出现 6 个新增文件；`migrations.ts` 无改动。交接写清：42 条纯函数断言已锁死叙事时间语义，**未写任何迁移 DDL、未改任何查询/IPC/UI**。下一步「迁移 DDL + 查询接入」需单独授权。

---

## 自检

| Spec 条款 | 对应 |
|---|---|
| 4.1 故事时间序 + 跨项目/删章错误 | Task 1、T11/T26/M7 |
| 4.2 完整快照转换行 + 章内序 + 不可变 + 双真相 | T17/T18/T19/T30 |
| 4.2/4.6 并章 = 章节别名映射 + ordinalOffset 保持章内顺序 | T4/T4b |
| 4.2 逾期派生、4.3 旧数据 historyWarnings | T28/T12/T20 |
| 4.3 整数期限不猜测 | T12 |
| 4.4 四模式 + Review 双区块 + 非法组合 validate + planning_only 零运行时 | M1–M7、T25、T6 |
| 4.5 规划 key 身份 + 拆章/批量映射（预分配 ID + 校验）/绑定替换 | Task 3、T3/T22/T23/T31 |
| 4.6 排序/墓碑/并章 | Task 1、T21/T10 |
| 4.7 分类型 state_key 四类（含 relationship 方向）+ 版本 + 事件退休排除 | T24a–d/T14/T15/T27 |
| 4.8 批量作废（明确标 cancelled）/终止/不落正式 | T16 |
| 知识回放 | T29 |
| 作者确认不被自动覆盖（写入守卫） | T13 |
| reducer 统一返回 ReductionResult，planning_only 可表达无状态 | 全局约束 + T6/T12/T20 |
| 不迁移 / 不建 Assembler / 不复活 content_revision | 全局约束 |
| 从 master 建 worktree / 文档同步 / 路径限定 | 执行前置 + Task 4 |
