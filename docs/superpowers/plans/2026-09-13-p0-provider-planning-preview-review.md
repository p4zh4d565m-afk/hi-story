# P0 实施计划独立审查意见（2026-09-13）

> **审查对象：**
> - 当前合同：`docs/superpowers/specs/2026-09-13-ai-production-current-contract.md`
> - P0 计划：`docs/superpowers/plans/2026-09-13-p0-provider-planning-preview.md`
> - 冻结档案：`docs/superpowers/plans/2026-09-13-ai-long-novel-production-architecture-plan.md`（只作讨论依据，不再追加）
>
> **性质：** 本文是第三位开发者的独立审查，不自行扩大 P0，也不授权 P1。下面“必须修正”项并入 P0 计划后，P0 才适合按代理工作流开工。
>
> **第二人核对（2026-09-13）：** 见第七节。前六节对照 HEAD 基本成立。第七节默认值已并入短计划与合同（见 7.8）。P1 仍未授权、不创建 Spec、不写迁移。
>
> **施工进度（2026-09-13 晚）：** `docs/superpowers/plans/2026-09-13-p0-status.md`。第八节只核对 Task 1；Planning/Preview 未完成，不要把第八节当成整分支绿灯。

## 一、结论

- **当前合同可用。** P0 三件边界清楚，无数据库迁移；P1 未授权、不得顺手创建叙事时间 Spec 或迁移，这个决定正确。
- **P0 技术方案可行，但计划需先修。** Provider、PlanningSnapshot、文本预览三条路径都能在现有架构内完成，不需要重写 Main 或数据库。
- **不建议按现有 7 个 Task 原样执行。** Task 2 改服务签名、Task 3 才修调用方，中间必然留下不可运行状态；测试命令和并发回归也不完整。
- **执行方式推荐 Subagent-Driven，但必须是“独立 worktree + 顺序实施 + 每片审查”，不能让多个实现代理并行修改同一批文件。** 若用户不授权分支内提交，才改用 Inline Execution。

## 二、开工前必须修正

### 1. 把 7 个 Task 重组为 3 个可独立验收的实施片

当前 Task 2 删除旧 `aiService` 签名后，7 个组件仍使用旧调用方式；直到 Task 3 完成前，分支处于断裂状态。这不符合“每个任务完成后可测试、可审查”的要求，也不适合 fresh subagent 交接。

建议重组：

1. **Provider 原子片：** `snapshotAIRequestConfig`、`ai.service.ts`、7 个组件的 14 个 `chat/chatStream` 调用、现有流取消测试与并发快照测试一次完成。
2. **Planning committed 片：** loader 成功/失败语义、App committed 镜像、PlanningWorkspace 保存/导入通知、迟到写回门禁一次完成。
3. **Preview 安全片：** AIWritePanel 文本节点、无 HTML sink 验收一次完成。

最后只设一个全量验收与整分支审查，不把“总验收”当成第四个实现任务。

### 2. `chatStream` 的“调用瞬间快照”必须处理 async generator 延迟执行

若仍把 `snapshotAIRequestConfig(inputConfig)` 写在 `async *chatStream()` 函数体内，这段代码要到第一次 `.next()` / `for await` 才执行，不是调用表达式发生时执行。调用者在取得 generator 后修改原 config，仍可能污染请求。

建议合同实现为同步外壳捕获快照，再返回内部 generator：

```ts
chatStream(
  inputConfig: ProviderConfig,
  messages: ChatMessage[],
  options: ChatCallOptions | undefined,
  projectId: string,
): AsyncGenerator<string> {
  const config = snapshotAIRequestConfig(inputConfig);
  return this.runChatStream(config, messages, options, projectId);
}

private async *runChatStream(
  config: ProviderConfig,
  messages: ChatMessage[],
  options: ChatCallOptions | undefined,
  projectId: string,
): AsyncGenerator<string> {
  // 现有队列桥接逻辑
}
```

同时把 `projectId` 改为必填。Main 已拒绝空 projectId，Renderer 接口继续写成可选只会把错误推迟到运行时。

必须补回归：

