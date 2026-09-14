# A1–A6 生产管线收口 — 自检报告

> 日期：2026-09-12
>
> 实现侧状态：**10 步全部落地**；自检补了 M3 编辑器 `setContent`（`bc8b01b`）；复审收口 `4b3d417`；M3 UI 回归 + A3 JSDoc `939a603`；测试计数 `da6538b`；第三轮收口 `7d4c000`（`onChapterAccepted` 项目守卫 + persist 后切回刷新）；第四轮收口 `598bb36`（M3 fixture 同步义务注释）。当前 HEAD：`598bb36`。
>
> 实现者报：**323 单测、写作 UI 12/12、决策账本 16/16、Obsidian 114/114**（本机实测）。第二轮至第五轮审查均**未复跑**这些命令，数字不作已复核。
>
> 第二轮（对照当时 HEAD `bc8b01b`）：完成说明大体属实；对话决策来源被抹空是真回归；A4b/A2/A5 有过满。详见第五节。
>
> 第三轮（对照当时 HEAD `da6538b`）：第六节声称已修的代码属实；M3 UI 两条存在但**锁的是 fixture 复刻，不是 App 真回调**。第五节是 `bc8b01b` 快照，不要当未修清单。详见第七节。
>
> 第四轮（对照当时 HEAD `7d4c000`）：第八节第 2、3 条代码属实；当时第 1 条注释**未**写入 fixture。详见第九节。
>
> 第五轮（对照 HEAD `598bb36`）：同步义务注释已落地，无新的生产缺陷。详见第十节。
>
> 本报告原放工作区；整分支合入稳定后的卫生阶段已归档至 `docs/reports/`。
>
> 范围说明：这是技术审查报告《hi-story 项目技术审查报告》「第 0 步确定 bug」的落地，对应实施方案 `docs/2026-09-12-A1-A6实施方案.md`。

---

## 一、完成内容

按实施方案 `A6 → M3 → M1 → M2 → A3 → A2 → A1 → A5 → A4a → A4b` 顺序，TDD 一步一提交。实现者原报 **12 个提交**（10 步 + 1 文档 + 1 自检补丁）；其后还有 `4b3d417` 复审收口、`939a603` 测试/JSDoc、`da6538b` 计数文档、`7d4c000` 第三轮收口、`598bb36` fixture 注释。

| 步骤 | 改动 | 单测 | UI 回归 |
|---|---|---|---|
| **A6** 章节历史去过期 | 删 7 天时间窗，保留每章 30 份上限 | 2 | — |
| **M3** 审稿刷新 | 弃 `'current'` 字面量，真实 projectId + 回写 App | — | vite build |
| **M1** systemPrompt | `merge-system-prompt.ts` 纯函数，OpenAI/Claude 共用 | 3 | — |
| **M2** 缓存键 | 含 baseUrl + 完整 apiKey | 3 | — |
| **A3** 策划表约束 | 迁移 v20：去重 + `UNIQUE(project_id)`、坏 JSON 报错、save 读改写合并 | 5 | Obsidian 114/114 |
| **A2** 跨项目守卫 | `shouldApplyPlanningResult` + `persistPlanning` 后台写回 | 3 | — |
| **A1** 写章同步落库 | create 返回 id + 写 word_count，弃 timer/localStorage | 2 | 写作 10/10（后升 12/12） |
| **A5** 钩子单轨 | hook 进 `creative_decisions` proposed，停双写 | 4+2 | 决策账本 16/16 |
| **A4a** 对话读策划 | planning loader + ContextBuilder 跳过 outlineNodes | 5+3+2 | — |
| **A4b** 写章读章纲 | AI 代写不再复制 outline_nodes 节点 | — | 三套全过 |

> 上表为**实现者当时自报**（写作 UI 后为 12/12，单测 323）。第二轮认为 A4b / A2 / A5 债务宽度有过满，对话决策来源字段有回归；第六节为处置，第七节为第三轮。

**最终回归口径（实现者实测；审查未复跑）**：
- 全量单测 **323 passed**（`da6538b` 文档；补丁前表内曾写 322）
- `npm run build:main` + `npx vite build` exit 0
- 写作 UI **12/12**、决策账本 UI **16/16**、Obsidian 导入 UI **114/114**

