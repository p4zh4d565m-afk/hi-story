# AI Conversation SQLite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 AI 多会话及消息从项目 localStorage 主存迁入 SQLite，同时保持项目隔离和流式显示。

**Architecture:** 复用现有 `conversation_threads`、`conversation_messages`，迁移 v17 增加更新时间、上下文类型和稳定顺序，并新增数据迁移标记。主进程 Repository/IPC 提供原子持久化，渲染端加载器负责一次性 legacy 导入与项目代次隔离，AIChatPanel 只保留流式临时文本和 SQLite 成功快照。

**Tech Stack:** Electron IPC、React、TypeScript、better-sqlite3、Vitest。

## Global Constraints

- 只处理 AI 会话持久化，不实现创作决策确认账本。
- 不删除旧聊天；legacy localStorage 成功导入后仍保留原键。
- AI 流完整结束后才写 assistant 消息，失败不得写成完整成功记录。
- 不改变 AI provider 调用、SSE 事件及逐字显示机制。
- 所有 IPC 返回 `IpcResult<T>`，渲染端写状态前校验项目 ID 与请求代次。

---

### Task 1: SQLite schema and repository

**Files:**
- Modify: `src/main/db/migrations.ts`
- Create: `src/main/db/repositories/conversation.repo.ts`
- Modify: `src/renderer/types/index.ts`
- Create: `tests/unit/db/conversation.repo.test.ts`

**Interfaces:**
- Produces: `ConversationRepo.findByProject(projectId)`、`createThread(input)`、`removeThread(projectId, threadId)`、`appendMessage(input)`、`migrateLegacy(projectId, legacy)`。
- Produces: `ConversationSnapshot`、`CreateConversationThreadInput`、`AppendConversationMessageInput`、`LegacyConversationData`、`LegacyMigrationResult`。

- [ ] **Step 1: Write failing repository tests**

测试建立包含项目、线程、消息和迁移状态的内存数据库，并验证：

```ts
const thread = repo.createThread({ projectId: projectA, title: '角色讨论', category: 'character' });
repo.appendMessage({ projectId: projectA, threadId: thread.data!.id, role: 'user', content: '先问', contextType: 'chat' });
repo.appendMessage({ projectId: projectA, threadId: thread.data!.id, role: 'assistant', content: '后答', providerId: 'openai', contextType: 'chat' });

expect(repo.findByProject(projectA).data!.messages[thread.data!.id].map(message => message.content)).toEqual(['先问', '后答']);
expect(repo.findByProject(projectB).data!.threads).toEqual([]);
```

另写迁移测试：同一 legacy payload 调用两次只产生一份数据；注入非法消息令事务失败，断言没有迁移标记且数据库无部分导入。

- [ ] **Step 2: Run repository tests and verify RED**

Run:

```powershell
$env:ELECTRON_RUN_AS_NODE='1'
.\node_modules\electron\dist\electron.exe .\node_modules\vitest\vitest.mjs run tests/unit/db/conversation.repo.test.ts
Remove-Item Env:ELECTRON_RUN_AS_NODE
```

Expected: FAIL because `conversation.repo.ts` and new types do not exist.

- [ ] **Step 3: Add migration v17 and shared types**

迁移执行：

```sql
ALTER TABLE conversation_threads ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
UPDATE conversation_threads SET updated_at = created_at WHERE updated_at = '';
ALTER TABLE conversation_messages ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
ALTER TABLE conversation_messages ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conversation_messages ADD COLUMN context_type TEXT NOT NULL DEFAULT 'chat';
UPDATE conversation_messages SET updated_at = timestamp WHERE updated_at = '';
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY thread_id ORDER BY timestamp, id) - 1 AS position
  FROM conversation_messages
)
UPDATE conversation_messages SET sort_order = (SELECT position FROM ranked WHERE ranked.id = conversation_messages.id);
CREATE INDEX IF NOT EXISTS idx_conversation_threads_project ON conversation_threads(project_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_conversation_messages_thread_order ON conversation_messages(thread_id, sort_order);
CREATE TABLE IF NOT EXISTS data_migration_state (
  project_id TEXT NOT NULL,
  migration_key TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  PRIMARY KEY (project_id, migration_key),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
```

类型使用 camelCase 映射 SQL 字段，并让 `ConversationSnapshot.messages` 为 `Record<string, ConversationMessage[]>`。