- 创建 A/B 两个不同 ProviderConfig 的重叠流，断言两次 `ai:chatStream` 分别收到 A/B，不串配置。
- 调用 `chatStream(config, ...)` 后、消费 generator 前修改原 config，断言 IPC 仍收到调用时快照。
- 现有 cancel / ignore / 最后 token drain 五项测试按新签名完整改写，不保留“若 mock 旧签名再改”这类开放描述。

### 3. Planning 的迟到 AI 结果仍可能覆盖新保存内容

P0 计划修了 loader 失败清空，也让 App 重新加载 committed 快照；但没有把冻结档案 17.8 已确认的“长任务写库前门禁”带进短计划。

现有 `shouldApplyPlanningResult` 只检查项目 id。同一个项目里，作者可以在 AI 长任务运行时继续编辑并保存；旧任务完成后仍可能把启动时的 idea/requirements/下游纲写回数据库，覆盖较新的成功保存。

P0 至少需要：

- 长任务启动时捕获 `projectId + draftFingerprint/operationEpoch`。
- 在调用 `db:planning:save` **之前**再次比较当前草稿；不一致则禁止旧结果落库并显示明确提示。
- 项目切换后的后台写回是否继续保留，必须与同项目新保存门禁同时测试；不能只在写库后拒绝 `setState`。
- 覆盖“同项目保存后旧生成回执”和“A→B→A 后旧回执”两个回归。

这不需要数据库 revision，也不扩大到 P1。

### 4. committed 更新不能只靠 `void planningLoader.load(id)`

计划中的 `onPlanningPersisted?: (projectId: string) => void` 与 App 的 `void planningLoader.load(id)` 是最终一致，不是“保存成功后立即得到新 committed”。用户在 reload 完成前打开 AI，仍可能读到旧快照。

当前 `db:planning:save` 已返回完整 `PlanningIdea`。建议优先采用：

```ts
onPlanningCommitted?: (
  projectId: string,
  planning: PlanningIdea,
) => void | Promise<void>;
```

- 普通保存成功：使用 IPC 返回的完整记录立即更新 App committed 镜像，并校验 active project。
- Obsidian 导入：因 commit IPC 返回的是 summary，仍走 guarded reload；刷新成功后才替换 committed。
- 后台写回非当前项目：App 不应用到当前界面，重新进入项目时再加载。
- 若团队坚持 reload 方案，则回调必须返回 Promise 并被保存流程 await；reload 期间所有 AI 入口要明确使用旧 committed 或禁用，不能静默声称已经刷新。

P0 应把 App 中的值命名为“AI 权威 committed 镜像”。PlanningWorkspace 仍拥有 editing draft，因此本轮不是完整 PlanningSession，也不应宣称已经消灭所有策划双状态。

### 5. 预览内容与实际保存内容必须一致

React 文本节点本身会转义 HTML，不需要为了防 XSS 先调用 `htmlToPlainText`。当前计划预览 `htmlToPlainText(generatedContent)`，保存却仍保存原始 `generatedContent`；模型输出标签或尖括号文本时，用户看到的预览与实际写入正文不同。

P0 推荐直接：

```tsx
<pre className="whitespace-pre-wrap font-sans text-xs text-gray-200 leading-relaxed m-0">
  {generatedContent || '等待生成...'}
</pre>
```

若产品坚持预览纯文本，则必须先生成一个确定性的 `contentToSave`，预览和保存使用同一值；不能只清洗预览。

## 三、测试与计划文字需要校正

### 1. 当前“定向测试”命令实际会运行全量测试

`scripts/run-tests.js` 固定执行 `vitest.mjs run`，没有转发 `process.argv.slice(2)`。因此：

```bash
npm run test -- tests/unit/planning-loader.test.ts
```

不会只跑该文件。计划应二选一：

- 所有这些命令明确写成 `npm run test`，承认每次是全量；或
- 单独给出 Windows/Electron Node 模式的定向 Vitest 命令，并在 `finally`/命令结束后恢复 `ELECTRON_RUN_AS_NODE`。

不要继续把全量命令描述成单测定向执行。

### 2. Task 1 的 baseUrl 测试没有真正锁定行为

以下断言同时接受 `undefined` 和空字符串，不符合“测试锁一种”的文字：

