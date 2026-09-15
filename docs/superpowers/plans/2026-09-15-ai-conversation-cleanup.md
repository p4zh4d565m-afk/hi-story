# AI 对话清理（软删除 + 短时撤销）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans，按任务执行。步骤用 checkbox 跟踪。
>
> **合同：** [`docs/superpowers/specs/2026-09-15-ai-conversation-cleanup-design.md`](../specs/2026-09-15-ai-conversation-cleanup-design.md)
>
> **分支纪律（不可违反）：**
> 1. **禁止**在 `codex/renderer-typecheck` 上叠本功能编码提交。
> 2. 等 **#145**（`chore(renderer): 建立全量类型检查门槛`，含 `tsconfig.renderer.json`）合入最新 `master`。
> 3. 从该 tip **新开**分支，例如 `codex/ai-conversation-cleanup`，在独立 worktree 施工。
> 4. 本计划文档可暂存在 `#145` 分支上审查；编码只在新分支进行。
>
> **禁止本轮做：** 按章绑定、完整回收站、关应用后撤销、消息硬删、SQL CHECK、Main 流式门闩、改创作决策投影。

**Goal:** 项目级会话支持按轮软删、一键清空（可约 10 秒撤销）与删整会话（硬删+确认）；已删消息永不进 UI/模型上下文；创作决策 `source_message_id` 不断裂。

**Architecture:** 迁移 v22 为 `conversation_messages` 增加 `deleted_at` / `deletion_batch_id`。仓储写路径单事务打批次软删；所有读路径过滤活跃行。渲染端用 token 单飞锁 + 项目守卫驱动 IPC；10 秒撤销条只活在内存；流式互斥仅 UI。

**Tech Stack:** Electron 33、better-sqlite3、React 18、TypeScript、Vitest（Electron-as-Node + `--pool=forks`）、现有 `db:conversation:*` IPC。

## Global Constraints

- 库版本 **21 → 22**；**不做** SQL CHECK；应用层 + 单测保证两列同有同无。
- 公开 `ConversationMessage` / `ConversationSnapshot` **不加**软删字段。
- `clearThread` 空清空：`noop: true`，`batchId: null`，**不改库**，UI **不**挂撤销条。
- 流式门闩 **仅渲染端**；Main 不查 `stream-registry`。
- 清理单飞：token 锁；切项目清 UI **不**开锁；`finally` 仅持有者解锁。
- 清空消息 **不**确认；删整会话 **二次确认** + 现有硬删。
- 定向测用 Electron Vitest；片末 `npm run test` + `npm run typecheck:renderer` + `npm run build:main`。
- `npm run test` 不转发 argv；定向测用下方 `Invoke-TargetedVitest`。

## 执行前置

- [ ] 确认 `origin/master` 已包含 #145（存在 `tsconfig.renderer.json` 与 `npm run typecheck:renderer`）。
- [ ] `git fetch origin master`；`git worktree add .worktrees/ai-conversation-cleanup -b codex/ai-conversation-cleanup origin/master`（先 `git check-ignore -q .worktrees`）。
- [ ] worktree 内 junction/安装依赖后跑基线：`npm run test`、`npm run typecheck:renderer`、`npm run build:main`。失败则停，问用户。
- [ ] 本计划若不在新 worktree：从源 checkout 复制或 checkout 含本文件的提交后再开编码任务。

### 定向测（Windows）

```powershell
function Invoke-TargetedVitest([string[]]$TestFiles) {
  $previousElectronRunAsNode = $env:ELECTRON_RUN_AS_NODE
  $testExitCode = 0
  try {
    $env:ELECTRON_RUN_AS_NODE = '1'
    & .\node_modules\electron\dist\electron.exe node_modules\vitest\vitest.mjs run --pool=forks @TestFiles
    $testExitCode = $LASTEXITCODE
  } finally {
    if ($null -eq $previousElectronRunAsNode) {
      Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
    } else {
      $env:ELECTRON_RUN_AS_NODE = $previousElectronRunAsNode
    }
  }
  if ($testExitCode -ne 0) { throw "定向 Vitest 失败，exit=$testExitCode" }
}
```

