# 创作决策确认账本实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 AI 回复能够生成结构化创作提议，并且只有作者确认后才以单个 SQLite 事务写入运行时事实、人物知识、叙事钩子或叙事债务，供后续 AI 复用。

**Architecture:** 使用迁移 v18 新增不可变决策账本和写入效果表，并给现有四类目标表增加来源字段。`CreativeDecisionRepo` 负责校验、幂等确认和事务投影；渲染端只负责提取候选、编辑与发出一次确认命令，不串联目标表 IPC。

**Tech Stack:** Electron、React 18、TypeScript、better-sqlite3、Vitest、现有 `window.electronAPI.invoke` 桥接。

## Global Constraints

- 迁移 v17 保持为 AI 会话 SQLite 化；账本固定使用迁移 v18，不能合并或改写 v17。
- Obsidian 始终只读，不允许决策确认触发文件写入。
- 普通 AI 会话和创作决策账本分开保存。
- 新决策不写入旧 `foreshadowings` 表。
- 所有解释、界面文字和新增代码注释使用中文。
- 使用 TDD；每个任务先看到目标测试失败，再写最小实现。
- 不提交 `.claude/settings.local.json`、`.codex/` 或构建产物。

## 文件结构

- Modify: `src/main/db/migrations.ts` — v18 表结构及现有表来源列。
- Modify: `src/renderer/types/index.ts` — 决策、载荷、effect 和确认输入类型。
- Modify: `src/main/db/repositories/story-facts.repo.ts` — 保护决策事实和人物知识，读取活跃知识。
- Modify: `src/main/db/repositories/narrative-hooks.repo.ts` — 接受决策来源并输出有预算的上下文。
- Create: `src/main/db/repositories/creative-decision.repo.ts` — 提议、查询、拒绝、修订和事务确认。
- Create: `src/main/ipc/creative-decision.ipc.ts` — 单一 IPC 边界。
- Modify: `src/main/ipc/index.ts` — 注册账本 IPC。
- Create: `src/renderer/services/creative-decision-extraction.ts` — AI JSON 提取提示和严格解析。
- Create: `src/renderer/services/creative-decision-loader.ts` — 项目 ID + 请求代次加载守卫。
- Create: `src/renderer/components/CreativeDecisionPanel.tsx` — 提议编辑、确认、拒绝与重试界面。
- Modify: `src/renderer/components/AIChatPanel.tsx` — assistant 消息入口及面板状态。
- Modify: `src/renderer/App.tsx` — AI 对话上下文接入钩子和债务。
- Create/Modify tests under `tests/unit/` and `tests/ui/` — 数据、事务、提取、竞态、上下文和真实 UI 回归。
- Modify: `AGENTS.md`, `docs/tool-builder/state.md` — 完成后的架构事实和验证命令。

---

### Task 1: 迁移 v18 与共享类型

**Files:**
- Modify: `src/main/db/migrations.ts`
- Modify: `src/renderer/types/index.ts`
- Create: `tests/unit/db/creative-decision.migration.test.ts`

**Interfaces:**
- Produces: `CreativeDecision`, `CreativeDecisionDraft`, `CreativeDecisionEffect`, `CreateCreativeDecisionProposalsInput`, `ConfirmCreativeDecisionsInput`。
- Produces: 数据库表 `creative_decisions`、`creative_decision_effects` 及四类目标表来源列。

- [ ] **Step 1: 写迁移失败测试**

测试用内存 SQLite 运行全部迁移后断言 `_migrations` 含 v18、两张新表存在，并检查以下列：

```ts
expect(columns(db, 'story_facts')).toEqual(expect.arrayContaining([
  'source_decision_id', 'source_kind',
]));
expect(columns(db, 'character_knowledge')).toEqual(expect.arrayContaining([
  'source_decision_id', 'source_kind', 'status', 'superseded_by',
]));
expect(columns(db, 'narrative_hooks')).toContain('source_decision_id');
expect(columns(db, 'narrative_debts')).toContain('source_decision_id');
```

