# P0：请求级 Provider、策划 committed 快照、写章预览安全

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans，按任务执行。步骤用 checkbox 跟踪。
>
> **合同：** `docs/superpowers/specs/2026-09-13-ai-production-current-contract.md`
>
> **修订依据：** `docs/superpowers/plans/2026-09-13-p0-provider-planning-preview-review.md` 第七节。本文已按该节默认值改写，**不要再执行旧版 7 个 Task**。
>
> **施工进度（2026-09-14）：** P0 三片 + Obsidian 导入分隔已快进合入 `feature/skill-engine`（HEAD `6ff75e1`），未 push。历史交接见 `docs/superpowers/plans/2026-09-13-p0-status.md`。
>
> **执行：** 独立 git worktree + 三片**顺序**实施 + 每片「规格符合性 + 代码质量」双重审查。三片不要并行（都可能改 `AIWritePanel`）。共享 checkout 不写 P0。不 push。任务级 commit 仅在用户已授权「独立 worktree 内按原子片提交」时执行，否则不启动 Subagent-Driven 执行。
>
> **禁止：** 数据库迁移；`ProviderFactory.invalidateCache()`；Markdown 渲染预览；把策划字段全部抬进 App；改 `hi-story-ai-configs` 为按项目；实现 as-of / 分析 jobs / ContextAssembler；创建 P1 Spec。

**Goal:** 每次 AI 请求使用当次快照配置且面板不再串供应商；AI 只读已保存策划；写章预览不再注入 HTML。

**Architecture:** 渲染端纯函数把保存的配置拷成 `ProviderConfig`。`chatStream` 用同步外壳在调用瞬间快照，再进入内部 generator；`chat()` 在入口快照。App 持有 committed `PlanningIdea`：普通保存用 IPC 返回值立刻更新，导入才 guarded reload；同项目旧 AI 写库前用 per-project 内存 epoch 拦截。写章仍把 HTML 原文存进章节，预览用分段文本节点，零 `innerHTML`。

**Tech Stack:** Electron 33、React 18、TypeScript、Vitest、现有 IPC `ai:chat` / `ai:chatStream` / `db:planning:save`（主进程已经按请求收 `ProviderConfig`，save 已返回完整 `PlanningIdea`）。

## Global Constraints

- 无迁移；最新库版本保持 v20。
- 全仓删除 `aiService.configure(...)`；允许 TipTap `Placeholder.configure`。
- `snapshotAIRequestConfig` 的 `name` = Factory 供应商标识（现预设 `ProviderPreset.name`，等于 `id`）。禁止 `displayName`。
- `writeModel` / `summaryModel` 写入当次 `config.model`；渲染端 `ChatCallOptions` 无 `model`。主进程 `ChatOptions.model` **不删**。
- `chatStream` 同步外壳 + `projectId` 必填；`chat()` 不强制 `projectId`。
- 缓存继续 `providerCacheKey(name:model|baseUrl|apiKey)`。renderer 禁止 `invalidateCache`。
- loader 失败不得把同项目 committed 快照写成 null。
- 普通保存：`onPlanningCommitted(projectId, res.data)`。导入：写库前 reserve + guarded reload。写仲裁：`Map<projectId, number>` 内同步「比较 + 递增」，必须早于 IPC，失败不回滚，无 DB revision。
- 预览：分段文本节点；保存仍是 HTML 原文。不改写章 prompt。
- `npm run test` **不转发 argv**（`scripts/run-tests.js` 只跑全量）。片内 TDD 用下面「定向测」。`npx vite build` 不是 renderer 类型检查；改签名后必须改 `tests/unit/ai-stream-cancel.test.ts`，不能靠 vite 过关。
- 共享工作区不提交。独立 worktree 内任务级 commit、不 push，需用户事先授权。

## 执行前置（不是功能片）

- 当前 `D:\ccx` 是带未提交改动的普通 checkout；不得直接在其中施工。
- 选 Subagent-Driven 时，先使用 `superpowers:using-git-worktrees` 建立 `codex/p0-provider-planning-preview` 独立 worktree，记录起点 commit、merge base 和 worktree 绝对路径。进入 worktree 后执行 `$sddPath = git rev-parse --git-path sdd; New-Item -ItemType Directory -Force $sddPath | Out-Null; git rev-parse HEAD | Set-Content (Join-Path $sddPath 'base-commit.txt')`。所有实现与审查代理都必须使用该绝对路径。
- 仓库内没有已忽略的 `.worktrees/` / `worktrees/`；不得未校验 `git check-ignore` 就在仓库内创建。优先平台原生 worktree，否则用仓库外路径。
- 本计划与合同当前是源 checkout 的未跟踪文件，新 worktree 不会自动出现它们。controller 必须从源 checkout 绝对路径生成每片 task brief，不得让代理假定计划已在 worktree 内。
- 安装/复用依赖后先跑 `npm run test` 与 `npm run build:main`。基线失败时停止实施，由用户决定先修基线还是记录已知失败继续。
- 每片只派一个 fresh implementer，不并行实现。每片提交后记录 base/head，生成完整 diff package，交给 fresh reviewer 同时给出「规格符合性」和「代码质量」结论；Critical/Important 全部修复并复审后才进下一片，同步写 SDD progress ledger。
- Windows 若无可用 Bash，不得直接调 SDD 的 Bash helper；用 PowerShell 等价生成 task brief / review package（commit 列表 + `git diff --stat` + `git diff -U10`）。

### 定向测（Windows）