下文 `Run: 定向测 …` 均指该函数。

---

## 文件地图

| 路径 | 职责 |
|---|---|
| `src/main/db/migrations.ts` | 新增 v22：`deleted_at`、`deletion_batch_id` + 可选索引 |
| `src/main/db/repositories/conversation.repo.ts` | 读过滤；`deleteTurn` / `clearThread` / `restoreBatch` |
| `src/main/ipc/conversation.ipc.ts` | 注册三新 channel |
| `src/renderer/types/index.ts` | 新增操作入参/结果类型（**不**改 `ConversationMessage` 公开字段） |
| `src/renderer/services/conversation-cleanup-lock.ts` | token 单飞锁纯模块 |
| `src/renderer/services/conversation-turn-range.ts` | （可选，若从 repo 抽出）按轮选 id 纯函数——**本计划把选轮逻辑放在 repo 内测，不强制抽公共包** |
| `src/renderer/components/AIChatPanel.tsx` | 按轮删、清空、撤销条、流式/单飞禁用、项目守卫 |
| `tests/unit/db/conversation.repo.test.ts` | 扩展 schema + 软删用例 |
| `tests/unit/db/conversation-cleanup.migration.test.ts` | v21→v22 迁移（若仓库已有 migrations 测试范式则跟；否则用内存 exec 等价断言） |
| `tests/unit/conversation/cleanup-lock.test.ts` | token 锁：切项目不清锁、持有者 finally |
| `AGENTS.md` / `CLAUDE.md` | 一行功能记录（施工收尾） |

---

### Task 1: 迁移 v22 + 读路径过滤

**Files:**
- Modify: `src/main/db/migrations.ts`（在 version 21 之后追加）
- Modify: `src/main/db/repositories/conversation.repo.ts`（`findByProject` / `findMessage` 活跃过滤）
- Modify: `tests/unit/db/conversation.repo.test.ts`（建表加两列；旧用例仍过）

**Interfaces:**
- Consumes: 现有 `ConversationRepo.findByProject`
- Produces: 消息查询默认 `deleted_at IS NULL`；表上可有软删列

- [ ] **Step 1: 扩展单测内存 schema（先红：故意查不到列也行，先加列）**

在 `conversation.repo.test.ts` 的 `CREATE TABLE conversation_messages` 增加：

```sql
deleted_at TEXT,
deletion_batch_id TEXT
```

并加失败用例意图（下一步实现后变绿）：先写一个「插入软删行后 findByProject 不可见」的测试（此时会失败因为未过滤）。

```typescript
it('findByProject 不返回已软删消息', () => {
  const thread = repo.createThread({ projectId: 'project-a', title: 't', category: 'general' }).data!;
  const user = repo.appendMessage({
    projectId: 'project-a', threadId: thread.id, role: 'user', content: '可见前', contextType: 'chat',
  }).data!;
  db.prepare(`
    UPDATE conversation_messages SET deleted_at = ?, deletion_batch_id = ? WHERE id = ?
  `).run('2026-09-15T00:00:00.000Z', 'batch-1', user.id);

  const msgs = repo.findByProject('project-a').data!.messages[thread.id] ?? [];
  expect(msgs.map(m => m.id)).not.toContain(user.id);
  const raw = db.prepare('SELECT COUNT(*) AS c FROM conversation_messages WHERE id = ?').get(user.id) as { c: number };
  expect(raw.c).toBe(1);
});
```

- [ ] **Step 2: Run 定向测确认失败**

```powershell
Invoke-TargetedVitest @('tests/unit/db/conversation.repo.test.ts')
```

Expected: FAIL — `findByProject` 仍返回该消息。

- [ ] **Step 3: 实现过滤 + 迁移**

`findByProject` 消息 SQL：

```sql
SELECT * FROM conversation_messages
WHERE thread_id = ? AND deleted_at IS NULL
ORDER BY sort_order ASC, timestamp ASC, id ASC
```