另插入一条旧事实后运行 v18，断言内容仍存在且 `source_kind === 'legacy'`。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/unit/db/creative-decision.migration.test.ts`

Expected: FAIL，原因是 v18 和新表尚不存在。

- [ ] **Step 3: 添加 v18 SQL**

在 `MIGRATIONS` 末尾追加 `version: 18`。新表核心约束如下：

```sql
CREATE TABLE creative_decisions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source_thread_id TEXT,
  source_message_id TEXT,
  parent_decision_id TEXT,
  decision_type TEXT NOT NULL CHECK(decision_type IN (
    'story_fact','character_knowledge','narrative_hook','narrative_debt'
  )),
  title TEXT NOT NULL DEFAULT '',
  rationale TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN (
    'proposed','confirmed','rejected','superseded'
  )),
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  rejected_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (source_thread_id) REFERENCES conversation_threads(id) ON DELETE SET NULL,
  FOREIGN KEY (source_message_id) REFERENCES conversation_messages(id) ON DELETE SET NULL,
  FOREIGN KEY (parent_decision_id) REFERENCES creative_decisions(id) ON DELETE SET NULL
);

CREATE TABLE creative_decision_effects (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL,
  target_table TEXT NOT NULL CHECK(target_table IN (
    'story_facts','character_knowledge','narrative_hooks','narrative_debts'
  )),
  target_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('insert','update','supersede')),
  before_json TEXT,
  after_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (decision_id) REFERENCES creative_decisions(id) ON DELETE CASCADE
);
```

四类目标表添加可空 `source_decision_id`；`story_facts.source_kind` 默认 `legacy`；`character_knowledge` 同时添加 `source_kind`、`status` 默认 `active` 和 `superseded_by`。创建项目、状态和来源索引。

- [ ] **Step 4: 添加共享判别联合类型**

在 `src/renderer/types/index.ts` 添加：

```ts
export type CreativeDecisionDraft =
  | { type: 'story_fact'; title: string; rationale: string; payload: StoryFactDecisionPayload }
  | { type: 'character_knowledge'; title: string; rationale: string; payload: KnowledgeDecisionPayload }
  | { type: 'narrative_hook'; title: string; rationale: string; payload: HookDecisionPayload }
  | { type: 'narrative_debt'; title: string; rationale: string; payload: DebtDecisionPayload };

export interface StoryFactDecisionPayload {
  factType: 'location' | 'possession' | 'relationship' | 'knowledge' | 'event' | 'emotional_state';
  subject: string;
  predicate: string;
  object: string;
  description: string;
  chapterId?: string | null;
  targetId?: string | null;
}

export interface KnowledgeDecisionPayload {
  characterId?: string | null;
  characterName: string;
  factDescription: string;
  source: string;
  learnedAtChapterId?: string | null;
  targetId?: string | null;
}

export interface HookDecisionPayload {
  hookType: 'cliffhanger' | 'foreshadowing' | 'promise' | 'mystery' | 'emotional_hook';
  description: string;
  intensity: number;
  chapterId?: string | null;
  dueChapterId?: string | null;
  targetId?: string | null;
}

export interface DebtDecisionPayload {
  debtType: 'reveal' | 'payoff' | 'character_return' | 'mystery_answer' | 'power_up';
  description: string;
  chapterId?: string | null;
  promisedByChapter?: number | null;
  targetId?: string | null;
}

export interface CreateCreativeDecisionProposalsInput {
  projectId: string;
  sourceThreadId: string;
  sourceMessageId: string;
  drafts: CreativeDecisionDraft[];
}

export interface ConfirmCreativeDecisionsInput {
  projectId: string;
  decisionIds: string[];
}

export interface UpdateCreativeDecisionProposalInput {
  projectId: string;
  decisionId: string;
  draft: CreativeDecisionDraft;
}