```powershell
function Invoke-TargetedVitest([string[]]$TestFiles) {
  $previousElectronRunAsNode = $env:ELECTRON_RUN_AS_NODE
  $testExitCode = 0
  try {
    $env:ELECTRON_RUN_AS_NODE = '1'
    & .\node_modules\electron\dist\electron.exe node_modules\vitest\vitest.mjs run @TestFiles
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

下文 `Run: 定向测 fileA fileB` 都指 `Invoke-TargetedVitest @('fileA', 'fileB')`。片末和总验收用 `npm run test`（全量）。

---

## 文件地图

- Create: `src/renderer/services/ai/request-config.ts` — Provider 快照纯函数
- Create: `tests/unit/ai-request-config.test.ts`
- Create: `src/renderer/services/planning-write-epoch.ts` — per-project 写库代数
- Create: `tests/unit/planning-write-epoch.test.ts`
- Create: `src/renderer/services/planning-persistence.ts` — reserve 后才发 save IPC，返回判别结果
- Create: `tests/unit/planning-persistence.test.ts`
- Create: `src/renderer/services/ai/generated-preview.ts` — 写章预览切段
- Create: `tests/unit/generated-preview.test.ts`
- Modify: `src/renderer/services/ai.service.ts` — 必收 config；同步外壳；删 `configure`
- Modify: `src/main/ipc/ai.ipc.ts` — 流式 `projectId` 按 trim 后非空校验并只登记归一化值
- Create: `src/main/ai/stream-project-id.ts` — 流式项目 ID 纯函数校验
- Create: `tests/unit/stream-project-id.test.ts`
- Modify: `tests/unit/ai-stream-cancel.test.ts` — 新签名 + 快照时点
- Modify: 7 个原 `configure` 调用方（14 处 `chat`/`chatStream`）
- Modify: `src/renderer/services/planning-loader.ts` — 失败不 `onApply`
- Modify: `tests/unit/planning-loader.test.ts`
- Modify: `src/renderer/components/PlanningWorkspace.tsx` — persist 返回值、epoch、committed
- Modify: `src/renderer/App.tsx` — `onPlanningCommitted` + loader `onError`
- Modify: `src/renderer/components/ObsidianImportPanel.tsx` — 触及策划的导入在 commit IPC 前 reserve
- Modify: `tests/ui/obsidian-import.tsx` — 锁定导入在 commit IPC 前 reserve，且刷新 committed 失败留在 refreshPending
- Modify: `src/renderer/components/AIWritePanel.tsx` — 分模型快照 + 分段预览

---

### Task 1: Provider 原子片（快照 + 服务 + 14 个调用点）

**Files:**
- Create: `src/renderer/services/ai/request-config.ts`
- Create: `tests/unit/ai-request-config.test.ts`
- Create: `src/main/ai/stream-project-id.ts`
- Create: `tests/unit/stream-project-id.test.ts`
- Modify: `src/main/ipc/ai.ipc.ts`
- Modify: `src/renderer/services/ai.service.ts`
- Modify: `tests/unit/ai-stream-cancel.test.ts`
- Modify: `src/renderer/components/AIChatPanel.tsx`
- Modify: `src/renderer/components/AIWritePanel.tsx`
- Modify: `src/renderer/components/AIReviewPanel.tsx`
- Modify: `src/renderer/components/AIPolishPanel.tsx`
- Modify: `src/renderer/components/ContextPanel.tsx`
- Modify: `src/renderer/components/NameGenerator.tsx`
- Modify: `src/renderer/components/PlanningWorkspace.tsx`

**Interfaces:**
- Produces: `snapshotAIRequestConfig(input, modelOverride?: string): ProviderConfig`
- Produces:
  - `chat(config: ProviderConfig, messages: ChatMessage[], options?: ChatCallOptions): Promise<string>`
  - `chatStream(config: ProviderConfig, messages: ChatMessage[], options: ChatCallOptions | undefined, projectId: string): AsyncGenerator<string>`
  - `ChatCallOptions = { maxTokens?: number; temperature?: number; systemPrompt?: string }`（无 `model`）
- 不再导出 `configure`。主进程 `ChatOptions.model` 不动。

本片必须一次改完：只改服务签名、不改调用方会留下不可运行树。`ai-stream-cancel.test.ts` 属于本片，不是「若 mock 旧签名再改」。

- [ ] **Step 1: 写 `snapshotAIRequestConfig` 失败测试**

```ts
import { describe, it, expect } from 'vitest';
import { snapshotAIRequestConfig } from '../../src/renderer/services/ai/request-config';