---

## 二、修改文件

**生产代码**：
- 主进程：`chapter.repo.ts`、`planning.repo.ts`、`creative-decision.repo.ts`、`migrations.ts`（新增 v20）、`provider-factory.ts`、`merge-system-prompt.ts`（新）、`providers/generic-openai.ts`、`providers/claude.ts`、`creative-decision.ipc.ts`、`context-builder.ts`
- 渲染端：`App.tsx`、`components/AIWritePanel.tsx`、`components/AIReviewPanel.tsx`、`components/PlanningWorkspace.tsx`、`services/planning-loader.ts`（新）、`services/planning-generation-guard.ts`（新）、`services/chapter-extraction-proposals.ts`（新）、`services/ai-prompts/planning.ts`
- 文档：`CLAUDE.md`、`AGENTS.md`

**新增测试**：`chapter-history.test.ts`、`chapter.repo.test.ts`、`planning.repo.test.ts`、`provider-cache-key.test.ts`、`merge-system-prompt.test.ts`、`planning-generation-guard.test.ts`、`chapter-extraction-proposals.test.ts`、`planning-loader.test.ts`、`planning-context.test.ts`

**扩展测试**：`planning-prompt.test.ts`（formatPlanningAuthorityContext）、`creative-decision.repo.test.ts`（A5 来源分支）

---

## 三、遇到问题（自检发现的真实缺陷）

### 1. M3 修复不完整（本轮自检抓住，已修，提交 `bc8b01b`）

初版 M3 的 `onChapterAccepted` 只做了 `setChapters(...)` 更新 state，但 `RichEditor` 以 `key={activeChapter.id}` 挂载，同章节 key 不变时 TipTap **不会重渲染**——若审的正是当前打开的章节，编辑器正文不刷新。

这正是审查报告原话「即便改 projectId，若不回写 App，编辑器仍显示旧正文」的另一半。佐证：`handleApplyPolishChapter`（润色写回）早有 `editorRef.current?.setContent(content)` 且注释明确「同章节 key 不变，TipTap 不会自动同步，需主动 setContent」。

修复：接受修订若命中当前打开章节，主动调 `editorRef.current?.setContent(content)`。

### 2. 迁移测试连锁反应（已处理）

A3 的 v20 让 3 个旧迁移测试失败，均为预期连锁：
- `narrative-subject.test.ts` / `creative-decision.migration.test.ts` 的手工简化表缺 `planning_ideas` → 补建表。
- `obsidian-import-repo.test.ts` 的「多行策划被拒」测试前提被 UNIQUE 约束永久消灭 → 删除该不可达测试。

### 3. A5 事务原子性（实现者核对：通过；第二轮：门禁对、落库字段漏）

`insertProposals` 复用 `db.transaction`，`requireNoPendingTarget` 在事务内执行，符合「同项目同 target 只能一个 pending」约束；旧 `createProposals` 仍走 `requireAssistantSource`，新方法 `createChapterExtractionProposals` 不放宽对话路径。

第二轮补充：门禁「仍要求 assistant」属实，但 `createProposals` 随后把来源写成 `null, null`，对话决策的 `source_thread_id` / `source_message_id` 被抹掉。详见第五节第 1 条。

---

## 四、下一步建议（实现者原稿 + 第二轮优先级）

**必须先修（第二轮新增 → 第六节已修）：**

0. **`createProposals` 必须把真实 thread/message 传入 `insertProposals`** — 已在 `4b3d417` 修好，并有成功路径断言。章节抽取路径写 null 保持不变。

**实现者原建议（第二轮认为成立）：**

1. **M3 编辑器刷新应补 UI 回归断言**：**产品已拍板只补这一条（2026-09-12）。** 写作 UI 10/10 不覆盖「审稿接受修订后编辑器刷新」。在 `writing-workspace.tsx` 补：同 `key` 下只更新 chapters 时 TipTap 仍是旧正文；再调用与 App 相同的 `setChapters` + 当前章 `setContent` 后正文变化。不挂审稿面板、不打 AI。不要只测 `setContent` 能改字——那锁不住「忘了调 setContent」的回归。