- [ ] **Step 4: Implement ConversationRepo minimally**

Repository 规则：

```ts
const LEGACY_MIGRATION_KEY = 'ai_threads_localstorage_v1';

appendMessage(input) {
  // 必须以 project_id + thread_id 验证归属；在事务中计算 MAX(sort_order)+1、插入消息并 touch 线程。
}

migrateLegacy(projectId, legacy) {
  // 同一事务：检查 marker → 校验并导入原 ID/时间/数组顺序 → 写 marker。
  // 任一步抛错则回滚，不留下 marker 或部分记录。
}
```

所有方法捕获异常并返回 `{ success: false, error }`；删除线程必须同时带 `projectId`，依赖外键级联删除消息。

- [ ] **Step 5: Run repository tests and verify GREEN**

Run the Task 1 command. Expected: all conversation repository tests PASS.

---

### Task 2: IPC and project-safe legacy loader

**Files:**
- Create: `src/main/ipc/conversation.ipc.ts`
- Modify: `src/main/ipc/index.ts`
- Create: `src/renderer/services/conversation-persistence.ts`
- Create: `tests/unit/conversation/conversation-loader.test.ts`

**Interfaces:**
- Consumes: Task 1 Repository and types.
- Produces: `createConversationLoader(options)` with `load(projectId)` and `invalidate()`.
- Produces IPC channels `db:conversation:findByProject/createThread/removeThread/appendMessage/migrateLegacy`.

- [ ] **Step 1: Write failing loader tests**

使用 deferred IPC 响应验证：

```ts
const loadingA = loader.load('A');
const loadingB = loader.load('B');
resolveB(snapshotB);
resolveA(snapshotA);
expect(appliedProjectId).toBe('B');
```

再验证旧 key 被读取但不删除；迁移 IPC 返回失败时调用 `onError`，storage 原值仍存在；同项目刷新失败时 `onApply` 不被空快照调用。

- [ ] **Step 2: Run loader tests and verify RED**

Run the Electron-as-Node Vitest command for `tests/unit/conversation/conversation-loader.test.ts`.
Expected: FAIL because the persistence service does not exist.

- [ ] **Step 3: Implement conversation IPC**

每个 handler 只转发到 `ConversationRepo`，并包裹 try/catch：

```ts
ipcMain.handle('db:conversation:findByProject', (_event, projectId) => getRepo().findByProject(projectId));
ipcMain.handle('db:conversation:appendMessage', (_event, input) => getRepo().appendMessage(input));
```

在 `registerAllIpc()` 注册，不修改现有 AI 流式 IPC。

- [ ] **Step 4: Implement loader and migration adapter**

```ts
const raw = storage.getItem(`hi-story-threads-${projectId}`);
const legacy = raw === null ? null : parseLegacyThreadData(raw);
await invoke('db:conversation:migrateLegacy', projectId, legacy);
const snapshot = await invoke('db:conversation:findByProject', projectId);
if (isCurrent(projectId, generation)) onApply(projectId, snapshot.data);
```

不得调用 `storage.removeItem` 或写入项目聊天 key。解析或 IPC 失败只调用当前项目的 `onError`，旧项目错误静默视为 stale。

- [ ] **Step 5: Run loader tests and verify GREEN**

Run the Task 2 test command. Expected: all loader/migration isolation tests PASS.

---

### Task 3: Streaming completion boundary

**Files:**
- Modify: `src/renderer/services/conversation-persistence.ts`
- Create: `tests/unit/conversation/stream-persistence.test.ts`

**Interfaces:**
- Produces: `consumeAndPersistAssistantStream(options): Promise<ConversationMessage>`。
- Consumes: existing `AsyncGenerator<string>` whose yielded value is accumulated full text.

- [ ] **Step 1: Write failing stream tests**

```ts
await expect(consumeAndPersistAssistantStream({
  stream: failingStream(),
  onProgress,
  persist: async content => { persisted.push(content); return assistantMessage; },
})).rejects.toThrow('流失败');
expect(persisted).toEqual([]);
expect(progress).toContain('临时内容');
```

成功测试断言 `onProgress` 收到中间内容，而 `persist` 仅在 generator 正常结束后调用一次且内容为最终全文。

- [ ] **Step 2: Run stream tests and verify RED**