`findMessage` 增加 `AND message.deleted_at IS NULL`（对外活跃查找；内部测试可用 raw SQL）。

`migrations.ts` 追加：

```typescript
{
  version: 22,
  sql: `
    ALTER TABLE conversation_messages ADD COLUMN deleted_at TEXT;
    ALTER TABLE conversation_messages ADD COLUMN deletion_batch_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_conversation_messages_deletion_batch
      ON conversation_messages(deletion_batch_id);
  `,
},
```

**不做** CHECK。旧行两列默认为 NULL。

- [ ] **Step 4: Run 定向测通过**

```powershell
Invoke-TargetedVitest @('tests/unit/db/conversation.repo.test.ts')
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/db/migrations.ts src/main/db/repositories/conversation.repo.ts tests/unit/db/conversation.repo.test.ts
git commit -m "feat(conversation): v22 消息软删列与读路径过滤"
```

---

### Task 2: deleteTurn / clearThread / restoreBatch

**Files:**
- Modify: `src/main/db/repositories/conversation.repo.ts`
- Modify: `tests/unit/db/conversation.repo.test.ts`

**Interfaces:**
- Produces:

```typescript
// 放在 types（Task 3 也可先在 repo 文件内定义再上移）
export type ConversationCleanupResult = {
  batchId: string | null;
  threadId: string;
  deletedMessageIds: string[];
  deletedAt: string | null;
  noop: boolean;
};

export type ConversationRestoreResult = {
  batchId: string;
  threadId: string;
  restoredMessageIds: string[];
};

// ConversationRepo:
deleteTurn(projectId: string, threadId: string, userMessageId: string): IpcResult<ConversationCleanupResult>
clearThread(projectId: string, threadId: string): IpcResult<ConversationCleanupResult>
restoreBatch(projectId: string, threadId: string, batchId: string): IpcResult<ConversationRestoreResult>
```

- [ ] **Step 1: 写失败测试（按轮 / 清空 / 撤销 / 空清空）**

```typescript
it('deleteTurn 软删 user 至下一 user 前的回复且可按 batch 恢复', () => {
  const thread = repo.createThread({ projectId: 'project-a', title: 't', category: 'general' }).data!;
  const u1 = repo.appendMessage({ projectId: 'project-a', threadId: thread.id, role: 'user', content: 'Q1', contextType: 'chat' }).data!;
  const a1 = repo.appendMessage({ projectId: 'project-a', threadId: thread.id, role: 'assistant', content: 'A1', contextType: 'chat' }).data!;
  const u2 = repo.appendMessage({ projectId: 'project-a', threadId: thread.id, role: 'user', content: 'Q2', contextType: 'chat' }).data!;
  const a2 = repo.appendMessage({ projectId: 'project-a', threadId: thread.id, role: 'assistant', content: 'A2', contextType: 'chat' }).data!;

  const del = repo.deleteTurn('project-a', thread.id, u1.id);
  expect(del.success).toBe(true);
  expect(del.data?.noop).toBe(false);
  expect(del.data?.batchId).toBeTruthy();
  expect(new Set(del.data!.deletedMessageIds)).toEqual(new Set([u1.id, a1.id]));

  const visible = repo.findByProject('project-a').data!.messages[thread.id].map(m => m.id);
  expect(visible).toEqual([u2.id, a2.id]);

  const restored = repo.restoreBatch('project-a', thread.id, del.data!.batchId!);
  expect(restored.success).toBe(true);
  expect(repo.findByProject('project-a').data!.messages[thread.id].map(m => m.id))
    .toEqual([u1.id, a1.id, u2.id, a2.id]);
});

it('clearThread 无活跃消息时 noop 且不改库', () => {
  const thread = repo.createThread({ projectId: 'project-a', title: 'empty', category: 'general' }).data!;
  const before = db.prepare('SELECT updated_at FROM conversation_threads WHERE id = ?').get(thread.id);
  const res = repo.clearThread('project-a', thread.id);
  expect(res).toMatchObject({ success: true, data: { noop: true, batchId: null, deletedMessageIds: [], deletedAt: null } });
  const after = db.prepare('SELECT updated_at FROM conversation_threads WHERE id = ?').get(thread.id);
  expect(after).toEqual(before);
});

it('restoreBatch 拒绝跨项目或空 batchId', () => {
  expect(repo.restoreBatch('project-a', 'nope', '').success).toBe(false);
});
```