```ts
expect(snap.baseUrl === undefined || snap.baseUrl === '').toBe(true);
```

现有 `ProviderConfig.baseUrl` 是可选字段，建议锁定为：

```ts
expect(snap.baseUrl).toBeUndefined();
```

### 3. Vite build 不能证明 Renderer 调用签名正确

`npx vite build` 只转译，不做 TypeScript 类型检查；当前根 `tsconfig.json` 也没有 JSX 配置，直接 `npx tsc --noEmit` 会产生大量既有错误。本 P0 又明确不做全量 Renderer tsc，所以质量门必须由下面三层补足：

1. Provider 服务级单测覆盖参数顺序、配置快照、并发流与取消。
2. 逐个核对 7 个文件内共 14 个 `aiService.chat/chatStream` 调用；`rg "aiService\\.(chat|chatStream)" src/renderer` 的结果应作为审查清单，而不是只搜索 configure。
3. 由独立 reviewer 阅读完整 diff，不能只凭 Vite 通过宣布正确。

### 4. P0 总验收应补现有真实 UI 回归

建议最终命令至少包括：

```bash
npm run test
npm run build:main
npx vite build
node tests/ui/run-writing-workspace.cjs
node tests/ui/run-obsidian-import.cjs
node tests/ui/run-creative-decision-ledger.cjs
rg "aiService\.configure" src
rg "dangerouslySetInnerHTML" src
rg "invalidateCache" src/renderer
```

原因：P0 会同时触碰 AIChatPanel、AIWritePanel、PlanningWorkspace、Obsidian 导入刷新接线和流取消，只有 unit + Vite 覆盖不足。外部真实 Provider 烟测仍不自动执行，避免产生费用；若要做必须单独授权并选定配置。

## 四、执行方式意见

### 推荐：Subagent-Driven，但附带四个条件

我同意另一位开发者推荐第一种，原因不是“代理越多越快”，而是这个 P0 横跨 10 个左右文件，且 Renderer 没有可用的强制类型门禁；每个原子片做完立即进行规范审查和代码质量审查，价值很高。

必须满足：

1. **独立 worktree/分支。** 当前共享工作区已有其他未提交修改，不能让实现代理直接在同一 checkout 覆盖三位开发者的工作。
2. **实现代理顺序运行。** Provider、Planning、Preview 三片不要并行；它们都可能触碰 `AIWritePanel` 或共享服务。Subagent-Driven 指 fresh context + 每片 review，不代表三个实现代理同时写。
3. **允许任务级提交。** 该工作流依赖每片 commit 和 diff review；现计划写着“不提交 git，除非用户明确要求”。选择第一种时，用户需要明确授权“在独立 worktree 内按原子片提交，不 push”。
4. **指定唯一 P0 负责人。** 另外两位开发者在 P0 期间只做审查或不碰上述文件；若必须并行开发，先登记文件所有权与合并顺序。

推荐执行顺序：

```text
预检并修订短计划
  → Provider 原子片（实现 → 测试 → 双重审查）
  → Planning committed 原子片（实现 → 测试 → 双重审查）
  → Preview 安全片（实现 → 测试 → 双重审查）
  → 全量 UI 回归
  → 整分支最终审查
  → 用户决定是否合并
```

### 何时选择 Inline Execution

只有以下情况我会改选第二种：

- 用户暂时不允许创建分支/任务级 commit；
- 另外两位开发者正在同一批文件上工作，短期无法划分所有权；
- 只想先做 Preview 这一处单文件安全修复，而不是完成整个 P0。

Inline 仍需按三个原子片设检查点，不能连续改完全部文件后才第一次 review。

## 五、需要三位开发者确认的最小清单

- [ ] 是否把 Provider Task 1～3 合并为一个原子实施片？建议是。
- [ ] 是否把 `chatStream` 改成同步外壳捕获配置，并令 `projectId` 必填？建议是。
- [ ] 是否把同项目旧 AI 结果的写库前 epoch/fingerprint 门禁补回 P0？建议是。
- [ ] committed 普通保存是否直接使用 save IPC 返回值更新 App，而不是 fire-and-forget reload？建议是；Obsidian 导入继续 guarded reload。
- [ ] 预览是否直接显示并保存同一份 `generatedContent` 文本？建议是。
- [ ] 是否修正测试命令，并把三个现有 UI runner 纳入总验收？建议是。
- [ ] 是否采用 Subagent-Driven，允许在独立 worktree 内任务级 commit、禁止 push，三个实现片顺序执行？建议是。