2. **A2 跨项目守卫缺 UI 验证**：**本轮不做，记 P2。** 纯函数 + `finally` 门禁已有单测/代码修复。带 `aiService`/`skills:route` mock 的切项目 UI 成本中等，不扩大本轮范围。

3. **A4a/A4b 的回退路径缺 UI 断言**：老项目（无策划工作台）自动回退 outline_nodes，`planning-context.test.ts` 已覆盖对话侧，但写章面板 `getContext` 的 outline_nodes 回退分支只靠编译通过。第二轮补充：工具栏代写下拉/批量仍读 `outlineNodes`，若补回归应覆盖这条，而不是只测策划入口单章。

4. **A3 的 save 合并语义防误读**：`PlanningWorkspace.save` 仍传全量（行为不变），但未来新调用方若漏传字段会被「保留旧值」语义吞掉——这是有意的。**JSDoc 已加（`939a603`）**。标量 `??` 本身不改。

---

## 五、第二轮审查（对照当时 HEAD `bc8b01b`，2026-09-12）

> 本节是对照 `bc8b01b` 的当时意见，**不要当当前 HEAD 的未修清单**。处置见第六节；第三轮见第七节。

审查方式：读提交历史与生产代码。**未复跑**当时的 322 单测及写作 / 决策账本 / Obsidian 三套 UI。

### 总评

12 个提交确实按 `A6 → M3 → M1 → M2 → A3 → A2 → A1 → A5 → A4a → A4b`，再加文档和 M3 补丁。该动的生产文件基本都动了；M3 编辑器刷新是实现者自己抓住并补上的，态度诚实。不能全盘签字的原因是：对话决策来源被写空、A4b/A2/A3 有过满表述。

### 属实、做法合理

| 项 | 核对结果 |
|---|---|
| **A6** | 章节历史已去掉 7 天窗，只按每章 30 份淘汰 |
| **M3** | 审稿不再用 `'current'`；接受修订会 `setChapters`；同 `key` 下会 `editorRef.setContent`。自检属实，补丁写在该写的地方 |
| **M1** | `merge-system-prompt.ts` 被 Claude 和 OpenAI 兼容路径共用 |
| **M2** | 缓存键是 `name:model\|baseUrl\|完整 apiKey` |
| **A3** | v20 去重后建 `UNIQUE INDEX` 在 `project_id`（表头写 `UNIQUE(project_id)`，实现是唯一索引，语义等价）；`pickJson` 用 `=== undefined` 保留旧 JSON；坏 JSON 返回 `success: false` |
| **A2** | 生成完成后用 `shouldApplyPlanningResult`，切走项目时 `persistPlanning(startedId)`，不把结果塞进当前 UI |
| **A1** | `create` 直接带正文并返回 id，不再猜 `sortOrder` / `setTimeout` / `localStorage` |
| **A5** | 写章抽取的 hook 进 `proposed`；普通事实/知识仍 `batchUpsert`；不再双写 `narrativeHooks:create` |
| **A4a** | 有 `planningContext` 时 ContextBuilder 不再注入 `outlineNodes` |
| **A4b** | 策划页「AI 代写」不再 `outline:create` 复制节点，把章纲交给代写面板 |

第三节第 2 条「3 个旧测试坏了」需收窄：不是删了 3 个测试。`narrative-subject` / `creative-decision.migration` 是给简化库补了空 `planning_ideas` 表好跑 v20；**真正删掉的**是 Obsidian 导入里「多条策划记录应被拒绝」——UNIQUE 之后该状态插不进去，删除合理。

### 写成整条完成、实际只做了一半

**A4b「写章改读章纲」只覆盖策划入口单章。**  
从策划点「AI 代写」会走 `pendingChapterOutline`，这条是对的。工具栏代写面板的下拉、多选、批量生成仍读 `outlineNodes`；批量保存后也**不**走 `onPersistExtraction`。审稿侧有章纲时确实改读章纲。  
所以「AI 代写不再复制节点」属实；「写章全面改读章纲」过满。**产品已拍板选 3：** 本轮措辞改为「策划入口改读章纲」，工具栏接章纲另立 P2。