export interface CreateCreativeDecisionRevisionInput {
  projectId: string;
  parentDecisionId: string;
  draft: CreativeDecisionDraft;
}
```

`CreativeDecision` 按数据库字段暴露 `id`、三个来源/父级 ID、`type`、`title`、`rationale`、解析后的 `payload`、`status` 和三个时间字段。`CreativeDecisionEffect` 暴露目标表、目标 ID、操作、写入前后快照和创建时间。可空 `targetId` 表示修订；不得使用任意表名或字段字典。

- [ ] **Step 5: 运行迁移测试**

Run: `npx vitest run tests/unit/db/creative-decision.migration.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/main/db/migrations.ts src/renderer/types/index.ts tests/unit/db/creative-decision.migration.test.ts
git commit -m "feat: add creative decision schema"
```

---

### Task 2: 保护作者确认的事实和人物知识

**Files:**
- Modify: `src/main/db/repositories/story-facts.repo.ts`
- Create: `tests/unit/db/story-facts-decision-source.test.ts`

**Interfaces:**
- Consumes: v18 的 `source_decision_id`、`source_kind`、知识状态列。
- Produces: 章节重新抽取只覆盖非决策记录；知识查询只返回 `active`。

- [ ] **Step 1: 写失败测试**

建立同章节的一条 `chapter_extraction` 事实和一条 `author_decision` 事实，调用 `batchUpsert` 后断言只替换前者。对 `batchUpsertKnowledge` 做相同测试，并断言被取代的知识条目不会进入 `findAllKnowledgeByProject`。

```ts
expect(activeFacts.map(item => item.description)).toEqual([
  '作者确认保留的事实', '本次重新抽取的事实',
]);
expect(activeKnowledge.map(item => item.factDescription)).not.toContain('已被取代的知识');
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/unit/db/story-facts-decision-source.test.ts`

Expected: FAIL，现有 `DELETE WHERE chapter_id = ?` 会删除决策记录。

- [ ] **Step 3: 修改两个 DELETE 和插入来源**

事实批量覆盖使用：

```sql
DELETE FROM story_facts
WHERE chapter_id = ? AND source_decision_id IS NULL
```

人物知识批量覆盖使用：

```sql
DELETE FROM character_knowledge
WHERE learned_at_chapter_id = ? AND source_decision_id IS NULL
```

两个自动抽取 INSERT 都显式写入 `source_kind = 'chapter_extraction'`。人物知识查询增加 `status = 'active'`；row mapper 返回来源和取代字段。

- [ ] **Step 4: 运行测试**

Run: `npx vitest run tests/unit/db/story-facts-decision-source.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/main/db/repositories/story-facts.repo.ts tests/unit/db/story-facts-decision-source.test.ts
git commit -m "fix: preserve confirmed story state during extraction"
```

---

### Task 3: 事务化决策仓储

**Files:**
- Create: `src/main/db/repositories/creative-decision.repo.ts`
- Modify: `src/main/db/repositories/narrative-hooks.repo.ts`
- Create: `tests/unit/db/creative-decision.repo.test.ts`

**Interfaces:**
- Produces: `createProposals(input)`, `findByProject(projectId)`, `updateProposal(input)`, `reject(projectId, decisionId)`, `confirmMany(input)`, `createRevision(input)`。
- `confirmMany` 返回 `{ decisions: CreativeDecision[]; effects: CreativeDecisionEffect[] }`。

- [ ] **Step 1: 写四类确认和归属校验失败测试**

测试必须覆盖：四种类型分别写入正确目标表；来源 assistant 消息必须属于同一项目；用户消息不能作为提议来源；拒绝不写目标表。

```ts
const result = repo.confirmMany({ projectId, decisionIds });
expect(result.success).toBe(true);
expect(count(db, 'creative_decision_effects')).toBe(4);
expect(count(db, 'story_facts')).toBe(1);
expect(count(db, 'character_knowledge')).toBe(1);
expect(count(db, 'narrative_hooks')).toBe(1);
expect(count(db, 'narrative_debts')).toBe(1);
```

- [ ] **Step 2: 写事务、幂等和修订失败测试**

覆盖：第二项载荷非法时整批为零写入；重复确认返回原 effects 且不重复插入；事实修订会写新事实并 supersede 旧事实；知识修订不再被活跃查询返回；钩子/债务修订记录 before/after 快照。

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run tests/unit/db/creative-decision.repo.test.ts`

Expected: FAIL，仓储文件不存在。

- [ ] **Step 4: 实现严格载荷校验**

在仓储内部用按类型的白名单校验函数，不接受客户端提供的 SQL 字段：

```ts
function validateDraft(draft: CreativeDecisionDraft): void {
  if (!draft.title.trim()) throw new Error('决策标题不能为空');
  switch (draft.type) {
    case 'story_fact': return validateStoryFactPayload(draft.payload);
    case 'character_knowledge': return validateKnowledgePayload(draft.payload);
    case 'narrative_hook': return validateHookPayload(draft.payload);
    case 'narrative_debt': return validateDebtPayload(draft.payload);
  }
}
```

校验枚举、必填字符串、钩子强度 1–5、章节和目标记录的项目归属。

`updateProposal` 只允许修改同项目且状态为 `proposed` 的记录，并重新执行完整载荷校验；已确认、已拒绝和已取代记录均返回错误。