在以上问题确认前，可以继续审查和修订 P0 计划，但不建议启动实现代理。P1 继续保持未授权。

---

## 六、第四人补充核对（2026-09-13）

> **读法：** 对照 2026-09-13 HEAD 代码，核上面这份 review 本身 + 计划 + 合同。前五节方向都对，下面只补「review 没点透、或 review 提了但计划和合同还没采纳」的点，不推翻结论。

### 1. 预览与保存有一个 review 第 5 条没点透的两难

review 第 5 条说「直接 `<pre>{generatedContent}</pre>`，不用 `htmlToPlainText`」。但写章模型被**强制输出 HTML**（`ai-prompts/write.ts:252`：『使用 HTML 段落标签 `<p>...</p>` 包裹每个自然段』），`generatedContent` 是 `<p>第一段</p><p>第二段</p>` 这样的 HTML 字符串，`handleSave`（`AIWritePanel.tsx:745`）也把这份 HTML **原文**存进章节。

于是三种做法各有代价，P0 合同 Task 6 选的 `htmlToPlainText` 也没交代清楚：

- **合同 Task 6 的 `htmlToPlainText(generatedContent)`**：预览变纯文本，但 `htmlToPlainText` 的 `/<[^>]+>/g`（`utils.ts:28`）会把正文里「形似标签」的文本误删（例如正文写 `a<b>c`），且预览（纯文本）与保存（HTML 原文）存储不一致——这正是 review 第 5 条指出的，但它的根因是「模型本来就输出 HTML」。
- **review 第 5 条的 `<pre>{generatedContent}</pre>`**：React 文本节点会转义，但用户会看到 `<p>第一段</p>` 的**原始标签**，体验崩。review 这条成立的前提「generatedContent 是纯文本」不成立。

**建议 P0 明确渲染策略为「逐段文本节点」**：把 generatedContent 按 `<p>` / 换行切段，每段渲染成 `<p>{段文本}</p>`（或 `<pre>` + `whitespace-pre-wrap` 保留 `htmlToPlainText` 产生的换行），**整段 zero innerHTML**。这样既不 XSS、又保留段落语义、也不显示原始标签。三条路（htmlToPlainText 整段、文本节点直显、逐段文本节点）必须在合同里钉死一条，否则执行者会在这卡住。

### 2. 「单一 model 真相」在主进程没做干净

合同第 15 行写「删除 `ChatOptions.model` 第二层覆盖」，但只删了**渲染端**。主进程 Provider 仍读 `options?.model || this.defaultModel`（`generic-openai.ts:49/75`、`claude.ts:44/81`），而 `src/main/ai/provider.ts:46` 的 `ChatOptions.model` 也没删。

渲染端不传后 `options?.model` 恒为 undefined、永远回退到 `this.defaultModel`（= `config.model`），所以是「安全但遗留的隐藏覆盖点」——它没有 bug，但「model 只来自 config 一处」这个真相没有真正确立。P0 要么顺手删掉主进程 Provider 的 `options?.model` 回退（把第二真相彻底移除），要么在合同里明确「主进程 `options.model` 保留为死代码、P0 不动」。现在合同只字未提主进程，属漏项。

### 3. `config.name` 的字段来源各面板不一致

现状 7 个 `configure` 调用点里，`name` 参数来源不统一：`AIChatPanel.tsx:393` 用 `activeProvider.name`，`AIWritePanel.tsx:377` 用 `active.providerId`，`NameGenerator.tsx:474` 用 `cfg.name || providerId`。当前预设里 `name === id`（`AIChatPanel.tsx:59-66`）所以值相同、不阻塞，但 P0 构造快照时应钉死 `snapshotAIRequestConfig` 的 `name` 语义 = **`ProviderPreset.name`（供应商标识，与主进程 `ProviderFactory` 的缓存键对齐）**，不要各面板各自决定，否则将来 `name` 和 `id` 一旦分歧就串供应商。