**A2 项目守卫还不完整。**  
结果不污染 UI 做到了，但 `finally { setLoading(false) }` 不看当前项目。A 还在生成时切到 B 再开生成，A 结束会把 B 的 loading 清掉。切走再切回时，persist 完成后也不会再 `loadPlanning` 一次，可能看到旧策划直到下次进入。

**A3 标量字段仍用 `??`。**  
JSON 列合并是对的；`requirements` / `status` 省略仍会写成 `''`。当前策划页总是整包提交，暂时打不中。实现者建议的 JSDoc 还没加。

**A5 债务。**  
只把抽取结果里 `factType === hook` 做成提议，没有单独的债务草稿路径。与旧写章行为一致。**产品已拍板（选 1）：本轮只做钩子单轨，写章抽债务另立 P2**，见第六节第 5 条。

### 必须修：对话决策来源被写成 null

`createProposals` 仍校验 assistant 来源，随后却调用：

```ts
this.insertProposals(input.projectId, null, null, input.drafts)
```

文件：`src/main/db/repositories/creative-decision.repo.ts`（约 54–61 行）。

章节抽取路径写 `null` 是对的。对话路径必须传入真实的 `sourceThreadId` / `sourceMessageId`。现在对话里确认的决策，来源会话和消息会被抹掉。

对应单测只断言「非 assistant 会失败」，**没有断言成功时 `sourceThreadId` 仍是 `thread-a`**，所以 322 全绿也挡不住。第三节第 3 条「旧路径仍要求 assistant、不放宽」只说对了门禁，没核对落库字段。

应改成把 `input.sourceThreadId` / `input.sourceMessageId` 传进 `insertProposals`，并补一条成功路径断言。

### 其他纪律缺口

M3 的 `onChapterAccepted` 没有 `isActiveProject`。章节 id 是 UUID，误伤别的书概率低，但和项目守卫纪律不一致。

### 对实现者「下一步」的判断

| 建议 | 是否该做 |
|---|---|
| 先修 `createProposals` 的 source 字段 | **必须**，漏测回归 |
| M3 补写作 UI 回归（接受修订后编辑器正文变了） | 该做，实现者也承认只靠代码对照 |
| A2 用 mock AI 做切项目 UI | 有价值；先修 `finally` 无条件 `setLoading(false)` 更便宜 |
| A4 回退路径补 UI | 优先级低于来源字段回归；若做，应覆盖工具栏代写下拉仍是 outline_nodes |
| `SavePlanningIdeaInput` 加 JSDoc | 该做，避免后人把 `??` 当 bug |

---

## 六、第二轮审查意见的处置（2026-09-12）

> 实现者回源核实后，逐条判定并处理。

### 已修（提交 `4b3d417`）

1. **【必须】对话决策来源被写 null** —— 核实属实，是我在 A5 重构 `createProposals` 抽出 `insertProposals` 时引入的真实回归。`AIChatPanel.tsx:719-720` 明明传了真实 thread/message，第 61 行却写成 `null, null`，且 `createRevision` 会继承父来源，抹空会级联。已改：`insertProposals(input.projectId, input.sourceThreadId, input.sourceMessageId, input.drafts)`；并补成功路径断言 `sourceThreadId === 'thread-a'`。
2. **A2 `finally { setLoading(false) }` 不看当前项目** —— 核实属实。A 生成结束会清掉 B 的 loading。已改：4 个 generate 的 finally 都用 `shouldApplyPlanningResult` 门禁；并在切项目 `useEffect` 里补 reset 4 个 loading 状态（否则切走再切回 loading 会残留）。
3. **M3 `onChapterAccepted` 缺 `isActiveProject`** —— 已补：接受修订若命中当前章节且 `isActiveProject(activeChapter.projectId)` 才 `setContent`。

### 判定「成立但本轮不做」（记入下一步）