- [ ] **Step 5: 实现单事务确认**

`confirmMany` 先加载并校验全部决策，再进入一个 `db.transaction`。每个 projection 必须写目标表、effect 和状态；任何错误抛出以触发整体回滚。

```ts
const confirm = this.db.transaction(() => {
  const decisions = input.decisionIds.map(id => this.requireProposed(input.projectId, id));
  const effects = decisions.map(decision => this.applyDecision(decision));
  return { decisions: decisions.map(item => this.markConfirmed(item.id)), effects };
});
```

如果全部 ID 已确认，读取并返回原 effects；如果混合已确认和 proposed，先解析成最终集合，确保每个 proposed 只应用一次。

- [ ] **Step 6: 实现修订**

`createRevision` 只允许以 `confirmed` 决策为父项创建新的 `proposed`。确认后：事实和知识写新记录并取代旧记录；钩子和债务更新原目标，effect 保存前后 JSON；父决策改为 `superseded`。

- [ ] **Step 7: 运行仓储测试**

Run: `npx vitest run tests/unit/db/creative-decision.repo.test.ts tests/unit/db/story-facts-decision-source.test.ts`

Expected: PASS。

- [ ] **Step 8: 提交**

```bash
git add src/main/db/repositories/creative-decision.repo.ts src/main/db/repositories/narrative-hooks.repo.ts tests/unit/db/creative-decision.repo.test.ts
git commit -m "feat: apply confirmed creative decisions atomically"
```

---

### Task 4: IPC、项目隔离和加载守卫

**Files:**
- Create: `src/main/ipc/creative-decision.ipc.ts`
- Modify: `src/main/ipc/index.ts`
- Create: `src/renderer/services/creative-decision-loader.ts`
- Create: `tests/unit/creative-decisions/creative-decision-loader.test.ts`

**Interfaces:**
- Produces IPC: `db:creativeDecisions:createProposals`, `findByProject`, `updateProposal`, `reject`, `confirmMany`, `createRevision`。
- Produces: `createCreativeDecisionLoader({ invoke, getCurrentProjectId, onApply, onError })`。

- [ ] **Step 1: 写加载竞态失败测试**

用可控 Promise 模拟项目 A 请求晚于项目 B 返回；断言只应用 B。再让 A 失败，断言不会清空 B。

```ts
await loader.load('project-a');
await loader.load('project-b');
resolveB(projectBDecisions);
resolveA(projectADecisions);
expect(onApply).toHaveBeenCalledTimes(1);
expect(onApply).toHaveBeenCalledWith('project-b', projectBDecisions);
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/unit/creative-decisions/creative-decision-loader.test.ts`

Expected: FAIL，加载器不存在。

- [ ] **Step 3: 实现 IPC**

每个 handler 使用 try/catch 返回 `IpcResult<T>`。确认 handler 只调用一次仓储方法：

```ts
ipcMain.handle('db:creativeDecisions:confirmMany', (_event, input: ConfirmCreativeDecisionsInput) => {
  try { return getRepo().confirmMany(input); }
  catch (error) { return { success: false, error: (error as Error).message }; }
});
```

在 `src/main/ipc/index.ts` 注册 `registerCreativeDecisionIpc()`。

- [ ] **Step 4: 实现项目守卫加载器**

加载器仿照 `conversation-persistence.ts`，每次 load 增加 generation；只有项目 ID 和 generation 同时匹配才调用 `onApply` 或 `onError`。

- [ ] **Step 5: 运行测试和主进程类型检查**

Run: `npx vitest run tests/unit/creative-decisions/creative-decision-loader.test.ts`

Run: `npm run build:main`

Expected: 全部 PASS，TypeScript 无错误。

- [ ] **Step 6: 提交**

```bash
git add src/main/ipc/creative-decision.ipc.ts src/main/ipc/index.ts src/renderer/services/creative-decision-loader.ts tests/unit/creative-decisions/creative-decision-loader.test.ts
git commit -m "feat: expose project-safe creative decision IPC"
```

---

### Task 5: AI 提取器与决策确认界面

**Files:**
- Create: `src/renderer/services/creative-decision-extraction.ts`
- Create: `src/renderer/components/CreativeDecisionPanel.tsx`
- Modify: `src/renderer/components/AIChatPanel.tsx`
- Create: `tests/unit/creative-decisions/extraction.test.ts`
- Create: `tests/ui/creative-decision-ledger.tsx`
- Create: `tests/ui/run-creative-decision-ledger.cjs`