另补：`clearThread` 有消息时整批软删；`deleteTurn` 锚点非 user / 已删 → fail；软删后 `sort_order` 追加仍单调（全表 MAX+1）。

- [ ] **Step 2: Run 定向测 — 期望 FAIL（方法不存在）**

```powershell
Invoke-TargetedVitest @('tests/unit/db/conversation.repo.test.ts')
```

- [ ] **Step 3: 实现三方法（单事务）**

`deleteTurn` 要点：

1. JOIN 校验 thread ∈ project。
2. 读锚点：`role='user' AND deleted_at IS NULL`。
3. 找下一条活跃 user 的 `sort_order` 上界（无则无上界）。
4. 选中：锚点 id ∪（`sort_order` 严格大于锚点且小于下一 user，或无上界则大于锚点）的活跃行。
5. 同一 `batchId` + `deleted_at` 更新；touch thread `updated_at`。
6. 返回 `noop: false`。

`clearThread`：活跃数 0 → 返回 noop；否则 UPDATE 全部活跃行。

`restoreBatch`：`batchId` 空或 0 行 → fail；否则两列置 NULL。

- [ ] **Step 4: Run 定向测 — PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(conversation): deleteTurn/clearThread/restoreBatch 软删批次"
```

---

### Task 3: 共享类型 + IPC

**Files:**
- Modify: `src/renderer/types/index.ts`
- Modify: `src/main/ipc/conversation.ipc.ts`
- Modify: `src/main/db/repositories/conversation.repo.ts`（改为使用共享类型）

**Interfaces:**

```typescript
export type ConversationCleanupResult = { /* 同 Task 2 */ };
export type ConversationRestoreResult = { /* 同 Task 2 */ };

export interface DeleteConversationTurnInput {
  projectId: string;
  threadId: string;
  userMessageId: string;
}
export interface ClearConversationThreadInput {
  projectId: string;
  threadId: string;
}
export interface RestoreConversationBatchInput {
  projectId: string;
  threadId: string;
  batchId: string;
}
```

Channels：

- `db:conversation:deleteTurn`
- `db:conversation:clearThread`
- `db:conversation:restoreBatch`

- [ ] **Step 1: 添加类型与 IPC handler（try/catch → IpcResult）**

- [ ] **Step 2: `npm run build:main` 通过**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(conversation): 暴露清理 IPC 与共享结果类型"
```

---

### Task 4: 渲染端 token 单飞锁

**Files:**
- Create: `src/renderer/services/conversation-cleanup-lock.ts`
- Create: `tests/unit/conversation/cleanup-lock.test.ts`

**Interfaces:**

```typescript
export type CleanupLock = {
  tryAcquire: () => string | null; // 返回 lockToken；失败 null
  release: (token: string) => void; // 仅 token 匹配才清
  isHeld: () => boolean;
  currentToken: () => string | null;
};

export function createCleanupLock(): CleanupLock;
```

- [ ] **Step 1: 失败测试**

```typescript
it('切项目场景：清 UI 侧不调用 release；旧 finally 用原 token 才能解开', () => {
  const lock = createCleanupLock();
  const t1 = lock.tryAcquire();
  expect(t1).toBeTruthy();
  expect(lock.tryAcquire()).toBeNull(); // 单飞
  lock.release('wrong');
  expect(lock.isHeld()).toBe(true);
  lock.release(t1!);
  expect(lock.isHeld()).toBe(false);
});
```