4. **A3 标量字段仍用 `??`（`requirements`/`status` 省略写成 `''`）** —— 属实，但当前策划页总是整包提交，打不中。**JSDoc 已加（`939a603`）**，标注了「JSON 列省略=保留旧值、标量列省略=默认值、`??` 会吞 null」三句，避免后人把 `??` 当 bug。标量字段本身不改（当前无调用方依赖「省略=保留」）。
5. **A5 债务宽度过满** —— 属实。**产品已拍板选 1（2026-09-12）：本轮只做 hook，债务记 P2。** 写章 `FACT_EXTRACTION_SYSTEM_PROMPT` 只有 hook、旧旁路从不建债务，不补不算丢数据。债务继续由对话账本提议确认。禁止把 hook 事实猜成债务。方案/CLAUDE/AGENTS/目标对照已改成「钩子单轨」。
6. **A4b「写章改读章纲」只覆盖策划入口单章** —— 属实。**产品已拍板选 3（2026-09-12）：本轮先改措辞，工具栏接章纲另立 P2。** 不选 1：`App` 已把 `chapterOutlines` 传入 `AIWritePanel`，「工具栏没有章纲来源所以回退」不成立；无章纲时回退 `outlineNodes` 才是合理回退。不选 2：不把 UI 数据源改动混进已收口批次。方案/CLAUDE/AGENTS 已改成「策划入口改读章纲」。

### 已补（提交 `939a603`）

7. **M3 编辑器刷新回归** —— 产品拍板「只补这一条」。在 `writing-workspace.tsx` 补了两条：
   - 「只 setChapters 不 setContent 时当前章正文不刷新」：锁定 TipTap 同 key 根因（负例有价值）。
   - 「setChapters + 当前章 setContent 才刷新正文」：锁定 **fixture 复刻** 的正确写法，**不是** App 真回调。删 App 里 `setContent`，12/12 仍绿。
   - 写作 UI 由 10/10 升到 **12/12**。
   - 见第七节第 1 条、第九节第 1 条。

### 验证（实现者实测）

- 全量单测 **323 passed**（新增 1 条防回归断言）
- `build:main` + `vite build` exit 0
- 写作 UI **12/12**、决策账本 UI **16/16**（来源字段修复未破坏确认链路）

---

## 七、第三轮审查（对照 HEAD `da6538b`，2026-09-12）

审查方式：对照第六节声称的提交读源码。仍**未复跑** 323 / 12/12 / 16/16 / 114/114。

### 第六节声称已修的，代码对得上

| 声称 | HEAD 核对 |
|---|---|
| `createProposals` 传入真实 thread/message | `creative-decision.repo.ts` 第 61 行已改；抽取路径第 78 行仍 `null, null`（正确）。单测 `sourceThreadId === 'thread-a'` 存在 |
| A2 `finally` 看项目 + 切项目 reset loading | 四个 generate 的 finally 均有 `shouldApplyPlanningResult`；`useEffect([project?.id])` 会清四个 loading |
| M3 `isActiveProject` 才 `setContent` | `App.tsx` `onChapterAccepted`：当前章 + `isActiveProject(activeChapter.projectId)` 才 `setContent` |
| A3 `SavePlanningIdeaInput` JSDoc | `planning.repo.ts` 顶部三句语义已写 |
| 写作 UI 两条 M3 | `writing-workspace.tsx` 有负例（只 setChapters 仍「原文」）和正例（加 setContent 后变） |

产品拍板（钩子单轨、A4b 工具栏接章纲 P2、只补 M3 UI 不补 A2 mock）与方案/CLAUDE/AGENTS 一致。

### 新意见（本轮要写进报告的）

**1. M3 UI 回归没有锁住 App 真回调（重要限定）。**  
第六节写「谁删了 setContent 调用测试会红」**过满**。两条用例调用的是 fixture 自己的 `acceptRevisionWithSetContent` / `Without`，**不 import、不执行** `App.tsx` 的 `onChapterAccepted`。把 App 里那行 `setContent` 删掉，写作 UI 12/12 仍绿。

负例仍然有价值：它锁住「同 key 下只改 chapters，TipTap 不刷新」这条根因。正例只锁「fixture 里那种写法能刷新」，不锁生产回调。

若还要收紧（不强制本轮）：把「setChapters + 当前章 setContent」抽成 App 与 fixture 共用的小函数；或在 fixture 注释写明必须与 `App.tsx` `onChapterAccepted` 同步改。不要把 12/12 理解成「审稿接受修订的生产路径已 DOM 覆盖」。