### 4. 计划 Task 5 与 review 第 4 条仍未收敛，且 persistPlanning 丢了返回值

review 第 4 条建议「committed 普通保存用 save IPC 返回值直接更新 App（`onPlanningCommitted(projectId, planning)`），Obsidian 导入才走 guarded reload」。但计划 Task 5 仍然写的是 `onPlanningPersisted(projectId)` + `void planningLoader.load(id)`（fire-and-forget reload），两条路没有合一。

且要采纳 review 第 4 条，得先改 `PlanningWorkspace.persistPlanning`（`PlanningWorkspace.tsx:179-184`）——它现在 `if(!res?.success) throw` 后直接 `return true`，把 `res.data`（完整 `PlanningIdea`）丢了。`db:planning:save` 确实返回完整记录（`planning.repo.ts:39`），但没人接。P0 动 committed 之前，计划和 review 必须选一条路：**要么 `onPlanningCommitted(projectId, res.data)`（推荐，立即一致），要么 `onPlanningPersisted` + reload（必须 await，reload 期间 AI 入口用旧 committed 并明确提示）**。现在两者并排，执行者会各取一段。

### 5. review 第 2 条（async generator 同步外壳）是对的，计划必须采纳而非可选

当前 `async *chatStream` 的 config 构造在函数体第一行（`ai.service.ts:79-84`），但 generator 函数体要等第一次 `.next()` / `for await` 才执行。调用者取得 generator 后、消费前改原 config，确实会污染请求。review 第 2 条给的「同步外壳捕获快照 + 内部 `runChatStream`」是正确且必要的修法，不能当成「可选建议」。计划 Task 2 目前只写了「`chatStream` 开头 `const config = snapshotAIRequestConfig(inputConfig)`」，没写同步外壳，照现在的文字写就会保留这个延迟快照 bug。

---

### 结论

前五节 + 本节五点合起来，P0 计划才够开工。仍需三位拍板的两条新分歧是：**① 预览渲染策略三条路选哪条（逐段文本节点最稳）**；**② committed 更新走 `onPlanningCommitted(返回值)` 还是 `onPlanningPersisted(reload)`**。其余三条（主进程 options.model、config.name 语义、同步外壳）属于「照抄计划会踩的坑」，建议直接并入计划，不必再辩论。P1 继续未授权。

---

## 七、第二人对审查稿的核对（2026-09-13）

> **读法：** 对照当前工作区 HEAD 核实第一～六节。方向接受。下面给出拍板默认值，并补审查仍偏宽、或会让执行者选错的点。冻结档案只更新落地指针，**不追加第二十一节**。P1 仍未授权。

### 7.1 总评

**不要按短计划原文的 7 个 Task 开工。** 合同范围（三件、无迁移）仍然对；计划结构、快照时点、committed 更新、预览策略、测试命令还没并进正文。当前正确动作是：**先改短计划，再派实现代理。**

已核对属实：

- `scripts/run-tests.js` 只跑 `vitest.mjs run`，不转发 argv；`npm run test -- some.test.ts` 仍是全量。
- `WRITE_SYSTEM_PROMPT` 要求 `<p>...</p>`；`AIWritePanel.handleSave` 把 `generatedContent` HTML 原文写入章节；约 1084 行仍是 `dangerouslySetInnerHTML`。
- `PlanningRepo.save` 返回完整记录；`persistPlanning`（`PlanningWorkspace.tsx` 约 179–181 行）成功后 `return true`，丢掉 `res.data`。
- `shouldApplyPlanningResult` 只比较两个 projectId。
- `planning-loader.ts` 注释写「失败保留上次快照」，`success: false` 却 `onApply(projectId, null)`；App 的 `onApply` 会立刻把 committed 写成 null。这是真实 bug，P0 必须修。
- `chatStream` 是 `async *`，config 在函数体第一行；第一次 `.next()` / `for await` 才执行。
- `aiService.configure` 仍有 7 处；`chat`/`chatStream` 去重后 14 处。
- `ChatOptions.model` 主进程仍在（`src/main/ai/provider.ts`），`generic-openai` / `claude` 仍 `options?.model || this.defaultModel`。