- [ ] **Step 2: 实现最小锁 → 定向测 PASS**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(conversation): 清理操作 token 单飞锁"
```

---

### Task 5: AIChatPanel 清理 UX

**Files:**
- Modify: `src/renderer/components/AIChatPanel.tsx`
- 可选 Create: `tests/unit/conversation/cleanup-guards.test.ts`（若可抽纯函数测项目守卫；否则靠代码审查 + 手测清单）

**行为清单（对照 Spec §5）：**

1. **按轮删除：** 每个 user 气泡「删除本轮」→ `deleteTurn`；成功且 `!noop` → 本地去掉 ids → 10s 撤销条。
2. **清空：** 菜单「清空消息」立即执行 → `clearThread`；`noop` 则轻提示；否则撤销条。
3. **撤销：** `restoreBatch`；成功后 `findByProject` 或按返回 ids 重载当前线程消息。
4. **单飞：** `tryAcquire` 失败则 return；所有清理路径 `finally release(token)`。
5. **项目守卫：** 闭包 `requestProjectId`；不匹配则不改 messages/undo。
6. **切项目：** 清 messages + undo；**不** `release`（等旧请求 finally）。
7. **流式：** `isStreaming` 时禁用删/清空/切线程；清理在飞时禁用发送。
8. **拼 history：** 继续只用本地 `messages`（已无软删）；勿把软删拼进 `chatStream`。
9. **删整会话：** 保持 confirm + `removeThread`；占用同一单飞锁。

- [ ] **Step 1: 实现 UI + 守卫（无新自动化则写手测笔记到 PR）**

撤销条状态示例：

```typescript
type PendingUndo = {
  batchId: string;
  threadId: string;
  projectId: string;
  expiresAt: number; // Date.now() + 10_000
} | null;
```

- [ ] **Step 2: `npm run typecheck:renderer`**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(conversation): 聊天面板按轮删/清空与短时撤销"
```

---

### Task 6: 回归与文档

- [ ] **Step 1: 全量验证**

```powershell
npm run test
npm run typecheck:renderer
npm run build:main
```

Expected: 全绿。

- [ ] **Step 2: 手测清单（真机）**

1. 按轮删中间一轮 → 模型下一问看不到该轮；10s 内撤销恢复。
2. 清空 → 壳还在；撤销恢复；空会话再清空无撤销条。
3. 生成中删/清空/切会话不可点；停止后可。
4. 清理进行中切项目 → 新项目不能立刻再清；旧回执不污染新项目 UI。
5. 软删后确认过的创作决策仍在；SQL 可见消息行。
6. 删整会话仍确认且硬删。

- [ ] **Step 3: 更新 `AGENTS.md` / `CLAUDE.md` 一行**

- [ ] **Step 4: Commit**

```bash
git commit -m "docs: 记录 AI 对话清理软删与短时撤销"
```

---

## Spec 覆盖自检

| Spec 项 | 任务 |
|---|---|
| v22 列、无 CHECK | Task 1 |
| 读过滤 | Task 1 |
| deleteTurn 范围 | Task 2 |
| clearThread noop | Task 2 |
| restoreBatch | Task 2 |
| IPC/类型公开不加软删字段 | Task 3 |
| 单飞 + token finally | Task 4–5 |
| 切项目不开锁 | Task 4–5 |
| 10s 撤销仅内存 | Task 5 |
| 流式仅 UI | Task 5 |
| 删整会话硬删 | Task 5（已有） |
| 决策 FK 不断 | Task 2 断言 + Task 6 手测 |
| 分支纪律 | 执行前置 |

## Placeholder 扫描

无 TBD /「适当处理」；类型名与 Task 2/3 一致。

---

## 执行交接

计划已保存。**编码开始前**必须满足分支纪律（#145 ∈ master → 新分支 worktree）。

**Plan complete and saved to `docs/superpowers/plans/2026-09-15-ai-conversation-cleanup.md`.**

**Two execution options（仅在分支纪律满足后）：**

1. **Subagent-Driven（推荐）** — 每任务新代理 + 审查  
2. **Inline Execution** — 本会话按 executing-plans 推进  

**Which approach?**（若 #145 尚未合入，先合入/合并 #145，再选执行方式。）