**Interfaces:**
- Produces: `buildDecisionExtractionMessages(content)`、`parseDecisionDrafts(text)`。
- `CreativeDecisionPanel` 接收 `projectId`、`decisions: CreativeDecision[]`、`onClose`、`onChanged`、`onCommitted`。

- [ ] **Step 1: 写解析失败测试**

覆盖纯 JSON、Markdown fenced JSON、非法类型、缺字段、强度越界和空数组。非法条目应给出中文错误，不能部分静默接受。

```ts
const fencedHook = '```json\n[{"type":"narrative_hook","title":"失踪者线索","rationale":"后续需要回收","payload":{"hookType":"foreshadowing","description":"旧车站留下带血车票","intensity":4}}]\n```';
expect(parseDecisionDrafts(fencedHook)).toEqual([{
  type: 'narrative_hook',
  title: '失踪者线索',
  rationale: '后续需要回收',
  payload: {
    hookType: 'foreshadowing',
    description: '旧车站留下带血车票',
    intensity: 4,
  },
}]);
expect(() => parseDecisionDrafts('[{"type":"sql"}]'))
  .toThrow('不支持的决策类型');
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/unit/creative-decisions/extraction.test.ts`

Expected: FAIL，提取器不存在。

- [ ] **Step 3: 实现提取提示和解析**

系统提示必须明确：仅返回 JSON 数组，只允许四种判别类型；每项含 `title`、`rationale`、`payload`；不能把猜测写成已经发生的事实。`parseDecisionDrafts` 去除唯一一层代码围栏、JSON.parse 后复用与主进程同等约束的纯函数校验。

- [ ] **Step 4: 添加 assistant 消息入口**

在 `AIChatPanel.tsx` 只为已经落库的 assistant 消息显示“整理为决策”。点击后使用当前 AI 配置调用 `aiService.chatStream` 提取候选，再通过 `db:creativeDecisions:createProposals` 持久化，并把返回的 `CreativeDecision[]` 交给确认面板。流式中的临时消息不显示入口。

- [ ] **Step 5: 实现确认面板**

`AIChatPanel` 在项目切换时使用 `createCreativeDecisionLoader` 加载该项目账本，保留可重新打开的 proposed 项。面板逐项显示类型、标题、理由和可编辑字段；保存编辑时调用 `updateProposal`，成功后才能确认。提供“确认此项”“拒绝”“全部确认”。确认按钮一次调用 `confirmMany`，失败时保留输入并显示“写入失败，可重试”。确认成功后重新加载账本。

不得在渲染端调用 `db:storyFacts:*` 或 `db:narrativeHooks:*` 完成确认。

- [ ] **Step 6: 添加真实 UI 回归**

复用 `tests/ui/run-writing-workspace.cjs` 的独立隐藏 Electron、临时目录和内存数据模式。覆盖：assistant 消息出现入口、候选可编辑、拒绝不生成目标记录、确认生成记录、模拟确认失败后候选仍可重试。

Run: `node tests/ui/run-creative-decision-ledger.cjs`

Expected: 输出所有场景 PASS，退出码 0。

- [ ] **Step 7: 运行相关测试**

Run: `npx vitest run tests/unit/creative-decisions/extraction.test.ts tests/unit/creative-decisions/creative-decision-loader.test.ts`

Run: `node tests/ui/run-creative-decision-ledger.cjs`

Expected: 全部 PASS。

- [ ] **Step 8: 提交**

```bash
git add src/renderer/services/creative-decision-extraction.ts src/renderer/components/CreativeDecisionPanel.tsx src/renderer/components/AIChatPanel.tsx tests/unit/creative-decisions tests/ui/creative-decision-ledger.tsx tests/ui/run-creative-decision-ledger.cjs
git commit -m "feat: add author-confirmed AI decision workflow"
```

---

### Task 6: 钩子和债务进入有界 AI 上下文