### 7.2 对必须修正项的表态

| 审查条款 | 代码核对 | 第二人态度 |
|---|---|---|
| 重组为 Provider / Planning / Preview 三片 | Task 2 改签名、Task 3 才改调用方，中间不可运行 | **接受。** 计划结构错误，不是口味。 |
| `chatStream` 同步外壳捕获快照 | `async *` 函数体延迟执行；现有取消测试也是先拿 generator 再 `setTimeout` | **必须写进计划。** `chat()` 是普通 async，入口即调用时，不必同样拆外壳。 |
| `projectId` 必填 | Main 已拒空字符串 | **只强制 `chatStream`。** `chat()` 非流、无取消表，可不强制。 |
| 同项目旧 AI 写库前门禁 | `shouldApplyPlanningResult` 只比 projectId | **要做。** 用内存 `writeEpochByProject: Map<projectId, number>`：用户成功 save / persist / 导入后 +1；长任务启动捕获 epoch；`db:planning:save` **之前**比较，不一致则禁止落库并提示。不要对整份纲做 JSON fingerprint（空白和键序会误伤）。**不加 DB revision。** |
| committed 用 save 返回值立刻更新 | `persistPlanning` 丢 `res.data` | **接受 `onPlanningCommitted(projectId, planning)`。** 否决 fire-and-forget `void load()`。导入仍 guarded reload。后台写回非当前项目：不应用到当前 UI。 |
| 预览直接 `<pre>{generatedContent}</pre>` | 写章 prompt 强制 HTML | **不接受第五节这条。** 用户会看到 `<p>` 标签。接受第六节：逐段文本节点。见 7.3。 |
| `npm run test -- file` 不是定向 | `run-tests.js` 属实 | **接受。** 片内写全量 `npm run test`，或写明 Electron Node 定向命令。 |
| baseUrl 测锁定 `undefined` | 计划实现缺省不写字段 | **接受 `toBeUndefined()`。** |
| Vite 不能当类型门禁 | AGENTS.md 已写明 | **接受。** 必须改写 `tests/unit/ai-stream-cancel.test.ts` 全套，不能写「若 mock 旧签名再改」。 |
| 总验收加三个 UI runner | Chat / Write / Planning / 导入都会碰到 | **整分支最终门，不是每片都跑。** 外部供应商烟测仍要单独授权。 |
| Subagent 顺序 + 独立 worktree + 任务级 commit 不 push | 共享工作区已有其它脏文件 | **接受。** 三片不要并行（都可能改 `AIWritePanel`）。共享 checkout 不写 P0。 |

### 7.3 预览策略：钉死「同一份 HTML，预览用文本节点分段」

P0 **继续把 HTML 字符串存进章节**（TipTap 吃 HTML）。预览不得 `dangerouslySetInnerHTML`，也不得只 `htmlToPlainText` 预览却保存原文。

计划应抄这段，不要再列三条路：

1. 用正则抽出 `<p>...</p>` 段内文本（decode 常见实体 `&lt; &gt; &amp; &quot; &#39; &nbsp;`），每段渲染 `<p>{text}</p>`。
2. 抽不出任何段时，整份 `generatedContent` 作为一个文本节点放进 `<pre className="whitespace-pre-wrap">`（标签可见，但诚实、无 XSS）。
3. 保存路径仍传原始 `generatedContent`。
4. 抽段纯函数单测：多段 `<p>`、无标签、正文含 `a<b` 形似标签时不得当 HTML 吃掉。

不要在 P0 改写章 prompt 去强制纯文本——那会改变落库格式，超出三件范围。

第五节清单「预览是否直接显示并保存同一份 `generatedContent` 文本」这条 **建议改勾为否**；保存仍是同一份 HTML，预览是分段文本节点。

### 7.4 主进程 `options.model`：P0 明确保留，不要顺手删

第六节说「要么删掉主进程回退，要么写明死代码」。第二人选择 **写明保留**：

- 渲染端不传 `ChatOptions.model`；写/抽模型只进 `ProviderConfig.model`。
- 主进程 `ChatOptions.model` 与 `options?.model || this.defaultModel` **本轮不动**。`GenericOpenAIProvider.embed` 仍走 `options?.model`。顺手删容易把 embedding 打坏。
- 合同「删除 ChatOptions.model 第二层覆盖」必须改成「删除**渲染端**第二层覆盖」。