describe('snapshotAIRequestConfig', () => {
  it('拷贝字段，后续改入参不影响快照', () => {
    const input = { name: 'claude', apiKey: 'sk-live', model: 'claude-sonnet-4-6', baseUrl: 'https://api.anthropic.com' };
    const snap = snapshotAIRequestConfig(input);
    input.apiKey = 'sk-mutated';
    input.model = 'other';
    input.name = 'openai';
    expect(snap.apiKey).toBe('sk-live');
    expect(snap.model).toBe('claude-sonnet-4-6');
    expect(snap.name).toBe('claude');
    expect(snap.baseUrl).toBe('https://api.anthropic.com');
  });

  it('name 取供应商标识，不接受空白', () => {
    const snap = snapshotAIRequestConfig({ name: ' deepseek ', apiKey: 'k', model: 'deepseek-chat' });
    expect(snap.name).toBe('deepseek');
    expect(() => snapshotAIRequestConfig({ name: '   ', apiKey: 'k', model: 'm' }))
      .toThrow('Provider name 不能为空');
  });

  it('modelOverride 非空则覆盖 model；空串或空白则用默认 model', () => {
    const base = { name: 'deepseek', apiKey: 'k', model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1' };
    expect(snapshotAIRequestConfig(base, 'deepseek-reasoner').model).toBe('deepseek-reasoner');
    expect(snapshotAIRequestConfig(base, '').model).toBe('deepseek-chat');
    expect(snapshotAIRequestConfig(base, '  ').model).toBe('deepseek-chat');
    expect(snapshotAIRequestConfig(base).model).toBe('deepseek-chat');
  });

  it('apiKey 与 model 做 trim', () => {
    const snap = snapshotAIRequestConfig({ name: 'openai', apiKey: '  sk  ', model: ' gpt-4o ' });
    expect(snap.apiKey).toBe('sk');
    expect(snap.model).toBe('gpt-4o');
  });

  it('baseUrl 缺省时字段为 undefined', () => {
    const snap = snapshotAIRequestConfig({ name: 'openai', apiKey: 'k', model: 'gpt-4o' });
    expect(snap.baseUrl).toBeUndefined();
  });

  it('baseUrl 空白视为缺省，不写字段', () => {
    const snap = snapshotAIRequestConfig({ name: 'openai', apiKey: 'k', model: 'gpt-4o', baseUrl: '  ' });
    expect(snap.baseUrl).toBeUndefined();
  });
});
```

- [ ] **Step 2: 定向测确认失败**

Run: 定向测 `tests/unit/ai-request-config.test.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 最小实现快照函数**

`src/renderer/services/ai/request-config.ts`：

```ts
import type { ProviderConfig } from '../../../main/ai/provider';

export function snapshotAIRequestConfig(
  input: { name: string; apiKey: string; model: string; baseUrl?: string },
  modelOverride?: string,
): ProviderConfig {
  const override = modelOverride?.trim();
  const name = String(input.name ?? '').trim();
  if (!name) throw new Error('Provider name 不能为空');
  const snap: ProviderConfig = {
    name,
    apiKey: String(input.apiKey ?? '').trim(),
    model: override ? override : String(input.model ?? '').trim(),
  };
  const baseUrl = input.baseUrl?.trim();
  if (baseUrl) snap.baseUrl = baseUrl;
  return snap;
}
```

不要照抄旧 `configure` 的 `if (model) this.currentModel = model`：不再有全局 leftover，空串不得复活上一次请求的 model/baseUrl。

- [ ] **Step 4: 定向测快照测试通过**

Run: 定向测 `tests/unit/ai-request-config.test.ts`

Expected: PASS。

- [ ] **Step 5: 改 `ai.service.ts` 签名与同步外壳**

在 `src/renderer/services/ai.service.ts`：

- `import type { ChatMessage, ProviderConfig } from '../../main/ai/provider'`
- `import { snapshotAIRequestConfig } from './ai/request-config'`
- 渲染端 `ChatOptions` 改名为 `ChatCallOptions`，**删掉 `model?`**
- 删除 `currentProvider/currentApiKey/currentModel/currentBaseUrl` 和 `configure`
- `chat` 入口立刻 `const config = snapshotAIRequestConfig(inputConfig)`，缺 `apiKey` 仍抛「请先添加 AI 配置（点击 ⚙️ → 选择服务 → 输入 API Key）」
- **`chatStream` 本身不是 `async *`**：调用瞬间快照 + 校验 `projectId`，再 `return this.runChatStream(...)`
- `runChatStream` 才是 `async *`，只用外壳传入的 `config` / `projectId`，不要再读任何实例字段
- IPC `ai:chat` / `ai:chatStream` 的 options 对象不要带 `model`
- 修 `lastYieldTime = now` 越界：`finished` 后补 yield 那段改用 `Date.now()`，不要用块外 `now`（约 163–165 行）
- `src/main/ipc/ai.ipc.ts` 同步收紧为 `projectId: string`：`const pid = String(projectId ?? '').trim()`，空值返回现有「缺少 projectId」错误；`streamRegistry.register` 只写 `pid`。不得继续把空白字符串登记进取消表。

这一跨层收紧也要 TDD：先在 `stream-project-id.test.ts` 断言 `' p1 '` 归一化为 `'p1'`，`'' / '   ' / undefined` 都抛现有「缺少 projectId」错误；再在 `stream-project-id.ts` 实现 `normalizeStreamProjectId(value: unknown): string`，`ai.ipc.ts` 只调该函数并登记返回值。

外壳形状（必须按此写，不能只在 generator 函数体第一行拷贝）：

```ts
export interface ChatCallOptions {
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

chatStream(
  inputConfig: ProviderConfig,
  messages: ChatMessage[],
  options: ChatCallOptions | undefined,
  projectId: string,
): AsyncGenerator<string> {
  const config = snapshotAIRequestConfig(inputConfig);
  const pid = String(projectId ?? '').trim();
  if (!pid) throw new Error('chatStream 需要 projectId');
  if (!config.apiKey) {
    throw new Error('请先添加 AI 配置（点击 ⚙️ → 选择服务 → 输入 API Key）');
  }
  return this.runChatStream(config, messages, options, pid);
}
```

`validateKey` / `getModels` / `cancelActiveStreams` / `ignoreProjectStreams` 保持现有签名。`rg "invalidateCache" src/renderer` 必须无匹配。

- [ ] **Step 6: 重写 `tests/unit/ai-stream-cancel.test.ts`**

删除所有 `aiService.configure(...)`。`chatStream` 第一参为 config。`options` 不再含 `model`。`projectId` 必填。

在现有 `makeWindow` 上记下 `invoke` 收到的 config。补三例（保留原取消/切项目用例，全部改签名）：

```ts
const cfg = (): ProviderConfig => ({ name: 'openai', apiKey: 'test-key', model: 'gpt-4o' });

it('缺 projectId 在调用瞬间抛错，不发 IPC', async () => {
  expect(() => aiService.chatStream(cfg(), [{ role: 'user', content: 'hi' }], undefined, '  ')).toThrow('chatStream 需要 projectId');
  expect((window as any).electronAPI.invoke).not.toHaveBeenCalled();
});

it('两路重叠流使用各自快照，互不串 model', async () => {
  const a = { name: 'openai', apiKey: 'ka', model: 'model-a' };
  const b = { name: 'openai', apiKey: 'kb', model: 'model-b' };
  const g1 = aiService.chatStream(a, [{ role: 'user', content: 'a' }], undefined, 'p1');
  const g2 = aiService.chatStream(b, [{ role: 'user', content: 'b' }], undefined, 'p1');
  const p1 = collect(g1);
  const p2 = collect(g2);
  await new Promise(r => setTimeout(r, 10));
  const invoke = (window as any).electronAPI.invoke as ReturnType<typeof vi.fn>;
  const streamCalls = invoke.mock.calls.filter((c: unknown[]) => c[0] === 'ai:chatStream');
  expect(streamCalls[0][1].model).toBe('model-a');
  expect(streamCalls[1][1].model).toBe('model-b');
  emit('ai:streamToken', 'stream-p1-1', 'A');
  emit('ai:streamComplete', 'stream-p1-1', 'A');
  emit('ai:streamToken', 'stream-p1-2', 'B');
  emit('ai:streamComplete', 'stream-p1-2', 'B');
  expect((await p1).join('')).toContain('A');
  expect((await p2).join('')).toContain('B');
});

it('取得 generator 后改原 config，IPC 仍是调用瞬间快照', async () => {
  const input = { name: 'openai', apiKey: 'test-key', model: 'gpt-4o' };
  const gen = aiService.chatStream(input, [{ role: 'user', content: 'hi' }], undefined, 'p1');
  input.model = 'mutated-after-call';
  input.apiKey = 'mutated-key';
  const p = collect(gen);
  await new Promise(r => setTimeout(r, 10));
  const invoke = (window as any).electronAPI.invoke as ReturnType<typeof vi.fn>;
  const streamCall = invoke.mock.calls.find((c: unknown[]) => c[0] === 'ai:chatStream');
  expect(streamCall[1].model).toBe('gpt-4o');
  expect(streamCall[1].apiKey).toBe('test-key');
  emit('ai:streamToken', 'stream-p1-1', 'ok');
  emit('ai:streamComplete', 'stream-p1-1', 'ok');
  await p;
});
```

旧用例里 `chatStream([{ role: 'user', content: 'hi' }], { model: 'm' }, 'p1')` 一律改为 `chatStream(cfg(), [{ role: 'user', content: 'hi' }], undefined, 'p1')`。`makeWindow` 的 mock 是 `invoke(channel: string, ...args)`，`channel` **不在** `args` 内，所以新旧 IPC 参数位置都是 `args[0]=config` / `args[1]=messages` / `args[2]=options` / `args[3]=projectId`。不得改成 `args[4]`，否则 generator 会等不到测试发送的唯一 streamId 而挂起。

`makeWindow` 增加每个测试在 `beforeEach` 归零的 `streamSequence`：

```ts
if (channel === 'ai:chatStream') {
  const projectId = args[3] ?? '';
  streamSequence += 1;
  return { success: true, data: { streamId: `stream-${projectId}-${streamSequence}` } };
}
```

再补一例非流式 `chat()`：断言 IPC 顺序为 `ai:chat, config, messages, options`，修改原 config 不影响已发出快照，且 options 中无 `model`。重叠流测试使用**同一 projectId + 递增唯一 streamId**，覆盖同书写章/审稿/润色并发不串配置；按项目取消时两路都必须结束。

- [ ] **Step 7: 定向测流取消**

Run: 定向测 `tests/unit/ai-stream-cancel.test.ts` `tests/unit/provider-cache-key.test.ts` `tests/unit/stream-project-id.test.ts`

Expected: PASS。

- [ ] **Step 8: 清掉 7 个面板的 configure，14 处改为传快照**

统一模式（每个调用点都按此写）：

```ts
const config = snapshotAIRequestConfig({
  name: preset.name, // Factory 标识；现预设 name === id === providerId
  apiKey: active.apiKey,
  model: active.model,
  baseUrl: active.baseUrl || preset.baseUrl,
});
await aiService.chat(config, messages, { maxTokens, temperature });
// 流式：
for await (const text of aiService.chatStream(config, messages, { maxTokens, temperature }, projectId)) { ... }
```

禁止再传 `{ model: ... }` 给 `chat`/`chatStream` 的 options。`AIChatPanel` 约 633、712 行现在就是这种第二层覆盖，必须删掉。

分面板要点：

**AIChatPanel.tsx**
- 删除约 389–399 行「activeConfig 变化就 `configure`」的 `useEffect`
- 删除已失效的 `ChatOptions` 类型导入
- 所有面板的 `SavedConfig` 统一保留 `baseUrl?: string`，解析规则钉死为「保存值优先、preset 兜底」，`name` 用 `preset?.name ?? providerId`。这只兼容现有全局 `hi-story-ai-configs`，不改成按项目。
- 发送 / 抽取时：`snapshotAIRequestConfig({ name: activeProvider?.name ?? activeConfig.providerId, apiKey: activeConfig.apiKey, model: activeConfig.model, baseUrl: activeConfig.baseUrl || activeProvider?.baseUrl })`。即使未在本地 preset 列表找到自定义 provider，也不得丢掉已保存 `baseUrl`。
- `createStream` 与 `handleExtractDecisions` 都改四参签名；options 只留 `maxTokens` / `temperature`

**AIWritePanel.tsx（补 B，必须）**
- `init` 解密后把 `{ name: preset?.name ?? active.providerId, apiKey: active.apiKey, model: active.model, baseUrl: active.baseUrl || preset?.baseUrl }` 存进 state（例如 `requestBase`），不要 configure 完丢掉。未知 provider 只有在同时缺少已保存 baseUrl 时才报错。
- 写章 / 批量：`snapshotAIRequestConfig(requestBase, writeModel)`
- `generateAndSaveSummary`：`snapshotAIRequestConfig(requestBase, summaryModel)`
- `writeModel` / `summaryModel` 的 UI state 保留；空 = 用 `requestBase.model`
- `runBatch` / `handleGenerate` / `generateAndSaveSummary` 的 Hook 依赖必须包含 `requestBase`；空配置、未知且缺已保存 baseUrl 的供应商、或解密失败时同步清空 `requestBase`，不得复活上次打开的供应商。
- `handleBatchGenerate` / `handleBatchResume` 必须依赖最新 `runBatch`，`handleSave` 必须依赖最新 `generateAndSaveSummary`；必要时调整声明顺序或改用 ref，不得只修第一层 callback 而留下二级旧闭包。
- 本片只改请求配置，**不要**改预览 `dangerouslySetInnerHTML`（那是 Task 3）

**AIReviewPanel.tsx / AIPolishPanel.tsx**
- 与写章相同：init 存 `requestBase`（`name = preset?.name ?? active.providerId`，`baseUrl = active.baseUrl || preset?.baseUrl`，不要 displayName）
- `AIReviewPanel` 两处、`AIPolishPanel` 一处，合计三处 `chatStream` 带上 `requestBase` 快照和 `projectId`
- `AIReviewPanel.handleReview/handleAutoRevise` 与 `AIPolishPanel.handlePolish` 的 Hook 依赖包含 `requestBase`；失败分支同样清空。

**ContextPanel.tsx**
- 删 `configure`；`chat` 前用 `preset?.name ?? active.providerId` 当 `name`，`active.baseUrl || preset?.baseUrl` 当 `baseUrl`。

**NameGenerator.tsx**
- init 不要 `configure`。把快照存进 `useRef<ProviderConfig | null>`
- `name: provider?.name || providerId`（不要 `cfg.name` 若那是显示名），`baseUrl: cfg.baseUrl || provider?.baseUrl`。
- `generateNames` 里 `aiService.chat(ref.current, messages, options)`；无 ref 则走离线兜底

**PlanningWorkspace.tsx**
- `configureFirstAi` 改名为 `loadFirstAiConfig`，返回 `ProviderConfig`，内部无 `aiService.configure`
- 返回值钉死为 `snapshotAIRequestConfig({ name: selected.providerId, apiKey, model: selected.model, baseUrl: selected.baseUrl || BASE_URLS[selected.providerId] })`；不得继续返回 `{ ...selected, apiKey }`
- 每一次 `aiService.chat`（生成方向 / 总纲 / 分卷 / 章纲，共 4 处）第一参用该返回值；去掉 options 里的 `model: aiConfig.model`

改完搜索：

```bash
rg -n 'aiService\.configure' src
rg "configureFirstAi" src
rg -n 'aiService\.(chat|chatStream)\(' src/renderer
```

Expected: 第一条无匹配；第二条无匹配（已改名）；第三条 14 处第一参都是 config。

- [ ] **Step 9: 本片全量测试 + 主进程编译 + Renderer 打包**

Run: `npm run test` 然后 `npm run build:main` 然后 `npm run build:renderer`

Expected: 全量 PASS；`build:main` 与 Renderer 打包通过。Vite 不是 Renderer 类型门禁，reviewer 必须逐项核对 14 个调用点的参数顺序、Hook 依赖与配置来源。

- [ ] **Step 10: Commit（仅独立 worktree 且已授权任务级提交）**

```powershell
git add src/renderer/services/ai/request-config.ts tests/unit/ai-request-config.test.ts src/renderer/services/ai.service.ts tests/unit/ai-stream-cancel.test.ts src/renderer/components/AIChatPanel.tsx src/renderer/components/AIWritePanel.tsx src/renderer/components/AIReviewPanel.tsx src/renderer/components/AIPolishPanel.tsx src/renderer/components/ContextPanel.tsx src/renderer/components/NameGenerator.tsx src/renderer/components/PlanningWorkspace.tsx
git add src/main/ipc/ai.ipc.ts src/main/ai/stream-project-id.ts tests/unit/stream-project-id.test.ts
git commit -m "fix: AI 请求改为调用瞬间 Provider 快照，去掉全局 configure" -m "面板不再串供应商；chatStream 在同步外壳里拷贝配置，写章/抽取模型写入当次 config.model。"
```

未授权则跳过。不要 add `dist/`。

---

### Task 2: Planning committed 原子片（loader + 写入预留 + 导入刷新）

**Files:**
- Modify: `src/renderer/services/planning-loader.ts`
- Modify: `tests/unit/planning-loader.test.ts`
- Create: `src/renderer/services/planning-write-epoch.ts`
- Create: `tests/unit/planning-write-epoch.test.ts`
- Create: `src/renderer/services/planning-persistence.ts`
- Create: `tests/unit/planning-persistence.test.ts`
- Modify: `src/renderer/components/PlanningWorkspace.tsx`
- Modify: `src/renderer/components/ObsidianImportPanel.tsx`
- Modify: `tests/ui/obsidian-import.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `AGENTS.md` — 实施完后只追加一条精简架构约束

**Interfaces:**
- Consumes: Task 1 的 `aiService.chat(config, ...)`，不得改回全局 configure。
- Produces: `createPlanningLoader(...).applyCommitted(projectId, planning)`，先作废在途 load 再应用 canonical 值。
- Produces: `capturePlanningWriteEpoch` / `reservePlanningWrite` / `isPlanningWriteCurrent`。
- Produces: `PersistPlanningOutcome = saved | superseded | failed`，不用 `null` 混表三种语义。
- `PlanningWorkspace` 必收 `onPlanningCommitted(projectId, planning: PlanningIdea | null)` 与 `onReloadPlanningCommitted(projectId): Promise<boolean>`。

- [ ] **Step 1: 先用 loader 测试锁定失败/null/committed 竞态**

保留成功与 A→B 迟到回执用例，把「读失败 onApply(null)」改为：`load()` 返回 `failed`、`onApply` 0 次、`onError` 1 次。再补：

```ts
it('成功且 data=null 是合法空策划', async () => {
  let applied: PlanningIdea | null | undefined = mkPlanning();
  const loader = createPlanningLoader({
    invoke: async () => ({ success: true, data: null }),
    onApply: (_pid, planning) => { applied = planning; },
    isProjectCurrent: () => true,
  });
  expect(await loader.load('p1')).toBe('applied');
  expect(applied).toBeNull();
});

it('applyCommitted 作废旧 load，迟到回执不得覆盖新保存', async () => {
  let resolve!: (value: unknown) => void;
  let applied: PlanningIdea | null = null;
  const loader = createPlanningLoader({
    invoke: () => new Promise(r => { resolve = r; }),
    onApply: (_pid, planning) => { applied = planning; },
    isProjectCurrent: () => true,
  });
  const oldLoad = loader.load('p1');
  const committed = { ...mkPlanning(), idea: '新保存' };
  expect(loader.applyCommitted('p1', committed)).toBe(true);
  resolve({ success: true, data: { ...mkPlanning(), idea: '旧加载' } });
  expect(await oldLoad).toBe('stale');
  expect(applied?.idea).toBe('新保存');
});
```

定向测 `tests/unit/planning-loader.test.ts` 先确认旧实现 FAIL。

- [ ] **Step 2: 实现 loader 的三态语义与 `applyCommitted`**

`success:false` / catch 只调 `onError`，不 `onApply`；`success:true,data:null` 仍 `onApply(null)` 并返回 `applied`。新方法：

```ts
applyCommitted: (projectId: string, planning: PlanningIdea | null): boolean => {
  if (options.isProjectCurrent && !options.isProjectCurrent(projectId)) return false;
  generation += 1;
  currentProjectId = projectId;
  options.onApply(projectId, planning);
  return true;
},
```

这一次 `generation += 1` 是防「旧 load 覆盖新 save」的必要条件，不得在 App 里直接 `setPlanningSnapshot` 绕过 loader。定向测必须 PASS。

- [ ] **Step 3: 先测试、再实现同步 reserve**

`reservePlanningWrite(projectId, expectedEpoch?)` 必须在同一同步调用里完成「比较 + 递增」：

```ts
const epochs = new Map<string, number>();

export function capturePlanningWriteEpoch(projectId: string): number {
  return epochs.get(projectId) ?? 0;
}

export function reservePlanningWrite(projectId: string, expectedEpoch?: number): number | null {
  const current = capturePlanningWriteEpoch(projectId);
  if (expectedEpoch !== undefined && current !== expectedEpoch) return null;
  const token = current + 1;
  epochs.set(projectId, token);
  return token;
}

export function isPlanningWriteCurrent(projectId: string, token: number): boolean {
  return capturePlanningWriteEpoch(projectId) === token;
}
```

失败不回滚 token，否则会让已过期 AI 结果复活。测试必须覆盖：A 的 reserve 不影响 B；两个相同 captured epoch 只有第一个能 reserve；用户保存尚未返回时旧 AI 已失效；新 reserve 后旧 token 不得更新 UI。不做 JSON fingerprint，不加 DB revision。

- [ ] **Step 4: 把 save IPC 抽成可测试的 planning persistence**

`planning-persistence.ts` 使用 `IpcResult<PlanningIdea>`，在 invoke **前** reserve：

```ts
export type PersistPlanningOutcome =
  | { kind: 'saved'; planning: PlanningIdea; token: number }
  | { kind: 'superseded' }
  | { kind: 'failed'; error: string; token: number };
```

- 普通保存不传 expected，无条件 reserve。
- AI 长任务传启动时 captured epoch，reserve 失败返回 `superseded`，**不发 IPC**。
- IPC `success:false`、reject 或 `success:true` 却缺 `data` 返回 `failed`；不回滚 token。
- 只有 `kind:'saved'` 且 `isPlanningWriteCurrent(projectId, token)` 的回执才允许更新本地/App。若较新写失败，只 guarded reload App committed，策划页草稿保留并显示错误。

`planning-persistence.test.ts` 用受控 Promise 证明：旧 AI 在用户 save 已 reserve 但 IPC 未回时直接 `superseded`；两个旧 AI 只一个发 IPC；缺 `res.data` 是 failed；迟到 saved token 已非 current。

- [ ] **Step 5: PlanningWorkspace 只在 canonical save 成功后应用 UI**

1. 抽 `applyPlanningSnapshot(planning: PlanningIdea | null)`，一次更新 idea / requirements / options / selected / 三层纲 / 全部 status；null 清成空策划。
2. 内部 `loadPlanning` 区分 `success:true,data:null` 与失败；null 为成功且不得让仅人物/世界观导入卡在 refreshPending。
3. `save()` 和后台 persist 都用 `planning-persistence`，不得再直接 invoke。成功且 token 当前后，还必须先校验 `currentProjectIdRef.current === projectId`；非当前项目只保留落库结果，不更新本地 UI/App。仅当前项目才：先用 `projectLoadGuardRef.current.select(projectId)` 作废策划页在途 load，再 `applyPlanningSnapshot(res.data)`，最后 `onPlanningCommitted(projectId, res.data)`。
4. 四个长任务在 `await loadFirstAiConfig()` 前捕获 **startedId 的 epoch**。AI 返回后先构造完整 payload，再条件 reserve + persist；在 saved/current 之前不得先 `setOptions/setMasterOutline/setVolumeOutlines/setChapterOutlines`。
5. `superseded` 且已切回原项目时显示「策划已在生成期间被更新，本次 AI 结果未写入，以免覆盖较新保存」。failed 显示真实错误，不把未提交 AI 结果留在本地 state；若该 failed token 仍当前且项目仍当前，必须 `await onReloadPlanningCommitted(projectId)` 对齐 App committed，同时保留策划页草稿与错误提示。
6. 后台写回非当前项目：可写库，不 setState、不更新当前 App；重新进入项目时由 loader 读库。

- [ ] **Step 6: Obsidian 导入在 commit 前作废旧 AI，成功后双重 guarded reload**

`ObsidianImportPanel` 新增必填 prop `onPlanningCommitStarted(projectId)`。组出 `ObsidianCommitInput` 后，若 selections 的 slots 含 `master|volume|chapter|stage` 或任一 layer action 非 `keep`，则在 `guard.commit(input)` **前**同步调该回调。回调内执行无条件 `reservePlanningWrite(projectId)`，导入失败也不回滚。这样即使 commit 已写库后用户切项目、guard 丢弃 summary，旧 AI 也已失效。

`PlanningWorkspace.onImported` 仍只重试刷新、不重复 commit，但必须同时 await：

- 策划页自身 `loadPlanning(projectId)`；
- App 传入的 `onReloadPlanningCommitted(projectId)`；
- 现有 `onRefreshImportedEntities(projectId)`。

任一失败都抛「导入已写入，界面刷新失败」，面板留在 refreshPending。UI 测试增加：reserve 发生在 commit invoke 之前；导入后 App committed 刷新被 await；其失败时只重试刷新、commit 仍只一次。

- [ ] **Step 7: App 只通过 loader 接收 committed**

新增 `planningLoadError` state。`planningLoader.onApply` 成功时同时 `setPlanningSnapshot({ projectId, planning })` 与 `setPlanningLoadError(null)`；`onError` 只记当前项目错误并 `console.error`，不清快照。切项目时清旧 error，成功 load/commit 时清 error。接线：

```tsx
<PlanningWorkspace
  project={activeProject}
  onStartChapter={handleStartPlannedChapter}
  onRefreshImportedEntities={refreshImportedEntities}
  onPlanningCommitted={(projectId, planning) => {
    planningLoader.applyCommitted(projectId, planning);
  }}
  onReloadPlanningCommitted={async projectId => (
    await planningLoader.load(projectId)
  ) === 'applied'}
/>
```

切项目仍先清旧项目 snapshot/error 再 load。同项目 load 失败保留已有 committed。AI 上下文只读 `planningSnapshot`，不把 textarea 草稿或 PlanningWorkspace 局部 state 抬进 App。

- [ ] **Step 8: 本片验收**

Run: 定向测 `tests/unit/planning-loader.test.ts` `tests/unit/planning-write-epoch.test.ts` `tests/unit/planning-persistence.test.ts`，再 `npm run test`、`npm run build:main`、`npm run build:renderer`。

Expected: 全部 PASS。reviewer 额外核对：旧 load 不覆盖 save 返回值；两路同 epoch 只一路发 IPC；过期/失败 AI 不污染本地策划；A→B→A 只应用当前代次；合法空策划可刷新；导入 commit 前已 reserve。

手测：未保存草稿不进对话；保存后对话立即读新纲；同项目 load 失败不丢快照；生成期间保存或导入后旧 AI 不覆盖；导入后对话立即读新 committed。

- [ ] **Step 9: Commit（仅独立 worktree 且已授权）**

```powershell
git add src/renderer/services/planning-loader.ts tests/unit/planning-loader.test.ts src/renderer/services/planning-write-epoch.ts tests/unit/planning-write-epoch.test.ts src/renderer/services/planning-persistence.ts tests/unit/planning-persistence.test.ts src/renderer/components/PlanningWorkspace.tsx src/renderer/components/ObsidianImportPanel.tsx tests/ui/obsidian-import.tsx src/renderer/App.tsx AGENTS.md
git commit -m "fix: 策划 committed 快照用保存返回值更新，写入前预留代数" -m "旧 loader 与旧 AI 不再覆盖较新写入；Obsidian 导入仍走 guarded reload。"
```

---

### Task 3: Preview 安全片（分段文本节点）

**Files:**
- Create: `src/renderer/services/ai/generated-preview.ts`
- Create: `tests/unit/generated-preview.test.ts`
- Modify: `src/renderer/components/AIWritePanel.tsx` 约 1078–1088 行

**Interfaces:**
- Produces: `splitGeneratedPreviewBlocks(html: string): GeneratedPreviewBlock[]`
- `GeneratedPreviewBlock = { kind: 'paragraph' | 'fallback'; text: string }`
- 保存路径仍传原始 `generatedContent`（`handleSave` 约 745 行不要改成纯文本）

不要引入 Markdown 组件。不要改 `AIReviewPanel` / `AIPolishPanel`。不要改 `WRITE_SYSTEM_PROMPT`。

- [ ] **Step 1: 写切段失败测试**

```ts
import { describe, it, expect } from 'vitest';
import { splitGeneratedPreviewBlocks } from '../../src/renderer/services/ai/generated-preview';

describe('splitGeneratedPreviewBlocks', () => {
  it('多段 p 抽出文本节点，解码常见实体', () => {
    const html = '<p>第一段&lt;秘&gt;</p><p>第二段&amp;续</p>';
    expect(splitGeneratedPreviewBlocks(html)).toEqual([
      { kind: 'paragraph', text: '第一段<秘>' },
      { kind: 'paragraph', text: '第二段&续' },
    ]);
  });

  it('无 p 标签时整份 fallback，不把 a<b 当标签吃掉', () => {
    expect(splitGeneratedPreviewBlocks('a<b>c')).toEqual([
      { kind: 'fallback', text: 'a<b>c' },
    ]);
  });

  it('空字符串得到空数组', () => {
    expect(splitGeneratedPreviewBlocks('')).toEqual([]);
  });

  it('流式未闭合 p 尾段也立即显示', () => {
    expect(splitGeneratedPreviewBlocks('<p>第一段</p><p>第二段正在生成')).toEqual([
      { kind: 'paragraph', text: '第一段' },
      { kind: 'paragraph', text: '第二段正在生成' },
    ]);
  });

  it('p 外的前缀和尾随不得静默丢失', () => {
    expect(splitGeneratedPreviewBlocks('前言<p>正文</p>尾声')).toEqual([
      { kind: 'fallback', text: '前言' },
      { kind: 'paragraph', text: '正文' },
      { kind: 'fallback', text: '尾声' },
    ]);
    expect(splitGeneratedPreviewBlocks('<p>一</p>间隙<p>二')).toEqual([
      { kind: 'paragraph', text: '一' },
      { kind: 'fallback', text: '间隙<p>二' },
    ]);
  });

  it('段内 br 转换换行，其他标签不作为 markup 输出', () => {
    expect(splitGeneratedPreviewBlocks('<p><strong>正文</strong><br>续&amp;下</p>')).toEqual([
      { kind: 'paragraph', text: '正文\n续&下' },
    ]);
    expect(splitGeneratedPreviewBlocks('<p><img src=x onerror=alert(1)>正文</p>')).toEqual([
      { kind: 'paragraph', text: '正文' },
    ]);
  });
});
```

- [ ] **Step 2: 定向测确认失败**

Run: 定向测 `tests/unit/generated-preview.test.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现切段**

完整 `<p>...</p>` 渲染为 paragraph，流式尾部的未闭合 `<p>...` 也要立即渲染为 paragraph。段内 `<br>` 先换成换行，再去掉剩余标签并解码 `&lt; &gt; &amp; &quot; &#39; &nbsp;`。任何不在完整/未闭合 p 里的非空 prefix/gap/tail 必须按原顺序进 `fallback`，不得因已匹配一个 p 而静默丢失。**不要**对整份字符串跑 `htmlToPlainText` 的 `/<[^>]+>/g`（那会把 fallback 的 `a<b>c` 吃成 `ac`）。

```ts
export type GeneratedPreviewBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'fallback'; text: string };

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function stripTags(html: string): string {
  return decodeEntities(
    html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''),
  );
}

export function splitGeneratedPreviewBlocks(html: string): GeneratedPreviewBlock[] {
  if (!html) return [];
  const blocks: GeneratedPreviewBlock[] = [];
  const re = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const gap = html.slice(cursor, match.index);
    if (gap.trim()) blocks.push({ kind: 'fallback', text: decodeEntities(gap) });
    blocks.push({ kind: 'paragraph', text: stripTags(match[1]) });
    cursor = re.lastIndex;
  }
  const tail = html.slice(cursor);
  const openParagraph = tail.match(/^\s*<p\b[^>]*>([\s\S]*)$/i);
  if (openParagraph) {
    blocks.push({ kind: 'paragraph', text: stripTags(openParagraph[1]) });
  } else if (tail.trim()) {
    blocks.push({ kind: 'fallback', text: decodeEntities(tail) });
  }
  return blocks;
}
```

- [ ] **Step 4: 定向测通过后改预览 JSX**

```tsx
{generating && !generatedContent ? (
  <span className="text-gray-500 italic">正在创作...</span>
) : (
  <GeneratedContentPreview content={generatedContent} />
)}
```

同文件内小组件（或直接内联）：

```tsx
function GeneratedContentPreview({ content }: { content: string }) {
  const blocks = splitGeneratedPreviewBlocks(content);
  if (blocks.length === 0) {
    return <span className="text-gray-500 italic">等待生成...</span>;
  }
  if (blocks.length === 1 && blocks[0].kind === 'fallback') {
    return (
      <pre className="whitespace-pre-wrap font-sans text-xs text-gray-200 leading-relaxed m-0">
        {blocks[0].text}
      </pre>
    );
  }
  return (
    <div className="space-y-2 text-xs text-gray-200 leading-relaxed">
      {blocks.map((block, index) => block.kind === 'paragraph' ? (
        <p key={index} className="m-0 whitespace-pre-wrap">{block.text}</p>
      ) : (
        <pre key={index} className="m-0 whitespace-pre-wrap font-sans">{block.text}</pre>
      ))}
    </div>
  );
}
```

零 `dangerouslySetInnerHTML`。`handleSave` 仍 `onSaveAsChapter(..., generatedContent)`。

```powershell
rg -n 'dangerouslySetInnerHTML' src
```

Expected: 无匹配。

- [ ] **Step 5: 本片测试**

Run: `npm run test` 然后 `npm run build:renderer`

Expected: 测试 PASS，Renderer 打包通过。

- [ ] **Step 6: Commit（仅独立 worktree 且已授权）**

```powershell
git add src/renderer/services/ai/generated-preview.ts tests/unit/generated-preview.test.ts src/renderer/components/AIWritePanel.tsx
git commit -m "fix: 写章预览改为分段文本节点，去掉 innerHTML" -m "章节仍保存模型输出的 HTML；预览不再注入 markup。"
```

---

### Task 4: 整分支最终门

不是第四个功能片。三片都合并进 worktree 之后再跑。不要在 Task 1/2 结束时跑三个 UI runner。

- [ ] **Step 1: 命令**

```powershell
function Invoke-Checked([string]$Label, [scriptblock]$Command) {
  & $Command
  if ($LASTEXITCODE -ne 0) { throw "$Label 失败，exit=$LASTEXITCODE" }
}

Invoke-Checked '全量测试' { npm run test }
Invoke-Checked '主进程编译' { npm run build:main }
Invoke-Checked 'Renderer 打包' { npm run build:renderer }
Invoke-Checked '写作工作区 UI 回归' { node tests/ui/run-writing-workspace.cjs }
Invoke-Checked 'Obsidian 导入 UI 回归' { node tests/ui/run-obsidian-import.cjs }
Invoke-Checked '决策账本 UI 回归' { node tests/ui/run-creative-decision-ledger.cjs }

function Assert-NoRgMatch([string]$Pattern, [string]$Path) {
  $matches = rg -n $Pattern $Path
  if ($LASTEXITCODE -eq 0) { $matches; throw "仍存在禁止匹配：$Pattern" }
  if ($LASTEXITCODE -ne 1) { throw "rg 执行失败：$Pattern" }
}
Assert-NoRgMatch 'aiService\.configure' 'src'
Assert-NoRgMatch 'dangerouslySetInnerHTML' 'src'
Assert-NoRgMatch 'invalidateCache' 'src/renderer'

$sddPath = git rev-parse --git-path sdd
$baseCommit = (Get-Content -Raw (Join-Path $sddPath 'base-commit.txt')).Trim()
Invoke-Checked 'diff 空白错误检查' { git diff --check "$baseCommit..HEAD" }
git diff --name-only "$baseCommit..HEAD"
git status --short
```

Expected：全量测试过；`build:main` 与 Renderer 打包过；三条 rg 退出码必须是 **1**（无匹配），不得把 `>=2` 的命令错误当成通过（TipTap `configure` 允许；main 里 `invalidateCache` 定义可保留）。三个 UI runner 按原退出码通过，`git diff --check` 无错，变更文件只在计划范围。

- [ ] **Step 2: 整分支审查**

用执行前 merge base 到 HEAD 的完整 diff package 派 fresh final reviewer。要求同时给出规格符合性和代码质量结论，专门复核 14 个 AI 调用点、Planning 竞态、Obsidian commit 前 reserve、预览内容不丢失以及本计划的 Minor ledger。有 Critical/Important 时只派一个 fixer 统一修复，重跑覆盖测试后复审。

外部供应商烟测不在本门；需要用户另授。

- [ ] **Step 3: 交接，默认不合并、不 push**

不要把 `dist/`、报告 md、`.claude/settings.local.json` 加进去。说明写清：请求级 Provider 快照、策划 committed 与 reserve token、写章预览分段文本节点。只有用户明确选择集成后才检查目标 checkout 当前状态并合入；目标 checkout 有未提交改动时不得强行 merge。合入后必须在**集成态**重跑 Step 1 最终门，worktree 内通过不代表与用户未提交改动组合后仍通过。

---

## 自检

| 合同条款 | 对应任务 |
|---|---|
| 7 个 configure 清零 + 14 处 chat/chatStream 带快照 | Task 1 |
| chatStream 同步外壳、projectId 必填 | Task 1 Step 5–6 |
| writeModel/summaryModel 进当次 config.model | Task 1 Step 8 写章补 B |
| 渲染端删除 ChatCallOptions.model；主进程保留 | Task 1 Step 5 |
| name = Factory 标识 | Task 1 Step 3 / 8 |
| 不整表 invalidateCache | Task 1 |
| loader 空策划 vs 失败 | Task 2 Step 1–3 |
| onPlanningCommitted(res.data)；旧 loader 不覆盖 | Task 2 Step 1–2 / 5 / 7 |
| per-project reserve 在 IPC 前原子「比较 + 递增」 | Task 2 Step 3–5 |
| 导入 commit 前 reserve；导入后 App guarded reload | Task 2 Step 6–7 |
| 分段文本节点预览；流式尾段不丢；保存仍 HTML | Task 3 |
| 三个 UI runner + 两端构建 + 整分支审查 | Task 4 |
| 无迁移 / 无 Assembler / 无 as-of / 无 P1 Spec | 全局约束 |