**2. `onChapterAccepted` 的 `setChapters` 仍无项目守卫。**  
`setContent` 看了 `isActiveProject`，列表更新没有。切项目后的迟到修订仍可能改 `chapters`（UUID 碰撞极低）。纪律不一致，不是用户可感知必现 bug。

**3. A2：persist 完成后若已切回原项目，仍不 `loadPlanning`。**  
方案原文：persist 完若 `current === startedId` 再 load 一次。`4b3d417` 只修了 loading 门禁。A→B→A 快切时，`useEffect` 可能先读到旧库，persist 后界面仍旧，直到再进一次策划页。可接受的残留，不是 loading 清错。

**4. `persistPlanning` 失败被吞掉。**  
`catch { return false }`，切走项目后生成结果可能没落库，当前 UI 也不报错。次要。

**5. 本报告前半曾经自相矛盾（第三轮已改表头）。**  
第五节仍描述「来源写成 null」为必须修，那是 `bc8b01b` 快照，不是当前 HEAD。读者应从第六、七节看处置，不要按第五节开工。

### 仍不必本轮做（与产品拍板一致）

- 写章抽债务（P2）
- 工具栏代写/批量接章纲；批量走 `onPersistExtraction`（P2）
- A2 切项目 AI mock UI（P2）
- 标量 `??` 改成与 JSON 列相同的省略=保留（JSDoc 已够）

### 第三轮总评

第二轮指出的真回归和纪律项，实现者按源码修了，不是口头结案。本轮没有新的必须立刻改的生产 bug。唯一值得记在报告里、避免误读验收的，是 **M3 的 12/12 测的是 TipTap 同 key 行为 + fixture 复刻，不是 App 审稿回调**。

---

## 八、第三轮审查意见的处置（2026-09-12）

> 实现者逐条判定并处理。

| # | 第三轮意见 | 处置 |
|---|---|---|
| 1 | M3 UI 回归锁的是 fixture 复刻，不是 App 真回调 | **接受限定，改报告措辞。注释义务已补（`598bb36`）。** 删 App 里那行 `setContent` 12/12 仍绿，属实。本轮不抽公共函数（权衡见下）。第八节原写「在 fixture 注释写明须与 App.onChapterAccepted 同步改」，第四轮指出未落地；已在 `writing-workspace.tsx` 补「同步义务：改 App.tsx 的 onChapterAccepted 行为时，必须同步改这里」注释。 |
| 2 | `onChapterAccepted` 的 `setChapters` 无项目守卫 | **已修（`7d4c000`）**：`setChapters` 也走 `isActiveProject(chapter.projectId)`，与 `setContent` 守卫一致。 |
| 3 | A2 persist 后切回原项目不 `loadPlanning` | **已修（`7d4c000`）**：抽 `persistAndRefreshIfReturned`，persist 成功且已切回原项目时再 `loadPlanning` 一次，4 个 generate 统一走它。 |
| 4 | `persistPlanning` 失败被吞 | **接受，记 P2**。切走项目后生成结果可能没落库、UI 不报错，属次要（用户已切走，不感知；下次进策划页会读到旧库，可重生成）。 |
| 5 | 报告前半自相矛盾 | **已处理**：表头已标注第五节是 `bc8b01b` 快照、第六/七节是处置，勿按第五节开工。 |

**第 1 条的权衡说明（供后续决策）**：抽公共函数能让 UI 测试锁生产回调，但 4 行逻辑绑着三个状态，本轮不抽合理。第八节原计划用「fixture 注释声明同步义务」替代，第四轮指出注释未写入，已补（`598bb36`）。若将来审稿回写变复杂，再抽公共函数不迟。

### 验证（实现者实测）

- 全量单测 **323 passed**
- `build:main` + `vite build` exit 0
- 写作 UI **12/12**、决策账本 UI **16/16**

---

## 九、第四轮审查（对照 HEAD `7d4c000`，2026-09-12）

审查方式：对照第八节声称的 `7d4c000` 读 diff 与源码。仍**未复跑**测试数字。

### 属实