### 7.5 `config.name` 钉死为供应商标识

接受第六节。`snapshotAIRequestConfig` 的 `name` = 主进程 `ProviderFactory` 认识的供应商标识（与现预设 `ProviderPreset.name` 相同，当前等于 id）。各面板不得再有的传 `displayName`、有的传 `providerId`。自定义供应商用其 preset `name`。

Provider 片验收用这 14 处 `chat`/`chatStream`，不只搜 `configure`。`AIChatPanel` 目前仍把 `{ model: requestConfig.model }` 传进 `chatStream`，这是渲染端第二层覆盖的现存实例。

### 7.6 审查没写、但改计划时要带上的点

1. **`ai-stream-cancel.test.ts` 是 Provider 片的一部分。** `beforeEach` 仍 `aiService.configure(...)`，签名仍是 `chatStream(messages, options, projectId)`。该文件必须在同一原子片改完，并补：两路重叠流配置不串；调用后、消费前改原 config，IPC 仍是快照。
2. **epoch 必须按 projectId 分桶。** `PlanningWorkspace` 常驻、切项目不卸载。单计数器会让 A 的保存把 B 的长任务误判为过期，或反过来。用 `Map<projectId, number>`。后台写回 `startedId` 时，比较的是 **startedId 的 epoch**，不是当前界面项目的 epoch。
3. **`configure` 的空值语义不要照抄进快照函数。** 现实现 `if (model) this.currentModel = model`、`if (baseUrl) this.currentBaseUrl = baseUrl`，空串不会覆盖。快照函数应对 `apiKey`/`model` 做 trim；`baseUrl` 缺省字段不写（测 `toBeUndefined()`），显式空串也不应变成上一次请求的 leftover——因为不再有全局 leftover。
4. **合同第 23 行「保存后重新 load」与审查第 4 条冲突，计划 Task 5 仍是 `void planningLoader.load(id)`。** 两份施工文件互相打架。修订时合同、计划、审查清单必须写同一条路：`onPlanningCommitted(projectId, res.data)`。
5. **计划 Global Constraints「不提交 git，除非用户明确要求」与第四节「worktree 内任务级 commit」冲突。** 采用 Subagent-Driven 时，用户需另授「独立 worktree 内按原子片 commit、不 push」；共享工作区仍不提交。

### 7.7 建议会上直接勾的清单（取代「再辩论」）

- [ ] Provider / Planning / Preview 三片顺序实施，不并行。
- [ ] `chatStream` 同步外壳 + `projectId` 必填；`chat()` 入口快照即可。
- [ ] 同项目旧生成：内存 per-project epoch，写库前比较；无 DB revision。
- [ ] 普通保存：`onPlanningCommitted(projectId, res.data)` 立即更新 App；导入仍 guarded reload。
- [ ] 预览：分段文本节点；保存仍是 HTML 原文。**否决** `<pre>` 直出标签，**否决** 只 `htmlToPlainText` 预览。
- [ ] 主进程 `options.model` 本轮保留。
- [ ] `name` = Factory 供应商标识。
- [ ] 测试命令按全量 `npm run test` 写；最终门加 `build:main`、vite、三个 UI runner。
- [ ] 独立 worktree 内任务级 commit、不 push；共享 checkout 不写 P0。
- [ ] P1 不创建 Spec、不写迁移。

勾完后应先修订短计划正文（三片 + 上列默认）和合同对应句子，再开工。不要派代理去执行现在的 Task 1～7。

---

### 7.8 修订落地（2026-09-13）

上列默认已写入：

- 合同：`docs/superpowers/specs/2026-09-13-ai-production-current-contract.md`
- 短计划：`docs/superpowers/plans/2026-09-13-p0-provider-planning-preview.md`（Provider / Planning / Preview 三片 + 最终门）

清单作为验收对照保留。实现代理按修订后的短计划执行，不要再按旧 Task 1～7。P1 仍未授权。

---

## 八、第四人对 Task 1（Provider 原子片）实现的核对（2026-09-13）