**Files:**
- Modify: `src/main/db/repositories/narrative-hooks.repo.ts`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/components/AIWritePanel.tsx`
- Modify: `src/renderer/components/AIReviewPanel.tsx`
- Create: `tests/unit/creative-decisions/narrative-context.test.ts`

**Interfaces:**
- Produces: `getHooksAndDebtsContext(projectId, maxTokens = 800)`。
- AI 对话、写章和审稿读取当前项目确认后生成的 open hooks 与 unpaid debts。

- [ ] **Step 1: 写上下文失败测试**

插入已确认来源的高强度钩子、未确认提议、已解决钩子和未偿债务，断言只输出目标表中的 open/unpaid 记录。制造超长数据，断言估算不超过 800 token，并优先保留强度高、临近到期或逾期项。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/unit/creative-decisions/narrative-context.test.ts`

Expected: FAIL，现有上下文没有独立 token 上限和完整优先级。

- [ ] **Step 3: 实现有界上下文**

`NarrativeHooksRepo.getHooksAndDebtsContext` 接受明确预算，查询仅限当前项目的 open/partially_resolved hooks 和 unpaid/overdue debts。排序顺序固定为：逾期债务、高强度钩子、临近到期、其余；逐条加入直到预算耗尽。

- [ ] **Step 4: 接入三个 AI 入口**

`AIWritePanel` 和 `AIReviewPanel` 保留已有 `db:narrativeHooks:getContext` 调用并检查失败分支。`App.tsx` 为普通 AI 对话加载同一上下文，使用项目 ID + 请求代次守卫；将成功结果作为额外 system message 传给 `AIChatPanel`。项目切换立即清除旧项目钩子上下文，失败不复用旧值。

- [ ] **Step 5: 运行测试与构建**

Run: `npx vitest run tests/unit/creative-decisions/narrative-context.test.ts tests/unit/obsidian/context.test.ts`

Run: `npm run build`

Expected: 全部 PASS，主进程和渲染端构建成功。

- [ ] **Step 6: 提交**

```bash
git add src/main/db/repositories/narrative-hooks.repo.ts src/renderer/App.tsx src/renderer/components/AIWritePanel.tsx src/renderer/components/AIReviewPanel.tsx tests/unit/creative-decisions/narrative-context.test.ts
git commit -m "feat: reuse confirmed hooks and debts in AI context"
```

---

### Task 7: 全量验证与项目记忆

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/tool-builder/state.md`

**Interfaces:**
- Produces: 新对话可以恢复的架构约束、验证命令和下一步。

- [ ] **Step 1: 运行账本专项测试**

Run: `npx vitest run tests/unit/db/creative-decision.migration.test.ts tests/unit/db/story-facts-decision-source.test.ts tests/unit/db/creative-decision.repo.test.ts tests/unit/creative-decisions/extraction.test.ts tests/unit/creative-decisions/creative-decision-loader.test.ts tests/unit/creative-decisions/narrative-context.test.ts`

Expected: 全部 PASS。

- [ ] **Step 2: 运行真实 UI 回归**

Run: `node tests/ui/run-writing-workspace.cjs`

Run: `node tests/ui/run-creative-decision-ledger.cjs`

Expected: 两个命令均退出码 0。

- [ ] **Step 3: 运行完整测试和构建**

Run: `npm run test`

如果 Windows 出现 better-sqlite3 ABI 不匹配，按 `AGENTS.md` 使用 `ELECTRON_RUN_AS_NODE=1` 的 Electron Node 模式执行 Vitest，完成后恢复环境变量。

Run: `npm run build`

Expected: 测试全部通过，生产构建成功。

- [ ] **Step 4: 手工检查核心闭环**

启动应用后验证：AI 回复 → 整理为决策 → 编辑候选 → 确认 → 目标表出现记录 → 下一次写章或审稿请求含该记录。再验证拒绝、重复确认、项目切换和确认失败重试。

- [ ] **Step 5: 更新文档**

在 `AGENTS.md` 精简记录 v18、事务确认、提取只产生 proposed、两处 DELETE 保护和钩子/债务预算。在 `docs/tool-builder/state.md` 记录实际通过的命令、已知限制和下一项工作。

- [ ] **Step 6: 检查差异并提交**

Run: `git diff --check`

Run: `git status --short`

确认未包含 `.claude/settings.local.json`、`.codex/`、`dist/` 后：

```bash
git add AGENTS.md docs/tool-builder/state.md
git commit -m "docs: record creative decision workflow"
```

- [ ] **Step 7: 汇报，不推送**

汇报实现、测试结果、实际提交号和仍未验证部分。除非用户另行授权，不执行 `git push`。