Run the Electron-as-Node Vitest command for `tests/unit/conversation/stream-persistence.test.ts`.
Expected: FAIL because the helper is absent.

- [ ] **Step 3: Implement the completion boundary helper**

```ts
export async function consumeAndPersistAssistantStream(options) {
  let fullText = '';
  for await (const text of options.stream) {
    fullText = text;
    options.onProgress(text);
  }
  if (!fullText.trim()) throw new Error('AI 未返回可保存内容');
  return options.persist(fullText);
}
```

不要捕获 generator 错误；失败自然跳过 `persist`。

- [ ] **Step 4: Run stream tests and verify GREEN**

Run the Task 3 test command. Expected: success and failure cases PASS.

---

### Task 4: AIChatPanel SQLite integration

**Files:**
- Modify: `src/renderer/components/AIChatPanel.tsx`
- Modify: `tests/unit/conversation/conversation-loader.test.ts`

**Interfaces:**
- Consumes: Task 2 loader/IPC and Task 3 stream helper.
- Preserves: current `contextMessages` input, provider configuration, token usage, streaming UI and thread category controls.

- [ ] **Step 1: Add a failing orchestration test for persistence order**

扩展测试：先成功调用 `appendMessage(user)`，随后消费流，最后调用 `appendMessage(assistant)`；流失败时调用记录只包含 user，不能包含 assistant。

- [ ] **Step 2: Run orchestration test and verify RED**

Expected: FAIL until panel-facing persistence helper exposes the required turn orchestration behavior.

- [ ] **Step 3: Replace localStorage thread persistence**

删除 `loadThreadData/saveThreadData` 的正常读写路径。项目 effect 调用 loader，成功才提交项目快照；若新项目没有线程，调用 `createThread` 创建“默认对话”。项目切换时 snapshot 必须与当前 `projectId` 匹配才显示。

线程创建、删除、消息发送改为 async IPC；搜索继续查当前 SQLite 快照。删除前的旧回收站兼容写入保留，但不作为活跃会话主存。

- [ ] **Step 4: Preserve stream UI with reliable writes**

普通聊天和续写入口统一为：

```ts
const savedUser = await appendMessage({ role: 'user', contextType });
setMessages(previous => [...previous, savedUser]);
const savedAssistant = await consumeAndPersistAssistantStream({
  stream: aiService.chatStream(chatMessages, options),
  onProgress: setStreamingText,
  persist: content => appendMessage({ role: 'assistant', content, providerId, contextType }),
});
if (projectIdRef.current === requestProjectId) setMessages(previous => [...previous, savedAssistant]);
```

失败只显示错误；`finally` 清理当前请求的 streaming 状态，不得把部分内容追加为历史消息。

- [ ] **Step 5: Show load and migration errors without clearing a valid snapshot**

面板现有错误区域显示 SQLite/迁移错误。当前项目已有 snapshot 时加载失败保留；切换项目时通过 snapshot 的 projectId 过滤旧数据，避免跨项目显示。

- [ ] **Step 6: Run focused tests and renderer build**

Run all `tests/unit/conversation/*` plus repository tests, then `npx vite build` and `npm run build:main`.
Expected: tests and both builds PASS.

---

### Task 5: Documentation, regression, and commit

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/tool-builder/state.md`

**Interfaces:**
- Records: v17 schema、legacy migration contract、流完成写入边界和项目代次约束。

- [ ] **Step 1: Update project memory concisely**

在 AGENTS 增加 AI 会话持久化关键约束；state 标记会话迁移完成，并把“创作决策确认账本”保留为下一优先项。

- [ ] **Step 2: Run complete verification**

```powershell
$env:ELECTRON_RUN_AS_NODE='1'
.\node_modules\electron\dist\electron.exe .\node_modules\vitest\vitest.mjs run
Remove-Item Env:ELECTRON_RUN_AS_NODE
npm run build
node tests/ui/run-writing-workspace.cjs
git diff --check
```

Expected: all unit/E2E tests PASS, production build succeeds, UI regression passes, no whitespace errors.

- [ ] **Step 3: Inspect and commit only scoped files**

确认 `.claude/`、`.codex/` 未纳入暂存区，检查 staged diff 后提交：

```bash
git commit -m "feat: persist AI conversations in SQLite"
```

不要推送 GitHub。