> **读法：** 对照 worktree `codex-p0-provider-planning-preview`（commit `87f8040`）与 `sdd/task-1-report.md` 核对。不推翻结论，只补报告没写、或与第七节默认值仍有落差的三点。Planning/Preview 两片按计划尚未实现，不评。

### 8.1 结论：接受，报告与代码一致，定向测试我已复跑通过

- `snapshotAIRequestConfig`、`chat`/`chatStream` 同步外壳、`normalizeStreamProjectId`、7 面板 14 处调用全部落在报告所述位置，无虚报。
- 我复跑：`ai-request-config`（6）+ `stream-project-id`（2）+ `ai-stream-cancel`（10）+ `provider-cache-key`（3）＝ **21/21 PASS**，与报告「本片 13 增 + 基线」吻合。未复跑全量 386（报告诚实区分了定向/全量，接受）；三个 UI runner 属最终门未跑，符合合同。

### 8.2 `config.name` 未按 7.5 完全统一（唯一有实质落差的点）

第七节 7.5 钉死「`name` = Factory 供应商标识，各面板不得各写各的」。但 `PlanningWorkspace.loadFirstAiConfig` 仍用 `selected.providerId` 当 `name`（`PlanningWorkspace.tsx:44`），而其余面板用 `preset?.name ?? providerId`。当前 `PROVIDER_PRESETS` 里 `name === id`（`provider-factory.ts` 与各面板 preset 一致），所以**功能不炸**，但这是 7.5 要求收敛、实现未收敛的残余。

根因：`PlanningWorkspace` 没有 preset 数组，只有 `BASE_URLS` 字典，拿不到 `preset.name`。要么给它补 name 映射，要么沿用 `providerId` 并在报告里显式声明「name===id 等价」这一前提。否则将来出现 `name ≠ id` 的自定义供应商，只有策划面板会串到主进程不认识的标识。建议 Planning 片或收尾时统一，本片可先记录不阻塞。

### 8.3 AIChatPanel 新增配置不持久化 baseUrl（既有问题在 P0 下显形，非本片引入）

`AIChatPanel.handleAddConfig` 的 `newConfig` 只写 `id/providerId/apiKey/model/label`，从不写 `baseUrl`（`SavedConfig.baseUrl` 可选但恒 undefined）。所有请求靠 `requestConfig.baseUrl || requestProvider?.baseUrl` 兜底。

- built-in 供应商：等价旧行为，无回归。
- `custom` 供应商（`baseUrl: ''`）：兜底得空串 → `snapshotAIRequestConfig` 不写 `baseUrl` 字段 → 主进程 `GenericOpenAIProvider` 拿到空 endpoint。

这是「自定义供应商 baseUrl 从未被正确持久化」的既有 bug，Provider 片只是让它在「不再有全局残留」后稳定显形，**不该由本片顺手修**（超范围）。但值得在最终门或后续登记，否则 custom 供应商静默失效。

### 8.4 双 projectId 校验错误消息不一致（无害）

renderer 侧 `chatStream` 抛「chatStream 需要 projectId」，主进程 `normalizeStreamProjectId` 抛「缺少 projectId，无法启动可取消的 AI 流」。renderer 先拦截，用户实际只看到前者。两处都校验是对的，建议措辞统一，避免排查时对不上。

### 8.5 小结

Provider 片质量高、TDD 证据真实、`ai-stream-cancel.test.ts` 已按新签名全套改写（含「重叠流不串 model」「调用后改原 config 仍是快照」两个 7.6 要求的回归）。8.2 的 name 收敛建议带进 Planning 片，8.3 记入最终门待办。可进入 Planning 片。P1 仍未授权。

---

## 九、施工进度指针（2026-09-13 晚）

完整交接（状况 / 结果 / 改动文件 / 下一步）见 `docs/superpowers/plans/2026-09-13-p0-status.md`。

本节不重复审查：Task 1 仍以第八节为准。之后 worktree 上出现了 Task 2 未提交草稿（loader / epoch / persist / 保存返回值更新 committed），**未 commit、未双重审查、UI 回归未改**。Preview 未开始。不要把「可进入 Planning」读成「P0 已完成」。