| 第八节声称 | 核对 |
|---|---|
| `onChapterAccepted` 的 `setChapters` 也走项目守卫 | 属实，且写法比「只包一层 isActiveProject」更稳：先 `chapters.find`，再 `isActiveProject(chapter.projectId)`，找不到或已切走都不改列表、也不 `setContent` |
| `persistAndRefreshIfReturned` 四个 generate 统一走 | 属实。persist 成功且 `current === startedId` 才 `loadPlanning`。`loadPlanning` 默认会 `select` 抬代次，会取消切回时那次读旧库的 in-flight load，这是想要的，不是回归 |
| 不抽公共函数的权衡 | 同意。4 行逻辑绑着 `editorRef` / `activeChapter` / `chapters`，本轮不抽合理 |
| persist 失败吞掉记 P2 | 接受，与上次拍板一致 |

### 不属实 / 未做完

**1. 「fixture 注释写明同步义务」当时没有落地（已由 `598bb36` 补上，见第十节）。**  
当时 `git show 7d4c000` 只有 `App.tsx`、`PlanningWorkspace.tsx` 两文件。这不是生产 bug。第五轮核对注释已写入。

**2. 表头曾停在 `da6538b`。**  
第八节已经写了 `7d4c000`，表头第三轮仍写「当前 HEAD：`da6538b`」。第四轮已改表头。读者应以 git log 为准。

**3. 第四节第 4 条曾仍写「JSDoc 尚未加」。**  
`939a603` 已加。第四轮已改该条。

### 不是新缺陷

- `onChapterAccepted` 闭包里的 `chapters`：切项目后迟到回执要么找不到章、要么 `projectId` 对不上当前项目，会被守卫挡住。
- persist 后 `loadPlanning` 与切回 `useEffect` 竞态：后到的代次生效；useEffect 仍会先清空再加载，可能闪一下空态。可接受。

### 第四轮总评

第三轮剩下的两条生产残留（列表无守卫、切回不刷新）已经按源码修了。当时唯一要更正的是报告：M3 测试同步义务只写在第八节表格里，没有写进 fixture（后由 `598bb36` 补上）。

---

## 十、第五轮审查（对照 HEAD `598bb36`，2026-09-12）

审查方式：对照第八节现写的 `598bb36` 读 `git show` 与 `writing-workspace.tsx`。仍**未复跑**测试数字。

### 属实

`598bb36` 只改 `tests/ui/writing-workspace.tsx` 一处：在 `acceptRevisionWithSetContent` 上增加「同步义务：改 App.tsx 的 onChapterAccepted 行为时，必须同步改这里，否则本回归锁不住生产回调。」与第四轮要求的义务句同义，已落地。

第八节表格第 1 条、权衡说明、验证口径里写「注释已补」现在与仓库一致。

### 仍成立的限定（不是新缺陷、不必再改代码）

- 12/12 **仍然**不执行 `App.onChapterAccepted`。删掉 App 里的 `setContent`，测试照绿。注释防止的是「后人不知道要同步」，不是自动红灯。
- fixture 正例仍不模拟 `7d4c000` 的 `chapters.find` + `isActiveProject`。写作套件没有切项目，不必补。

### 第五轮总评

第四轮指出的报告/注释缺口已补。没有新的生产 bug，也没有新的过满声称。A1–A6 本轮（含复审收口）可以结案。

剩余 P2 不变：写章抽债务、工具栏代写/批量接章纲（含批量 `onPersistExtraction`）、A2 切项目 AI mock UI、`persistPlanning` 失败可见性。

---

## 验证口径（如实声明）

- 全量单测 323、写作 UI 12/12、决策账本 UI 16/16、Obsidian 导入 UI 114/114、build:main、vite build 均为**实现者本机实测**；第二轮至第五轮审查未复跑，不能当作已复核。
- 第二轮 3 个纪律项已修（`4b3d417`）。第三轮第 2/3 条已修（`7d4c000`），第 1 条接受限定且 fixture 同步义务注释已补（`598bb36`），第 4 条记 P2。过满项：A5 债务只做 hook、A4b 工具栏接章纲 P2。结案见第十节。
- **真实 vault 未复跑**：本轮不涉及 Obsidian 导入解析逻辑变更，仅 A3 迁移影响 `planning_ideas` 结构，已由 5 个单测 + Obsidian UI 回归覆盖。
- **方案「明确不做」的项未触碰**：拆 App、策划拆表、删大纲/伏笔面板、Obsidian 回写、AI 流取消。
