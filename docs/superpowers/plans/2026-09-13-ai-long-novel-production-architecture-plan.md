# AI 长篇小说生产系统架构调整实施方案（讨论稿）

> **供开发者讨论：** 本文仅用于确认架构边界、实施顺序、迁移方案和验收标准，不代表已经授权修改代码。确认后应按阶段实施，每个阶段独立测试、审查和提交。
>
> **冻结（2026-09-13）：** 本文是讨论档案，**停止追加第二十一节及以后。施工禁止按第 1～11 节编码。**
>
> 落地文件：
> - 当前合同：`docs/superpowers/specs/2026-09-13-ai-production-current-contract.md`
> - P0 短实施计划：`docs/superpowers/plans/2026-09-13-p0-provider-planning-preview.md`
> - P0 计划审查：`docs/superpowers/plans/2026-09-13-p0-provider-planning-preview-review.md`（第七节默认值已并入短计划与合同；本文不再追加第二十一节）
> - 施工进度交接：`docs/superpowers/plans/2026-09-13-p0-status.md`（2026-09-13 晚：Provider 已过审，Planning 未提交，Preview 未开始）
>
> **第二人审查（2026-09-13）：** 见文末「十三、第二人审查意见原文」。结论：方向对、诊断大多属实，但不能当施工合同。建议先统一迁移账本，第一次授权只做 P0 三件（请求级 Provider、策划单一快照、AI 预览禁止注入 HTML）。
>
> **原提案作者复核（2026-09-13）：** 见「十二、联合复核与收敛结论」。迁移号、正文世代、抽取边界和 A5 范围接受第二人校正；对类型门禁、ContextAssembler 职责、分析任务可恢复性和长期里程碑优先级补充了不同意见。第十二节的迁移账本与首次授权范围优先于前文原提案。
>
> **第二人再答复（2026-09-13）：** 见「十四、第二人对联合复核的再答复」。第十二节 12.1 的七条校正全部接受；对「缺失分析如何扫描」「chapter-run 二/三期是否挡 P1」「手写保存是否弹窗询问」仍有不同意见。首次授权三件 P0 不变。
>
> **第三人独立意见（2026-09-13）：** 见「十五」。不推翻收敛，只补 P0 验收措辞、Provider 缓存层、以及 `content_generation` 薄迁移时序。
>
> **第二人对第三人的表态（2026-09-13）：** 见「十六」。三条补注整体接受；补 2 按代码收窄为「键已按配置分，P0 不要改回整表清空」。
>
> **本轮独立审查（2026-09-13）：** 见「十七」。P0 三件仍可授权；新增阻塞主要集中在 P1/P2：历史状态不能只看当前 `status`、不同 AI 任务需要不同时间截面、规划章尚无稳定 key、章节删除会丢失来源绑定、分析任务恢复时缺少 Provider/费用契约。另补 PlanningSnapshot 失败语义、ContextBundle 新鲜度、滚动摘要并发和 WAL 在线备份问题。
>
> **第二人对现稿的审查（2026-09-13）：** 见「十八」。三位收敛足以授权 P0；本文内部仍自相矛盾，不能当施工单。第十七节多数属实，是 P1 真正的洞。下文补仍未写死的问题，并给第十七节若干默认选项，方便会上勾选而不是重新辩论。

**目标：** 在保留 Electron + React + SQLite 技术底座的前提下，使 hi-story 能可靠支撑世界观/人物/大纲管理、AI 剧情讨论、AI 写章、钩子债务追踪、修改历史和 50 万字长期小说生产。

**架构策略：** 不全面重写，不引入微服务、云数据库或 ORM。通过单一策划状态、目标章节时间切片、章节分析任务、统一上下文装配器和永久里程碑历史，逐步补齐长篇生产闭环。

**技术栈：** Electron 33、React 18、TypeScript、Vite 5、SQLite/better-sqlite3、Vitest、TipTap。

## 全局约束

- 现有用户正文、策划、人物、世界观、事实、钩子、债务、会话和历史不得删除或静默改写。
- 所有新增迁移必须把 DDL、数据回填和版本登记放在同一 SQLite 事务内。
- 所有异步回执必须校验项目 ID、请求代次；涉及正文分析时还要校验正文 revision/hash。
- AI 只能提出事实、钩子和债务候选；正式叙事状态仍由作者确认。
- Obsidian 保持单向只读，不新增自动回写。
- 每个阶段独立交付，前一阶段通过完整测试和代码审查后才能进入下一阶段。
- 不在本轮处理章节分页、向量数据库、云同步、多人协作、planning 全面拆表和全面 UI 重构。

---

## 一、审查结论

当前架构可以运行短篇/中篇 MVP，但还不能可靠支撑 50 万字长期生产。瓶颈不在 SQLite 容量，而在以下五点：

1. AI 上下文没有统一的“目标章节时间点”语义。
2. 摘要、事实、人物知识和钩子抽取不是可恢复、幂等的生产流水线。
3. 自动债务提取以及钩子/债务回收闭环尚未完成。
4. 策划、AI 配置和部分 UI 状态存在多处真相或跨面板污染。
5. 当前历史记录不足以覆盖数月乃至数年的创作过程。

### 目标适配度

| 未来目标 | 当前判断 | 核心缺口 |
|---|---|---|
| 世界观、人物、大纲管理 | 基础支持 | 策划双状态、结构化资料缺少永久版本 |
| AI 辅助讨论剧情 | 部分支持 | 全线程消息直接送入模型，缺少滚动摘要 |
| AI 生成章节 | 部分支持 | 目标章节时序错误、上下文规则分散、批量连续性不足 |
| 自动提取钩子和债务 | 部分支持 | hook 候选已有，debt 和回收/偿还候选不完整 |
| 修改历史追踪 | 部分支持 | 正文仅保留最近 30 个自动快照，核心设定无统一历史 |
| 50 万字长期管理 | 存储支持，语义不支持 | SQLite 足够，AI 长期记忆和派生状态一致性不足 |

---

## 二、推荐方案与不选方案

### 推荐：增量建立领域服务

按四个阶段增加：

1. 生产安全与单一真相。
2. 叙事时间模型与章节分析流水线。
3. 统一 AI 上下文与长对话摘要。
4. 永久历史与数据恢复。

### 不推荐：继续在组件内局部修补

短期改动少，但 Chat、Write、Review 会继续维护三套上下文和失败策略，长期问题会重复出现。

### 不推荐：全面重写或事件溯源

当前 SQLite/Repository/IPC 底座可继续使用。全面重写成本和迁移风险明显高于收益。

---

## 三、阶段一：生产安全与单一真相

### 修改 1：Renderer 类型门禁与 AI 内容安全

#### 1. 修改目标

阻止 Renderer 类型错误进入发行包，并确保 AI 生成内容不能作为可执行 HTML 进入页面。

#### 2. 当前问题

- Vite 只转译 Renderer，不执行完整 TypeScript 检查。
- `src/renderer/services/ai.service.ts` 存在未定义变量等真实类型问题。
- `src/renderer/components/AIWritePanel.tsx` 使用 `dangerouslySetInnerHTML` 展示 AI 输出。
- `src/renderer/index.html` 的 CSP 允许内联脚本。
- preload 接受任意字符串 IPC channel。

#### 3. 修改方式

- 新增 `tsconfig.renderer.json`，在 Vite 打包前执行 Renderer `tsc --noEmit`。
- 修复当前类型错误，但不顺带做无关重构。
- AI 正文预览改为文本节点或安全 Markdown，不注入原始 HTML。
- 将主题初始化内联脚本移到独立文件，生产 CSP 移除 `script-src 'unsafe-inline'`。
- 建立 invoke/on channel 允许列表，未知 channel 直接拒绝。
- Main Window 增加外部导航和新窗口拦截。

#### 4. 涉及文件

新增：

- `tsconfig.renderer.json`
- `src/renderer/theme-bootstrap.ts`
- `src/shared/ipc-channels.ts`
- `tests/unit/ipc-channel-policy.test.ts`
- `tests/unit/ai-preview-safety.test.ts`

修改：

- `package.json`
- `src/renderer/index.html`
- `src/renderer/components/AIWritePanel.tsx`
- `src/renderer/services/ai.service.ts`
- `src/preload/index.ts`
- `src/main/index.ts`
- Renderer 类型检查暴露出的相关文件

#### 5. 可能风险

- CSP 收紧可能影响开发环境热更新或编辑器样式。
- channel 允许列表遗漏可能使现有 IPC 被拒绝。
- 类型门禁会一次暴露较多历史问题。

#### 6. 是否影响已有数据

不影响。

#### 7. 是否需要迁移

不需要数据库迁移。

### 修改 2：AI Provider 改为请求级不可变配置

#### 1. 修改目标

确保每次 AI 请求使用当前面板明确选择的供应商、模型、地址和密钥。

#### 2. 当前问题

`aiService.configure()` 使用全局可变状态。隐藏的写章、审稿或润色面板可能覆盖普通对话的配置，造成请求发送到错误供应商。

#### 3. 修改方式

- 定义统一 `AIRequestConfig`：`providerId/providerName/apiKey/baseUrl/model`。
- 删除全局 `configure()` 状态。
- `chat()`、`chatStream()` 每次调用必须接收完整配置，并在请求创建时复制快照。
- 流注册表只记录 provider/model，不保存明文密钥。
- Chat、Write、Review、Polish 全部迁移到请求级配置。
- Provider 预设集中到一个目录，删除各面板的重复定义。

#### 4. 涉及文件

新增：

- `src/shared/ai/provider-config.ts`
- `src/renderer/services/ai/provider-catalog.ts`
- `tests/unit/ai-request-config.test.ts`

修改：

- `src/renderer/services/ai.service.ts`
- `src/renderer/components/AIChatPanel.tsx`
- `src/renderer/components/AIWritePanel.tsx`
- `src/renderer/components/AIReviewPanel.tsx`
- `src/renderer/components/AIPolishPanel.tsx`
- `src/main/ipc/ai.ipc.ts`
- `src/main/ai/provider-factory.ts` 及相关 Provider 文件

#### 5. 可能风险

- 遗漏某个 AI 调用点会导致参数缺失。
- 供应商默认 baseUrl 与现有面板硬编码可能不一致。
- streamId、取消逻辑和配置快照必须保持一一对应。

#### 6. 是否影响已有数据

不影响项目数据和已保存配置。

#### 7. 是否需要迁移

不需要数据库迁移。

### 修改 3：建立单一 PlanningSession

#### 1. 修改目标

确保策划页、普通对话、写章、审稿和 Obsidian 导入始终读取同一版本的总纲、分卷纲和章纲。

#### 2. 当前问题

`App.tsx` 与 `PlanningWorkspace.tsx` 分别加载并维护策划状态。策划保存或导入后，其他 AI 面板可能继续使用旧快照。

#### 3. 修改方式

- 新增项目级 `PlanningSession`，统一加载、保存、草稿恢复、项目守卫和 revision 冲突。
- `PlanningWorkspace` 改为受控组件，不再维护第二套持久化状态。
- 所有 AI 功能只消费同一个 `PlanningSnapshot`。
- Repository 保存使用 `expectedRevision`；版本冲突返回明确错误，不静默覆盖。
- Obsidian 导入成功后只刷新 session，不重复提交导入事务。

#### 4. 涉及文件

新增：

- `src/renderer/hooks/usePlanningSession.ts`
- `tests/unit/planning-session.test.ts`
- `tests/unit/planning-revision.test.ts`

修改：

- `src/renderer/App.tsx`
- `src/renderer/components/PlanningWorkspace.tsx`
- `src/renderer/services/planning-loader.ts`
- `src/renderer/components/ObsidianImportPanel.tsx`
- `src/main/db/repositories/planning.repo.ts`
- `src/main/ipc/planning.ipc.ts`
- `src/main/db/migrations.ts`
- 策划相关共享类型

#### 5. 可能风险

- 本地未保存草稿与数据库快照必须明确区分。
- AI 长任务完成时可能发现策划 revision 已变化。
- 导入后刷新失败不能触发第二次 commit。

#### 6. 是否影响已有数据

只增加版本字段，不改写策划内容。

#### 7. 是否需要迁移

需要迁移 v21：

- `planning_ideas.revision INTEGER NOT NULL DEFAULT 0`
- `planning_ideas.schema_version INTEGER NOT NULL DEFAULT 1`

### 阶段一验收

- Main TypeScript、Renderer TypeScript、Vite 构建全部通过。
- AI 输出不能执行 HTML/事件处理器。
- 多个 AI 面板同时打开时不会串供应商。
- 策划保存、锁定或导入后，所有 AI 入口立即读取新 revision。

---

## 四、阶段二：叙事时间模型与章节分析流水线

### 修改 4：建立按目标章节查询的叙事时间模型

#### 1. 修改目标

AI 生成或审查第 N 章时，只能看到第 N 章之前有效的事实、人物知识、钩子和债务。

#### 2. 当前问题

- 事实使用数据库 `created_at` 判断最近，重抽早期章节会把旧事实变成最新事实。
- 人物知识没有“截至目标章”的查询边界。
- hook 使用章节 ID，debt 使用整数章节号，插章和重排后可能漂移。
- 钩子上下文把项目最后一章当成当前章，重写旧章时优先级错误。

#### 3. 修改方式

- 为状态型事实增加 `state_key` 和 `effective_chapter_id`。
- 状态型事实按目标章节之前的最后一条计算；事件型事实按章节范围和相关性累计。
- 人物知识通过 `learned_at_chapter_id` 与目标章节顺序比较。
- debt 新增稳定的 `promised_by_chapter_id`；旧整数期限保留，不做猜测性映射。
- 新增纯函数 `reduceNarrativeStateAsOf()`。
- 所有钩子/债务上下文接口必须显式接收目标章节，不再读取项目最大 sort_order 作为当前章。

#### 4. 涉及文件

新增：

- `src/main/ai/narrative-state-reducer.ts`
- `tests/unit/narrative-state-as-of.test.ts`
- `tests/unit/narrative-due-position.test.ts`

修改：

- `src/main/db/migrations.ts`
- `src/main/db/repositories/story-facts.repo.ts`
- `src/main/db/repositories/narrative-hooks.repo.ts`
- `src/main/ipc/story-facts.ipc.ts`
- `src/main/ipc/narrative-hooks.ipc.ts`
- `src/main/db/repositories/creative-decision.repo.ts`
- 钩子、债务和事实相关类型/UI

#### 5. 可能风险

- 旧事实主体命名不统一，state_key 只能做确定性规范化，不能猜测合并。
- 重排章节后查询结果会变化，需要专门回归。
- 旧债务整数期限可能无法无歧义绑定到现有章节。

#### 6. 是否影响已有数据

保留全部旧记录。只新增时间字段并执行确定性回填；无法确定的旧债务标记为待绑定。

#### 7. 是否需要迁移

需要迁移 v22：

- `story_facts.state_key`
- `story_facts.effective_chapter_id`
- `narrative_debts.promised_by_chapter_id`
- 相应索引

### 修改 5：建立可恢复的章节分析任务

#### 1. 修改目标

章节无论来自 AI、手写、润色还是审稿，正文变更后都能可靠更新摘要、事实、知识、钩子和债务，旧正文的分析结果不能覆盖新正文。

#### 2. 当前问题

- 只有 AI 单章保存后触发 fire-and-forget 抽取。
- 手写、润色、审稿接受和部分批量路径没有统一覆盖。
- 抽取失败只写日志，重启后无法恢复。
- 分析没有正文 revision/hash 校验。

#### 3. 修改方式

- 正文成功变更时递增 `content_revision` 并计算 `content_hash`。
- 正文、短期历史快照和 pending 分析任务在同一事务内提交。
- 新增持久化 `chapter_analysis_jobs`。
- 任务执行结果落库前再次校验章节 revision/hash。
- 摘要、事实、知识和决策候选在一个事务内写入。
- 同一章节只保留最新 pending 版本；旧任务标记 stale。
- API Key 不写入任务表；执行时使用当前请求级 Provider 配置。
- 现有章节升级后不自动调用 AI，避免产生意外费用。

#### 4. 涉及文件

新增：

- `src/main/db/repositories/chapter-analysis.repo.ts`
- `src/main/ipc/chapter-analysis.ipc.ts`
- `src/main/ai/chapter-analysis.service.ts`
- `src/shared/chapter-analysis.ts`
- `tests/unit/chapter-analysis-jobs.test.ts`
- `tests/unit/chapter-analysis-stale-result.test.ts`

修改：

- `src/main/db/migrations.ts`
- `src/main/db/repositories/chapter.repo.ts`
- `src/main/ipc/chapter.ipc.ts`
- `src/main/ipc/index.ts`
- `src/renderer/components/WritingArea.tsx`
- `src/renderer/components/AIWritePanel.tsx`
- `src/renderer/components/AIPolishPanel.tsx`
- `src/renderer/components/AIReviewPanel.tsx`
- `src/renderer/services/ai-prompts/summary.ts`
- `src/main/db/repositories/creative-decision.repo.ts`

#### 5. 可能风险

- 两秒自动保存可能创建过多任务，必须合并同章旧 pending 任务。
- 软件关闭时 running 任务需要在下次启动恢复为 pending/failed。
- 自动分析会产生模型费用，必须提供自动/手动开关。
- 派生数据必须事务写入，不能留下半套状态。

#### 6. 是否影响已有数据

现有正文、摘要、事实和钩子不变。旧章节初始 revision 为 0，不自动重抽。

#### 7. 是否需要迁移

需要迁移 v23：

- `chapters.content_revision`
- `chapters.content_hash`
- 新建 `chapter_analysis_jobs`
- 根据最终幂等方案为 creative decisions 增加 `source_job_id` 和唯一索引

### 修改 6：补齐钩子、债务及回收候选

#### 1. 修改目标

章节分析同时识别新钩子、新债务、钩子推进/回收和债务偿还，作者保留最终确认权。

#### 2. 当前问题

当前 hook 混在事实抽取结果中，没有独立 debt 输出，也不能稳定识别既有钩子/债务的状态变化。

#### 3. 修改方式

- 章节分析结果拆成 `facts/knowledge/newHooks/newDebts/hookUpdates/debtUpdates`。
- Prompt 注入与目标章节相关的既有 hook/debt，并要求修订结果返回 targetId。
- 所有 hook/debt 结果进入 `creative_decisions` proposal。
- 作者确认后再更新运行时表。
- 使用 sourceJobId、章节 revision、targetId 和规范化内容避免重试产生重复提议。

#### 4. 涉及文件

修改：

- `src/shared/chapter-analysis.ts`
- `src/main/ai/chapter-analysis.service.ts`
- `src/renderer/services/ai-prompts/summary.ts`
- `src/main/db/repositories/creative-decision.repo.ts`
- `src/main/ipc/creative-decision.ipc.ts`
- `src/renderer/components/CreativeDecisionPanel.tsx`
- 钩子、债务相关共享类型和测试

#### 5. 可能风险

- AI 可能把普通悬念误判为长期债务。
- 同一承诺可能重复识别。
- 自动回收判断可能过于激进。

#### 6. 是否影响已有数据

不直接修改现有钩子和债务，只新增待确认 proposal。

#### 7. 是否需要迁移

不单独迁移；复用 v23 的任务来源和现有创作决策账本。

### 阶段二验收

- 重写第 20 章时不会读取第 21 章之后的事实或人物知识。
- 旧分析任务迟到时不会覆盖新正文的派生状态。
- 软件重启后 pending/failed 任务可继续处理。
- 手写、AI 写章、润色和审稿写回都进入同一分析链路。
- 章节可以产生 hook、debt、回收和偿还候选。

---

## 五、阶段三：统一 AI 上下文与长对话

### 修改 7：建立统一 ContextAssembler

#### 1. 修改目标

Chat、Write、Review 使用同一套目标章节、相关性、故事时间和 Token 预算规则。

#### 2. 当前问题

- ContextBuilder 主要服务普通对话，写章和审稿各自重新拼接上下文。
- 写章取项目末尾 10 章，而不是目标章之前的章节。
- 人物和世界观按列表顺序截断，不按本章相关性。
- 数百章纲、人物和设定可能直接推高 Prompt。

#### 3. 修改方式

- Main 新增统一 `ContextAssembler`，输入 `projectId/taskType/targetChapterId/targetPlanningChapterKey/query`。
- 输出结构化 `ContextBundle`，包含 sections、预算、遗漏项和 sourceRevision。
- 选择优先级固定为：作者要求与施工卡、当前卷阶段、相邻章节摘要、相关人物设定、目标时间点事实知识、到期钩子债务、长期摘要、风格与 Obsidian。
- Main 负责数据库查询，纯函数负责筛选、预算和格式化。
- Renderer 不再把全部实体自行拼入 Prompt。
- 分入口切换：Review → 单章 Write → Chat → 批量 Write。
- 批量生成保留作者确认，不强制自动保存；后一章至少接收前一章临时摘要。

#### 4. 涉及文件

新增：

- `src/main/ai/context/context-assembler.ts`
- `src/main/ai/context/context-selector.ts`
- `src/main/ai/context/context-budget.ts`
- `src/main/ipc/ai-context.ipc.ts`
- `src/shared/ai/context-contract.ts`
- `tests/unit/context-assembler.test.ts`
- `tests/unit/context-time-boundary.test.ts`
- `tests/unit/context-budget.test.ts`

修改：

- `src/main/ai/context-builder.ts`
- `src/main/ipc/index.ts`
- `src/renderer/App.tsx`
- `src/renderer/components/AIChatPanel.tsx`
- `src/renderer/components/AIWritePanel.tsx`
- `src/renderer/components/AIReviewPanel.tsx`
- `src/renderer/services/ai-prompts/write.ts`
- 审稿 Prompt 相关文件

#### 5. 可能风险

- 新旧 Prompt 的生成质量可能变化。
- 相关性规则初期可能遗漏重要配角。
- 预算压缩可能排除作者认为重要的资料。
- 一次替换全部入口风险过高，必须逐入口切换。

#### 6. 是否影响已有数据

不影响，只改变 AI 请求时选择哪些数据。

#### 7. 是否需要迁移

不需要额外迁移，依赖 v21～v23。

### 修改 8：长对话滚动摘要

#### 1. 修改目标

线程消息持续增长时，模型输入仍保持有界，同时保留长期讨论结论。

#### 2. 当前问题

当前请求会发送线程全部消息。长期讨论会增加成本并最终超过模型上下文，早期废弃方案也会持续污染后续回答。

#### 3. 修改方式

- conversation thread 增加滚动摘要、摘要截止 sortOrder、摘要 revision 和更新时间。
- 模型输入改为：线程滚动摘要 + 已确认决策 + 最近 N 条消息 + ContextAssembler 项目上下文。
- 超过阈值时只对旧消息生成增量摘要。
- 摘要必须区分已确认、未确定和已废弃内容。
- 摘要失败时降级为有界最近消息，不能恢复发送全量消息。
- 原始消息完整保留，摘要只服务模型上下文。

#### 4. 涉及文件

新增：

- `src/main/ai/conversation-summary.service.ts`
- `tests/unit/conversation-summary.test.ts`
- `tests/unit/conversation-bounded-context.test.ts`

修改：

- `src/main/db/migrations.ts`
- `src/main/db/repositories/conversation.repo.ts`
- `src/main/ipc/conversation.ipc.ts`
- `src/renderer/components/AIChatPanel.tsx`
- 对话 loader 与共享类型

#### 5. 可能风险

- 摘要可能遗漏细节或把建议误写成事实。
- 摘要请求会产生少量模型费用。
- 删除旧消息后需要重算摘要边界。

#### 6. 是否影响已有数据

不删除或修改旧消息。旧线程摘要初始为空，达到阈值后逐步生成。

#### 7. 是否需要迁移

需要迁移 v24，为 conversation thread 增加摘要字段。

### 阶段三验收

- 300 章、上千条事实时，三类 AI 入口均遵守上下文预算。
- Chat、Write、Review 对同一目标章节获得一致的核心事实。
- 第 50 章上下文不包含第 51 章之后的信息。
- 500 条会话消息不会全部发送给模型。
- 摘要失败时仍有明确的有界降级。

---

## 六、阶段四：长期历史与数据恢复

### 修改 9：建立永久里程碑版本

#### 1. 修改目标

同时支持短期误操作恢复和数月级创作版本追踪。

#### 2. 当前问题

- `chapter_history` 只有最近 30 份自动保存快照。
- 两秒自动保存可能快速消耗快照额度。
- 快照没有来源、类型、说明和永久保留标记。
- 人物、世界观和策划没有统一的可恢复历史。

#### 3. 修改方式

- 保留 `chapter_history` 作为短期自动保存环。
- 新增统一 `entity_revisions` 永久里程碑表。
- 首批覆盖 chapter、planning、character、world_entry。
- 记录 revisionKind、label、snapshotJson、contentHash、source、schemaVersion。
- AI 初次生成、审稿应用、润色应用、定稿、手动版本点和恢复前状态进入永久历史。
- 恢复前先创建 `before_restore`，恢复与版本记录处于同一事务。
- 恢复旧策划前展示下游分卷纲/章纲影响，不能静默清空。

#### 4. 涉及文件

新增：

- `src/main/db/repositories/entity-revision.repo.ts`
- `src/main/ipc/entity-revision.ipc.ts`
- `src/shared/entity-revision.ts`
- `tests/unit/entity-revision.test.ts`
- `tests/unit/revision-restore-transaction.test.ts`

修改：

- `src/main/db/migrations.ts`
- `src/main/ipc/index.ts`
- `src/main/db/repositories/chapter.repo.ts`
- `src/main/db/repositories/planning.repo.ts`
- `src/main/db/repositories/entities.repo.ts`
- 对应 IPC 和编辑 UI
- `src/renderer/components/WritingArea.tsx`
- `src/renderer/components/AIReviewPanel.tsx`
- `src/renderer/components/AIPolishPanel.tsx`

#### 5. 可能风险

- Snapshot JSON 随类型升级，需要 schemaVersion。
- 正文永久版本会增加数据库体积。
- 恢复旧策划可能使下游结构失效。

#### 6. 是否影响已有数据

不删除现有历史。旧实体可创建一次“升级基线版本”，但不伪造过去历史。

#### 7. 是否需要迁移

需要迁移 v25，新建 `entity_revisions` 和相关索引。

### 修改 10：跨项目撤销、事务写回与自动备份

#### 1. 修改目标

防止跨项目撤销、半事务更新、保存失败和设备故障破坏长期项目。

#### 2. 当前问题

- Undo 栈没有项目隔离。
- 层级删除后的撤销不能恢复完整父子关系。
- 人物关系修改采用先删除、后创建。
- 润色和部分审稿写回失败时可能仍显示成功。
- 当前只有手动数据库备份。

#### 3. 修改方式

- Undo command 携带 projectId；切项目清空或切换项目专属栈。
- IPC 失败时不移动 undo/redo 栈。
- 层级删除保存父子映射并在 Main 事务内恢复。
- 人物关系改为 Repository 事务更新，并校验两端属于同一项目。
- 润色、审稿回调统一返回 `Promise<boolean>`，数据库成功后才更新编辑器状态。
- 自动备份写入应用专属目录；建议默认保留 7 个每日备份和 4 个每周备份。
- 临时备份通过 SQLite integrity check 后原子更名。
- 从备份恢复前先备份当前数据库。
- 内容 JSON 导出明确标记为“内容导出”，不称为完整备份。

#### 4. 涉及文件

新增：

- `src/main/backup/backup.service.ts`
- `src/main/backup/backup-retention.ts`
- `tests/unit/project-scoped-undo.test.ts`
- `tests/unit/relation-transaction.test.ts`
- `tests/unit/backup-retention.test.ts`

修改：

- `src/renderer/hooks/useUndoManager.tsx`
- `src/renderer/App.tsx`
- `src/main/db/repositories/entities.repo.ts`
- `src/main/db/repositories/outline.repo.ts`
- `src/renderer/components/AIPolishPanel.tsx`
- `src/renderer/components/AIReviewPanel.tsx`
- `src/main/ipc/export.ipc.ts`
- `src/main/index.ts`

#### 5. 可能风险

- 自动备份会占用额外磁盘空间。
- 数据库恢复属于破坏性操作，必须明确确认。
- 旧 Undo 命令需要一次性适配项目归属和返回结果。

#### 6. 是否影响已有数据

日常升级不修改现有数据。自动备份只复制数据库；恢复只有用户明确确认后执行。

#### 7. 是否需要迁移

不需要数据库迁移。

### 阶段四验收

- AI 生成、审稿、润色、定稿版本均可恢复。
- 人物、世界观和策划具有永久里程碑。
- 跨项目 Ctrl+Z 不会污染当前项目。
- 关系更新失败不会丢失旧关系。
- 自动备份通过完整性检查，并完成一次临时环境恢复演练。

---

## 七、迁移总表（原提案，已由第十三节修订）

> 本节保留用于追踪最初方案。迁移号与已批准的 chapter-run Spec 冲突，不能据此施工；正式讨论以第十三节的统一迁移账本为准。

| 迁移 | 内容 | 旧数据处理 | 回滚原则 |
|---|---|---|---|
| v21 | planning revision/schemaVersion | 现有记录默认 revision=0，不改内容 | 移除新字段前需确认无新版本写入；正式环境不建议向下回滚 |
| v22 | 事实时间字段、稳定债务期限 | 确定性回填；旧整数期限保留 | 保留旧字段和旧记录，新查询可临时回退 legacy 模式 |
| v23 | chapter revision/hash、analysis jobs、来源幂等键 | 旧章节 revision=0，不自动触发 AI | 可停用任务处理器，正文与旧派生数据仍可用 |
| v24 | conversation rolling summary | 旧摘要为空，原始消息不变 | 可忽略摘要字段并回退最近 N 条消息 |
| v25 | entity revisions | 可生成当前状态基线，不伪造历史 | 停用里程碑功能不影响业务实体 |

迁移执行要求：

- 每个版本单独事务。
- 先备份真实数据库，再执行升级。
- 使用包含旧数据的数据库副本做迁移回归。
- 迁移失败不得留下部分表、部分字段或版本号。
- 不在迁移期间调用外部 AI。

---

## 八、推荐实施顺序

```text
阶段一
类型/安全门禁
  → 请求级 Provider
  → 单一 PlanningSession

阶段二
叙事时间模型
  → 章节分析任务
  → 钩子债务闭环

阶段三
统一 ContextAssembler
  → 长对话滚动摘要

阶段四
永久版本历史
  → Undo/事务/自动备份
```

每个修改应遵循：先写失败测试 → 最小实现 → 单项测试 → 完整测试 → 构建验证 → 独立提交 → 代码审查。

建议提交边界：每个“修改”至少一个独立提交，不把多个迁移和 UI 改动混在同一提交中。

---

## 九、不纳入本轮

以下内容只有在真实数据和性能指标证明必要时再实施：

- 章节正文懒加载和虚拟列表。
- 对话 UI 分页。
- 项目内向量数据库或独立向量服务。
- planning JSON 全面拆表。
- chapter history delta 压缩。
- 云同步、多人协作、CRDT。
- App 全面拆分。
- 大规模前端代码分包。
- 微服务、云数据库或 ORM 替换。

以下现有设计继续保留：

- Electron + React + SQLite。
- SQLite TEXT 保存正文。
- Repository + IPC + IpcResult。
- 项目 ID + 请求代次隔离。
- WritingArea 防丢保存。
- Creative Decision 单事务确认与 effect 快照。
- Obsidian 单向只读和事务导入。
- AI 流取消机制。

---

## 十、需要开发者共同确认的决策

在执行前，建议逐项确认：

- [ ] 是否同意按四个阶段实施，而不是十项同时开发。
- [ ] 是否同意所有 AI 功能最终统一通过 Main ContextAssembler 获取项目上下文。
- [ ] 是否同意章节分析任务持久化，但默认不自动重抽现有章节，避免产生意外 API 费用。
- [ ] 是否同意钩子、债务、回收和偿还始终先进入 proposal，由作者确认。
- [ ] 是否同意旧债务整数期限不做猜测性自动绑定。
- [ ] 是否同意保留短期 chapter_history，同时新增不自动淘汰的里程碑版本。
- [ ] 是否同意默认自动备份策略为 7 个每日备份 + 4 个每周备份。
- [ ] 是否同意阶段一完成并验收后，再详细拆解阶段二的任务级实施计划。

## 十一、建议的首次执行范围

第一次授权建议只执行阶段一：

1. Renderer 类型与安全门禁。
2. 请求级 AI ProviderConfig。
3. 单一 PlanningSession（原建议含 v21，现由第十二节修订为无迁移）。

阶段一不会改变正文、事实、钩子、债务和历史结构，风险最低，同时为后续长篇叙事模型建立可靠基础。

---

## 十二、联合复核与收敛结论（2026-09-13）

> **结论：** 第二人审查的主要技术校正成立。原文应继续作为路线图和会前材料，不能直接作为十项改造的施工单。首次授权收缩为三个无迁移 P0；新迁移必须先与已经批准的 chapter-run Spec 合并成一份迁移账本。

### 12.1 接受并修正的意见

#### 1. 迁移号必须让位于已批准的 chapter-run Spec

第二人指出的冲突属实：

- 已批准 Spec 已预留 **v21**：`chapters.content_generation`、`chapter_reviews`、`chapter_revision_proposals`。
- 已批准 Spec 已预留 **v22**：`chapter_runs`。
- 原提案不能再把 v21/v22 分配给 PlanningSession 和叙事时间模型。

因此，原文第七节迁移表作废为施工依据。任何新迁移执行前还必须读取当前 `_migrations` 和 `MIGRATIONS`，不能只相信文档预留号。

#### 2. 正文版本只保留 `content_generation`

接受第二人意见：不新增与 `content_generation` 平行的 `content_revision`。

统一语义：

- `content_generation`：规范化正文发生语义变化时递增。
- `normalizeChapterText`：继续采用已批准 Spec 的纯文本比较规则。
- 分析任务：绑定 `source_generation`，可额外保存规范化正文 hash 作为迟到结果校验，但 hash 不是第三套版本号。
- 审稿、自动修订、章节分析、历史恢复共用同一个正文世代。

#### 3. 抽取不挂在两秒防抖保存上

接受第二人意见：章节分析不能由 WritingArea 的两秒防抖自动保存触发。

建议触发边界：

- AI 写章确认保存：默认触发。
- 润色确认应用：默认触发。
- 审稿修订确认应用：默认触发。
- 用户显式保存/点击“同步叙事状态”：触发或按项目设置询问。
- 两秒防抖保存：只保存正文，不触发外部 AI。
- 现有章节升级：不自动重抽。

正文提交优先、分析异步、分析失败不回滚正文。这一点与已批准 chapter-run Spec 保持一致。

#### 4. A5 不是重建，而是兑现后续范围

接受第二人意见，后续任务应改名为：

> **兑现 A5 P2：新增写章 debt 候选，以及既有 hook/debt 的推进、回收、偿还候选。**

既有边界保持不变：

- 非 hook 事实/人物知识仍可自动落库。
- hook、debt、推进、回收、偿还始终进入 `creative_decisions` proposal。
- 作者确认后才投影到正式 hook/debt 表。
- 不把全部事实偷偷改成 proposal。

#### 5. PlanningSession 第一刀不需要数据库乐观锁

接受第二人意见：单人、单窗口桌面应用中，第一刀只统一 Renderer 状态所有权，不增加 `planning_ideas.revision/schema_version`。

第一刀应做到：

- App/项目 session 持有唯一 `PlanningSnapshot`。
- PlanningWorkspace 变为受控组件。
- 保存、锁定、导入成功后更新同一快照。
- AI 入口只读这一份快照。
- 使用内存 operation epoch 防止同项目内旧 AI 结果覆盖新草稿。

数据库乐观锁等出现多窗口、后台并发写入或远程同步需求时再引入。

#### 6. `stages` 的既有产品边界必须保留

原提案将“当前卷和相邻阶段”写进通用 ContextAssembler 优先级，范围过大。

现有定案继续有效：

- `VolumeOutline.stages` 只进入“分卷纲拆章纲”的 Prompt。
- 普通对话、写正文和审稿不直接注入 stages。
- 写正文通过已经生成并固化的章纲施工卡获取阶段级结果。

ContextAssembler 不得借统一上下文之名制造第二份结构真相。

#### 7. 审稿和润色必须分开描述

第二人核对成立：审稿主写回已使用真实 projectId 并检查成功；当前明确存在“失败仍显示已应用”的是润色链路。后续方案不得把二者笼统写成同一个未修问题。

### 12.2 保留的不同意见与折中方案

#### 分歧 1：类型门禁不能以“持续失败”状态存在

同意 Renderer tsc 不应阻挡首次 P0，但不同意“先加门禁、允许历史错误继续存在”作为终态。

原因：一个在 CI/build 中长期允许失败的检查不是门禁，只会形成新的噪声。建议二选一：

1. 首次 P0 只修触达文件中的真实运行时错误，并生成完整类型错误清单，暂不接入强制 build。
2. 独立质量批次清零生产 Renderer 类型错误后，再把 `tsc --noEmit` 设为强制门禁。

不建议维护“预期错误基线脚本”，它会给本项目增加额外机制和维护成本。

#### 分歧 2：分析任务异步，不等于允许产生不可发现的丢任务窗口

同意正文提交与分析执行解耦，也同意分析失败不回滚正文；但必须保证“哪些正文世代尚未分析”可以被确定性发现。

建议折中：

- 正文先成功提交并返回新的 `content_generation`。
- 明确触发分析的入口随后创建持久化任务。
- 如果任务创建失败，UI 明确显示“正文已保存，分析未排队”。
- 通过 `current content_generation` 与最近 completed analysis 的 `source_generation` 比较，能够扫描出缺失分析的章节。
- 启动恢复只恢复已经请求或明确标记需要分析的世代，不擅自为全部旧章节调用 AI。

这样既遵守“正文优先”，也不会把丢失的分析任务永久隐藏。

#### 分歧 3：长期里程碑可以后移，但不是可取消的 B 级优化

同意里程碑不与 P0/P1 抢开发队列，也同意首批只覆盖 chapter + planning；但用户目标明确包含“支持修改历史追踪”，因此它属于目标必需能力，只是实施顺序为 P4，而不是可永久取消的性能优化。

建议定义：

- P0/P1：不实施。
- P4：chapter + planning 永久里程碑。
- 后续真实需求出现时：character + world_entry。
- `chapter_history` 继续承担短期自动恢复，不强制改成 delta。

#### 分歧 4：ContextAssembler 统一的是选择规则，不是全部 Prompt 所有权

第二人担心“全部 Prompt 一次性搬到主进程”是合理的。原提案的目标应进一步限定：

- Main/Repository：负责按项目、目标章节和故事时间查询资料。
- 纯函数 ContextSelector：负责相关性、优先级和 Token 预算。
- `ContextBundle`：返回结构化上下文块及来源诊断。
- Chat/Write/Review：仍拥有各自的任务 Prompt、输出 schema 和交互流程。

因此，ContextAssembler 不应返回一整份不可分解的最终 messages，也不接管审稿/写章业务 Prompt。它只消除三套互相矛盾的数据选择规则。

#### 分歧 5：自动分析默认值应按内容来源区分

“全部默认关闭”会削弱用户要求的自动钩子/债务能力；“所有保存都自动分析”又会造成费用和抖动。

建议默认策略：

- AI 写章确认保存：自动分析开启。
- AI 润色/审稿应用：自动分析开启，因为正文已发生明确、可归因变更。
- 手写显式保存：默认询问或使用项目级开关。
- 防抖自动保存：永不自动分析。
- 旧章节批量补分析：必须由用户明确触发并显示预计数量/成本。

### 12.3 对“故事时间”的具体建议

第二人要求在迁移前钉死插章、拆章、合并章和重排语义，这一要求成立。建议采用：

> **事实事件绑定稳定 `chapter_id`；先后顺序在查询时根据当前 `chapters.sort_order` 解析。**

理由：

- chapterId 在重排后仍稳定。
- 作者移动一章时，发生在该章中的事实应随章节一起移动。
- 不使用标题中的“第 N 章”，避免改名造成时间漂移。
- `created_at` 只代表数据库写入时间，绝不代表故事时间。

需要纯函数测试锁定：

1. 在第 20 章前插入新章，原第 20 章事实随原 chapterId 后移。
2. 把第 50 章移动到第 30 章后，事实生效顺序随章节移动。
3. 拆章时，新章节事实只有作者确认或重新分析后才进入状态。
4. 合并章时，被删除章节的事实不能静默丢失，必须迁移或标记待处理。
5. 重写早期章节并重新抽取时，数据库写入时间不改变它的故事位置。
6. 尚未生成正文的规划章节只使用 planning chapter key，不进入正式运行时事实表。

钩子/债务期限建议优先绑定稳定目标 chapterId；若目标正文尚未创建，则暂存 planning chapter key，创建正文时显式绑定。不要用作者可编辑的标题字符串充当外键。

### 12.4 统一迁移账本（修订建议）

| 顺序 | 迁移 | 内容 | 状态/来源 |
|---|---:|---|---|
| 1 | v21 | `content_generation`、`chapter_reviews`、`chapter_revision_proposals` | 已批准 chapter-run Spec 二期 |
| 2 | v22 | `chapter_runs` | 已批准 chapter-run Spec 三期 |
| 3 | v23 | 叙事时间/as-of 所需字段；具体 DDL 由独立 Spec 锁定 | 本路线图新增，不得先写迁移 |
| 4 | v24 | 通用 `chapter_analysis_jobs`，绑定 `source_generation`；先验证不能仅复用 `chapter_runs.extract_status` | 本路线图新增，依赖 v21/v22/v23 |
| 5 | v25 | conversation rolling summary 字段 | 本路线图新增 |
| 6 | v26 | chapter + planning 的永久里程碑表 | 本路线图新增，P4 |

说明：

- PlanningSession 第一刀无迁移，不再占 v21。
- 不新增 `content_revision`。
- `chapter_runs.extract_status` 继续表示 AI 写章 run 的抽取状态；通用 analysis job 是否独立建表，必须先回答手写、润色、审稿来源如何持久化，避免两张表重复表达同一任务。
- 若最终证明扩展 `chapter_runs` 足以覆盖全部来源，则取消 v24，而不是为了遵守路线图强建新表。
- 上表是讨论预留，不是永久占号；每次执行迁移前以仓库最新 MIGRATIONS 为准。

### 12.5 收敛后的实施顺序

```text
P0（第一次授权，无迁移）
1. 请求级 Provider 快照
2. App 持有唯一 PlanningSnapshot，PlanningWorkspace 受控
3. AI 预览禁止原始 HTML 注入

P0.5（独立质量/安全轨，不挡 P0）
4. 修复真实 Renderer 运行时类型 bug，并形成错误清单
5. 清零生产 Renderer 类型错误后启用强制 tsc
6. CSP / IPC 白名单按独立安全任务实施

既有批准计划
7. chapter-run 二期 v21
8. chapter-run 三期 v22

P1（先独立设计，再编码）
9. 故事时间语义与 as-of 纯函数测试
10. v23 叙事时间迁移
11. 写章/审稿/对话显式传目标章节

P2
12. 分析任务持久化与恢复策略
13. 兑现 A5 P2：debt + hook/debt 更新候选

P3
14. ContextAssembler 按 Review → 单章 Write → Chat → 批量逐步切换
15. 同步收口 A4b：工具栏代写/批量不再错误读取 outline_nodes

P4
16. 长对话滚动摘要
17. chapter + planning 永久里程碑
18. Undo 项目隔离、关系事务、润色成功门禁、自动备份分别实施
```

### 12.6 首次授权范围的最终建议

同意第二人的首次授权范围，只做三个无迁移修改：

1. 请求级 Provider。
2. 策划受控单一快照，不加数据库 revision。
3. AI 预览改为安全文本/受控渲染。

首次授权明确不包含：

- v21 及后续迁移。
- Renderer 全量类型清零。
- CSP 与 IPC 白名单。
- ContextAssembler。
- 叙事时间模型。
- 分析任务。
- 历史与自动备份。

### 12.7 会上建议拍板的最终问题

- [ ] 是否确认首次授权只有三个无迁移 P0。
- [ ] 是否确认 v21/v22 继续归已批准 chapter-run Spec。
- [ ] 是否确认正文版本统一使用 `content_generation`，不新增 `content_revision`。
- [ ] 是否确认分析不挂防抖保存，AI 写章/润色/审稿确认应用默认触发。
- [ ] 是否确认事实/知识沿用 A5 自动落库，hook/debt/回收/偿还走 proposal。
- [ ] 是否确认运行时故事时间绑定 chapterId，并按当前 sortOrder 查询。
- [ ] 是否确认 ContextAssembler 只统一数据选择和预算，不接管各业务 Prompt。
- [ ] 是否确认 stages 继续只服务拆章纲，不直接进入普通对话/写正文/审稿。
- [ ] 是否确认里程碑为 P4 必需能力，首批只覆盖 chapter + planning。
- [ ] 是否确认阶段二必须先单独写《叙事时间模型设计》，通过后再确定 v23 DDL。

---

## 十三、第二人审查意见原文（2026-09-13）

> **性质：** 对照 2026-09-13 HEAD 代码、A1–A6 结案文档、以及已批准的 `docs/superpowers/specs/2026-09-10-chapter-run-review-ledger-design.md` 做的独立审查。下文不修改正文提案，只标出同意、反对和待两人拍板的分歧，供继续讨论。
>
> **一句话：** 同意按阶段做，不同意整包授权。真正该立刻拍板的不是十项改造，而是三件事：叙事时间点、请求级 AI 配置、策划只留一份快照。

### 13.1 总评

这份讨论稿把「50 万字生产」真正卡在语义一致性上，而不是 SQLite 容量，这一点成立。不重写、不拆微服务、Obsidian 只读、账本确认权在作者——这些约束应视为合同。

质量上，这是**中上讨论稿 / 偏大路线图**：有约束、有不选方案、有迁移回滚原则、有「不纳入本轮」。按仓库 writing-plans 的粒度，阶段二单独就该是一份可执行计划。现在这样发给执行者，容易再次变成十项同时开发。

**建议用法：** 当会前材料，不当施工单。先改文档（迁移号、世代 vs 分析 hash、抽取异步边界、A5 范围），再授权编码。

### 13.2 对照代码后，正文真正看对了什么

以下主张已用代码核对，**属实**，讨论时应保留：

1. **瓶颈是时间语义。** 事实按 `created_at` 排序；钩子上下文用 `MAX(sort_order)` 当「当前章」；写章 `getContext` 取全书 `draft|final` 末尾 10 章，不是目标章之前。重写第 20 章时模型会看到第 21 章之后的世界。`reduceNarrativeStateAsOf()` 是全文最有价值的提案。
2. **全局 `aiService.configure()` 是真 bug。** 写章/审稿/润色用 `display:none` 保活；Chat、Write、Review、Polish、策划、起名、ContextPanel 都会改同一份可变配置。M2 只修了 Provider 缓存键，没修这个。
3. **策划仍是双轨。** A3 已做成每项目一行 + 读改写合并，A4a 也让对话读 `planningSnapshot`。但 `App.tsx` 与 `PlanningWorkspace.tsx` 仍各自 `loadPlanning`。问题不是「完全没有协调」，而是 UI 真相还没焊死。
4. **抽取不是生产流水线。** 只有 AI 单章保存后 fire-and-forget；手写、润色、审稿、批量都不走同一条路；没有 revision/hash；重启丢任务。
5. **对话发送线程全部消息**，`ContextBuilder.getConversationSummary` 存在但 App 未传入 `recentMessages`。
6. **`chapter_history` 每章 30 份**；人物/世界观/策划无统一历史。
7. **Undo 无项目隔离**；人物关系先 `remove` 再 create；备份目前只有手动菜单项。
8. **AI 预览** `AIWritePanel` 使用 `dangerouslySetInnerHTML`；CSP 含 `'unsafe-inline'`；preload 接受任意 IPC channel。
9. 最新迁移是 **v20**；`planning_ideas` 尚无 `revision` 字段。

### 13.3 正文写成缺口、但 HEAD 已经具备的能力

讨论时请从 2026-09-13 的 HEAD 起算，不要从 9 月 12 日审查报告原文复制缺口清单：

| 已落地 | 说明 | 正文容易误读成 |
|---|---|---|
| A1 | 写章 `create` 同步返回 id，弃 sortOrder 猜章 | 落库仍不可靠 |
| A2 / `shouldApplyPlanningResult` | 策划长任务完成后校验项目 | 策划结果会串项目 |
| A3 / v20 | `UNIQUE(project_id)` + 读改写合并 | 策划多行、静默变空 |
| A4a | 普通对话读策划，有策划时跳过 `outline_nodes` | 讨论完全不读总纲 |
| A4b（部分） | 策划入口代写 + 审稿读章纲 | 所有生成入口都不读章纲 |
| A5 | 写章 hook → `creative_decisions` proposed；非 hook 仍自动落库；**写章不抽债务是刻意 P2** | 「钩子/债务闭环尚未完成」 |
| A6 | 去掉 7 天过期，仍留每章 30 份 | 历史策略完全没改 |
| M1 / M2 | `systemPrompt` 合并；缓存键含 baseUrl + 完整 apiKey | Provider 全未修 |
| M3 | 审稿用真实 projectId，写回校验 `success` | 审稿/润色失败都显示成功（润色仍成立，审稿已修） |
| 流取消一期 | `stream-registry` + `ai:cancelStream` | 正文「九、不纳入」已正确保留，不要再当缺口 |
| 决策账本 v18/v19 | 提议 → 确认 → 单事务投影 | 账本还没接上 |
| stages 拆章注入 | 只进拆章 prompt，写正文/普通对话故意不采纳 | Assembler 优先级列表未写这条产品边界 |
| 工作区 P0–P3 | 停靠/主题/分隔条；写章审稿润色仍浮动 | 生产架构主线不必重开 dock |

**A4b 仍未收口：** 工具栏代写/批量仍读 `outline_nodes`。这是阶段三 Assembler 验收的暗坑，不是「大纲权威从未收敛」。

### 13.4 硬伤：不能带着这些问题开工

#### 硬伤 1：迁移号与已批准 Spec 冲突

`2026-09-10-chapter-run-review-ledger-design.md`（已批准，一期已落地，二/三期未实施）规定：

- 二期 **v21**：`chapters.content_generation` + `chapter_reviews` + `chapter_revision_proposals`
- 三期 **v22**：`chapter_runs`

本讨论稿把 v21 给了 `planning_ideas.revision`，v22 给了事实时间字段。仓库不能两套账本并行。A1–A6 刚吃过「v20 已被占用」的亏。

**待拍板：** 规划类字段往后顺延；`content_generation` / 审稿表优先占用下一个空号，因为它们已经是批准设计，不是讨论稿。

#### 硬伤 2：正文版本语义会再分叉

审稿 Spec 明确废弃「对原始 HTML 做 SHA」，改用 `content_generation` + `normalizeChapterText`（纯文本变了才 +1）。本计划又引入 `content_revision` + `content_hash`，且「正文成功变更即递增」。

两套版本号会让「这份审稿过期了吗 / 这份分析结果过期了吗」永远说不清。

**第二人建议：**

- **世代**：给审稿/修订过期用（已批准的 `content_generation`）
- **分析任务**：挂在世代上，用规范化文本 hash 做迟到结果门禁
- 不要再发明第三种 `content_revision`

#### 硬伤 3：「正文、历史、分析任务同一事务」与已批准合同相反

审稿 Spec 写死：正文优先，抽取异步，抽取失败不回滚正文（C2：不重写 TipTap 保存状态机）。本计划修改 5 把 pending 分析任务和正文放进同一事务。

2 秒自动保存如果入队，即使用 merge，也会把分析系统变成费用和抖动源。作者停在半句上，不该触发抽钩子。

**第二人建议：** 分析任务在明确成功的内容变更之后入队——AI 写章保存、润色确认、审稿应用、用户显式保存。不要挂在防抖自动保存上。

#### 硬伤 4：把 A5 写成「钩子闭环未建」

修改 6 应写成：**兑现 A5 的 P2（写章 debt）+ 既有 hook/debt 的推进/回收候选**。不要让读者以为账本还没接上。

修改 5 写「摘要、事实、知识和决策候选在一个事务内写入」。若事实也改成一律 proposal，就是扩大 A5 已拍板范围，必须单独立项，不能夹带。

**第二人建议：** 事实/知识继续按 A5（非 hook 可自动落库）；hook/debt/回收/偿还始终先 proposal。

#### 硬伤 5：阶段一把工程卫生和领域架构捆在一起

| 类型 | 例子 | 是否挡 50 万字生产 |
|---|---|---|
| 真 XSS 向量 | AI 预览 `dangerouslySetInnerHTML` | 挡安全，不挡叙事正确性 |
| 真串台 bug | 全局 `configure()` | 挡生产，会发错模型 |
| 领域焊管 | PlanningSession | 挡生产，会读错纲 |
| 工程卫生 | Renderer tsc、IPC 白名单、CSP 收紧 | 该做，但会炸出大量历史类型问题 |

IPC 白名单对本地 Electron 是纵深防御，不是阻塞项。API 密钥已经在渲染进程里，真正危险的是 AI HTML 在页面里执行。阶段一若只能做一件安全项，做预览改文本节点。

`planning_ideas.schema_version` 偏早。目标对照评估 B4：需要按阶段查询或部分更新时再加。现在没有拆表计划，这个字段几乎没用，却占一次迁移。

### 13.5 分阶段意见

#### 阶段一

同意做，但要拆波。

- **请求级 Provider：必做。** 实现要小：`chat/chatStream` 每次带完整快照，删掉全局 `currentProvider`。不必同时删除各面板重复预设——那是目录整理，容易引入 baseUrl 回归。
- **单一策划快照：必做。** 第一刀不要做成带 `expectedRevision` 的完整会话框架。当前是单人桌面、没有多端写入。足够的是：App 拥有唯一 `PlanningSnapshot`；`PlanningWorkspace` 变成受控组件；AI 入口只读这一份。乐观锁可以后置——单人应用里 revision 冲突几乎不会发生，却会让长任务「生成完发现版本变了」的处理复杂一倍。
- **类型门禁：同意加 `tsc --noEmit`，但不要把「修光历史类型错误」当成阶段一验收。** 先让门禁存在，只修真实 bug（例如 `ai.service.ts` 块外使用的 `now`），其余用清单跟踪。
- **AI 预览禁止注入 HTML：必做，无迁移。**

#### 阶段二

全文最该做，也最需要先写独立 Spec。顺序「时间模型 → 分析任务 → 钩子债务扩展」对。

完全同意的条款：状态型事实按目标章之前最后一条；人物知识用 `learned_at_chapter_id` 做 as-of；钩子/债务接口必须显式接收目标章；旧债务整数期限不做猜测映射。

**正文没写透的坑：章节重排。** `sort_order` 一变，as-of 结果会变。必须先定义「故事时间」绑在稳定 chapter id 的顺序上，还是作者可见的章号。插章、拆章、合并章时 reducer 怎么表现，要在写迁移前用纯函数测试钉死。

分析任务支持可恢复、幂等、迟到结果用 hash/世代作废，但默认必须：

- 现有章节不自动重抽（正文已写，保留）
- 自动分析默认关闭，或仅 AI 落库触发
- 绝不挂 2 秒防抖保存
- 事实/知识继续按 A5

分析任务应显式依赖（或声明取代）chapter-run Spec 的二/三期，不要两份「已批准/讨论中」并行。

#### 阶段三

同意作为终态，必须等时间模型落地。没有 as-of，Assembler 只会把错误上下文包装得更一致。

两处摩擦：

1. 审稿 Spec 写过「不把全部 prompt 一次性搬到主进程」。Assembler 放 Main 可以，必须逐入口切（正文已写）。不要第一周替换 Chat+Write+Review。
2. 工具栏代写/批量仍读 `outline_nodes`。Assembler 如果仍给批量喂大纲面板，验收「三类入口核心事实一致」会假通过。要么先做 A4b 收口，要么验收时把批量单独标为未切。
3. 卷内 `stages` 目前只进拆章。Assembler 优先级列表需补上这条产品边界。

长对话滚动摘要值得做，优先级低于写章上下文正确性。对话聊偏很烦，写章串章会直接脏书。

#### 阶段四

方向对，但是 **B 级**（对应目标对照评估 B5/B11），不要和焊管抢队列。A6 已经去掉 7 天过期，30 份上限是产品取舍。作者现在更痛的是「AI 用了未来章的事实」，不是「三个月前的人设找不到」。

Undo 项目隔离、关系事务更新、润色 `success` 门禁、自动备份都是真问题，但是**数据安全轨**，不是 AI 生产轨。润色写回失败仍 `setApplied(true)` 属实；审稿已经校验 `success`，不要捆在一起写。

自动备份 7 日 + 4 周合理；恢复前先备份当前库也对。不要和 `entity_revisions` 绑成一个修改。首批里程碑建议只做 chapter + planning，人物/世界观第二波。

### 13.6 第二人建议的实施顺序（供对照原文第八节）

```text
P0  请求级 Provider（修串台）
P0  策划单一快照（先受控，暂不加 revision 乐观锁）
P0  AI 预览禁止注入 HTML

P1  叙事时间模型 + as-of 查询（纯函数先行）
P1  写章/审稿/对话显式传目标章，去掉 MAX(sort_order)

P1.5 与 chapter-run Spec 合并迁移账本
     content_generation / 审稿账本 按已批准设计走
     分析 jobs 挂世代，不另造 content_revision

P2  分析任务队列（默认不自动、不挂防抖保存）
P2  写章 debt + hook/debt 更新候选（兑现 A5 P2）

P3  ContextAssembler，按 Review → 单章 Write → Chat → 批量 切换
    同时收口 A4b：批量不再读 outline_nodes

P4  对话滚动摘要
P4  章节+策划里程碑（人物/世界观可第二波）
P4  Undo 隔离 / 关系事务 / 自动备份 / Renderer tsc
```

类型门禁、CSP、IPC 白名单可以穿插在任何空档做，**不要挡 P0/P1**。工作区 P0–P3 是 UI 轨，一句带过即可；阶段一改主题脚本时别打坏 P1 防闪白。

### 13.7 对第十节决策清单的表态

| 原文决策 | 第二人意见 |
|---|---|
| 按四个阶段，不十项同时开发 | **同意**，但阶段一要再拆波；阶段四不要和阶段二抢 |
| 所有 AI 最终走 Main ContextAssembler | **同意作为终态**，不同意阶段一就迁；批量入口要先解决读哪份纲 |
| 分析任务持久化，旧章不自动重抽 | **同意**；再加一条：不挂 2 秒自动保存，默认关闭或仅 AI 落库 |
| 钩子/债务/回收始终先 proposal | **同意**；事实/知识保持 A5，不要偷偷改成一律候选 |
| 旧债务整数期限不猜测绑定 | **完全同意** |
| 保留 30 份自动环 + 不淘汰里程碑 | **同意方向**，首批只做 chapter + planning |
| 默认 7 日 + 4 周自动备份 | **同意**，单独做，不要塞进历史表迁移 |
| 阶段一完成后再拆阶段二任务计划 | **同意，这是最重要的一条** |

### 13.8 第二人建议的首次授权范围（供对照原文第十一节）

第一次授权只做 P0 三件：

1. 请求级 Provider（必做，无迁移）
2. 策划受控单一快照（必做；若只为 `revision` 乐观锁则暂缓 v21）
3. AI 预览安全（必做，无迁移）

Renderer tsc / CSP / IPC 白名单作为 1b，不挡 1a 验收。

阶段一仍不应改变正文、事实、钩子、债务和历史结构。

### 13.9 建议会上先拍板的分歧（在第十节之外）

请两人逐项勾选：

- [ ] 迁移号：chapter-run Spec 的 v21/v22 优先，本讨论稿的 planning revision / 事实时间字段顺延。
- [ ] 正文版本：沿用已批准的 `content_generation` + `normalizeChapterText`；分析任务挂世代 + 规范化 hash；不新增 `content_revision`。
- [ ] 抽取边界：继续「正文优先、抽取异步、失败不回滚正文」；分析任务不与 WritingArea 防抖保存同一事务。
- [ ] A5 范围：非 hook 事实/知识仍可自动落库；写章抽债务是兑现 P2，不是「钩子闭环未建」。
- [ ] PlanningSession 第一刀只做受控单一快照，不加 `expectedRevision`。
- [ ] 阶段一安全项：P0 只修 `dangerouslySetInnerHTML`；tsc/CSP/IPC 白名单不挡 P0 验收。
- [ ] 分析入队触发：仅 AI 写章保存 / 润色确认 / 审稿应用 / 用户显式保存；默认不自动重抽、不挂 2 秒保存。
- [ ] ContextAssembler 验收：批量入口要么先收口 A4b，要么标为未切，避免假通过。
- [ ] 永久里程碑首批只覆盖 chapter + planning。
- [ ] 工作区停靠与本架构分轨，本轮不重开 dock。

### 13.10 若讨论收敛后的下一步

不要整包开写代码。先出一份更短的《阶段一修订稿》：只含 Provider 快照、策划单一快照、AI 预览安全，并附上与 chapter-run Spec 的迁移号对照表。阶段二（叙事时间模型）单独成 Spec，再拆实施计划。

---

## 十四、第二人对联合复核的再答复（2026-09-13）

> **读法：** 第十二节是原提案作者对第十三节的收敛。本节是第二人读完第十二节之后的再答复。12.1 的七条校正全部接受，不再争论。下面只写：**接受了什么、仍不同意什么、建议会上多拍的几条。**
>
> **对第十二节的总评：** 这是一次合格的技术收敛。迁移号、世代、A5、stages、策划第一刀无迁移、首次只授权三件 P0——这些已经够开会开工。剩下的分歧不再是「方向错了」，而是「会不会把已批准的大功能插到关键路径上」和「几个默认值会不会在真实写作里抖」。

### 14.1 接受第十二节的哪些判断

| 第十二节条款 | 第二人态度 | 说明 |
|---|---|---|
| 12.1.1 迁移号让位于 chapter-run Spec | **接受** | 这是硬伤，原文第七节继续只作考古。 |
| 12.1.2 只保留 `content_generation` | **接受** | hash 只做迟到结果校验，不是第三套版本号。 |
| 12.1.3 分析不挂两秒防抖 | **接受** | 与已批准 Spec「正文优先」对齐。 |
| 12.1.4 兑现 A5 P2，不重建账本 | **接受** | 事实/知识不改成一律 proposal。 |
| 12.1.5 PlanningSession 第一刀无 DB 乐观锁 | **接受** | 内存 operation epoch 可以，但应复用现有项目守卫/代次模式，不要第三套 generation。 |
| 12.1.6 stages 只进拆章 | **接受** | 比第十三节写得更清楚，应按此锁进 Assembler 合同。 |
| 12.1.7 审稿与润色分开描述 | **接受** | |
| 12.2 分歧 1：类型门禁不要以持续失败状态存在 | **改口接受** | 第十三节「先加门禁、历史错误继续红」确实更差。P0 只修真实运行时错误并出清单；强制 `tsc` 等独立质量批次清零后再开。不维护预期错误基线脚本。 |
| 12.2 分歧 3：里程碑是 P4 必需，不是可取消优化 | **接受命名** | 第十三节说「B 级」只表示不与 P0/P1 抢队列，不是主张永久砍掉。同意写成「P4 目标必需，首批 chapter + planning」。 |
| 12.2 分歧 4：Assembler 只统一选择规则，不接管 Prompt | **接受，且比第十三节更好** | 这是正确边界。补充一条合同：Renderer 拿到 `ContextBundle` 后，**不得再把人物/世界观/大纲全表拼进 Prompt**，否则又是双份真相。 |
| 12.3 故事时间 = 稳定 chapterId + 查询时按当前 sort_order | **接受** | 六条纯函数测试应成为 P1 Spec 的验收骨架。 |
| 12.4 先验证能否复用 `chapter_runs`，不预建 v24 | **接受流程** | 先回答问题再占号，对。 |
| 12.6 首次授权三件无迁移 P0 | **维持同意** | 可以按这个授权，不必再等本节余下分歧。 |

### 14.2 仍不同意或需要收窄的点

#### 分歧 A：不要用「世代不等」当作「缺分析」的唯一扫描条件

12.2 分歧 2 的目标成立：异步不等于任务可以失踪。UI 必须能说「正文已保存，分析未排队」。

但建议的扫描方式——比较 `current content_generation` 与最近 completed analysis 的 `source_generation`——和已批准的世代语义打架。

已批准 Spec：`content_generation` 在**手工保存**且规范化正文变化时也会 +1。WritingArea 两秒防抖只要写出了不同纯文本，就是一次手工保存。结果是：

- 审稿过期：应当跟世代走（作者改了一个标点，旧修订就不能再盖）。这一点保持。
- 缺分析扫描：若也跟世代走，手写中的章节会一直显示「未分析」，自动补队列会绕回「防抖触发分析」这条已经否决的路。

**第二人建议：** 审稿新鲜度和分析请求是两条信号。

- `content_generation`：只回答「这份审稿/修订是不是针对当前正文」。
- 分析是否该做：只看**显式请求记录**（job 行，或 `analysis_requested_generation`）。创建失败时写「未排队」；启动恢复只扫这些请求，不扫全部世代缺口。
- 禁止从「世代变了」推断「需要花 API 去抽钩子」。

这反而支持 12.4 的谨慎：不要把「缺分析」折叠成 `chapter_runs.extract_status` 或世代差值；分析请求需要自己的记录。第二人更倾向**独立 `chapter_analysis_jobs`**，而不是扩展 `chapter_runs`。理由：`chapter_runs` 的身份是「一次 AI 写章运行」（草稿、是否已提交、`retry_of_run_id`）。手写、润色、审稿应用不是一次写章运行。硬塞进去会变成大量可空列。可以在 P2 Spec 里用一张对照表否决或证实这一点，但默认假设应是分表。

#### 分歧 B：完整 chapter-run 二期/三期不应挡在 P1 前面

12.5 把顺序写成：P0 → P0.5 → **chapter-run v21 → v22** → 然后才做故事时间 as-of。

这是本节最重要的剩余分歧。

- as-of 只需要稳定 `chapter_id` + 当前 `sort_order`。它**不依赖**审稿两表、不依赖 `chapter_runs`，也不依赖 `content_generation`。
- 已批准的 v21 不是「加一列」：它包含审稿 prompt/解析/三态/evidence/两张表和 UI。按这份 Spec 做完，足够单独占用一轮开发。
- 若把完整二/三期插在 P0 和 P1 之间，最可能的结果是：花两周做审稿账本，而重写第 20 章仍然读到第 21 章之后的事实。这正是 50 万字当前最痛的事。

**第二人建议的关键路径：**

```text
P0 三件（无迁移）          ← 现在可授权
P1 叙事时间 as-of          ← 不依赖 v21/v22
chapter-run 二期/三期      ← 平行产品轨：审稿质量与写章运行单
P2 分析 jobs               ← 若需要 source_generation，再 thin-slice 加列
```

若 P2 分析 jobs 那时仍没有 `content_generation`：允许一次**薄迁移**只加这一列和 `normalizeChapterText` 递增规则，**不**把审稿两表和 UI 绑进来。不要为了「v21 已经批准」就把整期审稿账本当作 P1 的前置。

已批准 Spec 仍然有效，只是不要写进本路线图的关键路径。两份计划并行时，迁移号仍以仓库 `MIGRATIONS` 为准，谁先落地谁占下一个空号。

#### 分歧 C：手写显式保存不要默认弹窗询问

12.2 分歧 5 按来源区分默认值，方向对。AI 写章/润色/审稿确认应用默认开分析，等于把**今天已经在花的钱**变成可恢复，不是新开销。防抖永不分析，旧章批量补抽必须显示数量/成本——这些都接受。

不接受的是「手写显式保存：默认询问」。Ctrl+S 或工具栏保存每次弹「要不要同步叙事状态」，会训练作者点「否」，或打断手写节奏。

**第二人建议：**

- 项目级开关：`手写保存后分析`，默认关。
- 显式按钮：「同步本章叙事状态」。
- 不要每保存一次 modal。
- 润色/审稿默认开可以，但必须靠 job 幂等挡住重复提案：同章同世代、规范化后相同的 hook/debt 不得再堆一条 proposed。否则改两个错别字的润色会制造重复钩子。

#### 分歧 D：P0 的 Provider 改造必须覆盖全部 `configure()` 调用点

第十二节写 Chat/Write/Review/Polish。当前代码里还会 `configure()` 的有：

- `PlanningWorkspace.tsx`
- `NameGenerator.tsx`
- `ContextPanel.tsx`

这三处不迁，串供应商 bug 还在。P0 验收应是：**删除全局可变配置后，全仓不再调用 `configure()`**，而不是只改四个 AI 面板。P0 仍然不要顺手做「预设目录大搬迁」。

#### 分歧 E：P0 策划快照必须写死 AI 读哪一份

12.1.5 解决了所有权，没解决「未保存草稿」。两种都合法，不能默默混用：

1. AI 只读**上次成功落库**的快照；策划页有未保存更改时给横幅。长任务和导入规则简单。
2. AI 读**含未保存草稿**的当前编辑态。作者改一句马上进对话，但要处理「生成到一半草稿又改了」。

**第二人建议选 1。** 单人桌面里，未保存就让模型看见，会让 A2 的「长任务结束校验」更难解释。若会上选 2，必须把草稿 revision/epoch 写进 AI 请求快照。

#### 分歧 F：删章、并章时的孤儿事实要在 P1 Spec 写死

12.3 第 4 条写了合并章不能静默丢失，很好。建议 P1 Spec 再钉两条，否则 as-of 测试集不完整：

- **删章：** 绑定该 `chapter_id` 的事实/知识/钩子期限不得级联删除。标记未绑定或待迁移，查询时排除出 as-of，并在 UI 提示「有 N 条叙事状态失去章节」。
- **sort_order 并列：** as-of 比较必须是全序，建议 `(sort_order, id)`，避免同序时事实时而算「之前」、时而算「之后」。

规划章 key 在正文 `create` 成功返回 id 的**同一次用户动作**里绑定，不要再丢给后台 job（与 A1 同步返回 id 一致）。

### 14.3 对 12.5 实施顺序的修订建议

接受 P0 三件和 P0.5 质量轨分列。不接受把完整 v21/v22 写在 P1 前面。建议改成：

```text
P0（第一次授权，无迁移）
1. 请求级 Provider 快照（含策划/起名/ContextPanel，删掉 configure()）
2. App 持有唯一已保存 PlanningSnapshot，PlanningWorkspace 受控
3. AI 预览禁止原始 HTML 注入

P0.5（独立质量/安全轨，不挡 P0 也不挡 P1）
4. 真实 Renderer 运行时类型 bug + 完整错误清单
5. 清零后再强制 tsc
6. CSP / IPC 白名单

P1（先独立设计，再编码；不依赖审稿账本）
7. 故事时间语义与 as-of 纯函数测试（含插章/移章/拆章/并章/删章/全序）
8. 叙事时间迁移（当时下一个空号，不预标 v23）
9. 写章/审稿/对话显式传目标章节，去掉 MAX(sort_order)

平行产品轨（不插入 P0→P1）
10. chapter-run 二期：审稿版本账本
11. chapter-run 三期：写章运行单
    若谁先落地，谁占用当时下一个迁移号

P2
12. 分析请求可发现、可恢复；默认按来源触发；独立 job 表除非 Spec 证明可干净复用 chapter_runs
13. 兑现 A5 P2

P3
14. ContextAssembler（Bundle，不接管业务 Prompt；Renderer 不得再拼全表）
15. 收口 A4b

P4
16. 滚动摘要
17. chapter + planning 里程碑
18. Undo / 关系事务 / 润色成功门禁 / 自动备份分提交
```

### 14.4 会上建议在 12.7 之外再拍的问题

12.7 前九条第二人可以勾同意（里程碑 P4 必需、Assembler 不接管 Prompt、stages 只拆章、v21/v22 号仍归 chapter-run Spec）。需要额外拍板的是：

- [ ] P1 as-of **不**以完整 chapter-run 二期/三期为前置；审稿账本走平行轨。
- [ ] 「缺分析」只扫显式请求，不扫世代差值；两秒防抖造成的世代变化只让审稿过期，不自动排队抽钩子。
- [ ] 手写保存用项目级开关 +「同步本章」按钮，不每保存弹窗。
- [ ] P0 Provider 覆盖全部 `configure()` 调用点，包括策划、起名、ContextPanel。
- [ ] P0 的 AI 只读已保存策划快照，不读未保存草稿。
- [ ] P1 Spec 必须包含删章孤儿状态和 `(sort_order, id)` 全序。
- [ ] P2 默认按「独立 analysis job 表」设计；只有写清手写/润色/审稿如何映射后，才允许取消分表、扩 `chapter_runs`。

### 14.5 对「现在能不能开工」的判断

**能授权 P0，且应该现在授权。** 第十二节 12.6 与第十三节 13.8 已经对齐，本节 14.2 的剩余分歧都不挡这三件。

**不能授权阶段二。** 即便 14.2 全部按第二人意见勾选，P1 仍要先有《叙事时间模型设计》，不能从本讨论稿直接写迁移。

**不要在 P0 做完后默认去实现 chapter-run 二期。** 那是另一份已批准 Spec，应单独授权；否则本路线图的「先修串章」会被审稿账本挤出队列。

---

## 十五、第三人对收敛结果的独立意见（2026-09-13）

> **读法：** 前十四节是两位开发者的多轮收敛，方向与事实基础都已核过。本节是第三人对照 2026-09-13 HEAD 代码的独立核对，只补「两位都没写透」的点，不推翻已收敛的结论。

### 15.1 已核对、两位都看对的事实

- 全局 `aiService.configure()` 是真串台 bug，**8 个文件**调用（AIChat/AIWrite/AIReview/AIPolish/ContextPanel/NameGenerator/PlanningWorkspace）。第二人分歧 D 点名的策划/起名/ContextPanel 三处属实，P0 必须覆盖全部 8 处，不是 4 个 AI 面板。
- `AIWritePanel.tsx:1084` 把 AI 流式输出 `generatedContent` 直接 `dangerouslySetInnerHTML` 注入，是真 XSS 向量。审稿/润色**无** innerHTML 注入，所以 P0 安全项实际只这一处，比「AI 预览」笼统说法更聚焦。
- 最新迁移 v20，`planning_ideas` 无 revision，与两位判断一致。

### 15.2 两位没写透的三个点（建议补进最终结论）

#### 补 1：`RichEditor.tsx` 的 `configure` 是 TipTap 扩展的 `configure`，不是 `aiService.configure`

讨论稿和第二人都把「`configure()` 调用点」列成串台隐患，但 `src/renderer/components/editor/RichEditor.tsx:70` 的 `Placeholder.configure(...)` 是 **TipTap Extension 的 `configure()`**，和 `aiService.configure()` 完全无关。P0 验收「全仓不再调用 `configure()`」时，**必须排除 TipTap 扩展的 `configure`**，否则会误伤编辑器，或者因为「RichEditor 还调用 configure」而误判 P0 没做完。

建议 P0 验收措辞精确为：**删除 `aiService.configure` 全局可变状态后，全仓不再有 `aiService.configure(...)` 调用**，而不是「不再有 configure」。

#### 补 2：P0 的 Provider 快照改造，会顺带触动「Provider 缓存键」已修过的 M2

A1–A6 里 M2 已让 `ProviderFactory` 缓存键含 baseUrl + 完整 apiKey。P0 改成请求级快照后，缓存语义要从「全局单例 + 失效重建」变成「按请求配置键取缓存」。这是 P0 Provider 改造里**隐藏的第二个改动点**，两位在讨论里只聚焦了「删全局 configure」，没提 `ProviderFactory` 缓存层要不要跟着从「单例缓存」改成「按 AIRequestConfig 键缓存」。

建议 P0 计划单独写一句：请求级配置落地后，`ProviderFactory.create` 的缓存是否仍按旧 `providerCacheKey` 走、还是要换成按完整 `AIRequestConfig` 快照键缓存——避免 P0 做完出现「配置对了、Provider 实例还是旧的」的隐性 bug。

#### 补 3：「缺分析扫描」与「审稿新鲜度」分离（分歧 A）是对的，但落地时要注意 `content_generation` 还未存在

分歧 A 和第二人都正确指出「不能用世代差值推断需要分析」。但这里有个时序陷阱：**`content_generation` 列是 chapter-run 二期 v21 才加，现在（v20）还没有**。所以「P2 分析 jobs 绑定 `source_generation`」这条，实际依赖一个尚不存在的列。

第二人 14.2 分歧 B 已经提出「若 P2 时还没有 content_generation，允许一次薄迁移只加这一列」——这个判断是对的，但建议**在 P0 就把它钉死**：P2 的薄迁移只加 `content_generation` + `normalizeChapterText` 递增规则，**不绑审稿两表**，避免又出现「v21 已经批准」就整期前置的老问题。这个点其实第二人已经说了，我只是强调它是 P0 之后立刻要面对的时序依赖，值得在 P0 验收清单里留一行提醒。

### 15.3 对 P0 三件的独立表态

| P0 项 | 第三人态度 |
|---|---|
| 请求级 Provider 快照 | **同意，且同意分歧 D 覆盖全部 8 处**；补：缓存层语义要一起定（见补 2） |
| 策划受控单一快照 | **同意，第一刀无 DB 乐观锁**；补：分歧 E 的「AI 只读已保存快照」选 1 是对的，未保存草稿用横幅提示，不混进 AI 请求 |
| AI 预览禁止 HTML 注入 | **同意，且只聚焦 AIWritePanel 一处** `dangerouslySetInnerHTML`；审稿/润色无此问题 |

### 15.4 结论

前十四节的收敛**合格，可以作为会议材料定稿**。第三人不推翻任何已收敛结论，只补三处「精确措辞 + 时序依赖」：

1. P0 验收「不再调用 configure」要排除 TipTap 的 `Extension.configure`。
2. P0 Provider 改造要连缓存层语义一起定（请求级键 vs 旧单例缓存）。
3. `content_generation` 是 v21 才有的列，P2 的薄迁移时序要在 P0 就钉死，避免「v21 已批准」再次被误当前置。

这三条都不改变「P0 三件可授权、P1 需先写《叙事时间模型设计》」的既有结论。

---

## 十六、第二人对第三人意见的表态（2026-09-13）

> **读法：** 第十五节是第三人的独立补注。本节只表态，不重开架构争论。三条都值得写进 P0 验收；其中补 2 按 2026-09-13 代码略收窄，避免会上按「缓存还是全局单例」去改已经按键分的 Factory。

### 16.1 总评

第三人没有把讨论稿重新放大，只修精确度。这是正确的第三人角色。15.4 说前十四节可以作为会议材料定稿——第二人同意，加上第十五节的三条补注之后，P0 授权清单就齐了。

### 16.2 逐条

| 第十五节 | 第二人态度 | 说明 |
|---|---|---|
| 补 1：排除 TipTap `Extension.configure` | **接受** | 第十四节分歧 D 写「全仓不再调用 `configure()`」措辞过宽。验收必须写成：删除 `aiService.configure` 及全局可变状态后，全仓不再有 `aiService.configure(...)`。`RichEditor` 的 `Placeholder.configure` 与串台无关。 |
| 补 2：P0 要连 Provider 缓存层一起定 | **接受提醒，收窄结论** | 见下。 |
| 补 3：P2 薄迁移只加 `content_generation` 列，不绑审稿两表 | **接受，且同意写进 P0 授权附注** | 与第十四节分歧 B 相同。钉在授权清单里，避免 P0 做完有人「顺手做 v21 全期」。 |
| P0 安全项只聚焦 `AIWritePanel` 一处 innerHTML | **接受** | 已核对：全仓 `dangerouslySetInnerHTML` 仅此一处。审稿/润色不要借 P0 顺手改渲染。 |
| 分歧 E 选 1（AI 只读已保存策划快照） | **接受，与第十四节一致** | |

关于补 2 的收窄：

主进程 **已经是按请求收 `ProviderConfig`**（`ai:chat` / `ai:chatStream` 每次带 config）。M2 的 `providerCacheKey` 已是 `name:model|baseUrl|完整 apiKey` 的 Map，不是「进程里只有一个 Provider 实例」。`ai.ipc.ts` 顶部注释写 singleton，和实现不符。

因此 P0 真正要防的不是「从单例改成按键缓存」——键缓存已经在——而是做请求级快照时 **不要倒退**：

- 不要因为某一个面板改了配置就 `invalidateCache()` 清空整张 Map（会误伤其他面板进行中的流所持实例）。当前代码里 `invalidateCache` 已定义，但未见业务调用；P0 不要新接这条全表清空。
- 缓存键继续覆盖「会改变连接行为」的字段：`name` / `model` / `baseUrl` / `apiKey`。P0 若给 `AIRequestConfig` 增加不影响连接的字段（如仅渲染端使用的 `providerId`），不必塞进缓存键。
- 进行中的流应继续持有 `create()` 当时拿到的实例，不在 token 循环里按最新配置换 Provider。

若 P0 计划把这件事写成任务，标题建议是「确认请求级配置与现有 `providerCacheKey` 对齐，禁止整表 invalidate」，而不是「把单例缓存改成按请求缓存」。

### 16.3 一处事实校正

第十五节写「8 个文件调用 `configure`」。HEAD 上 `aiService.configure(` 的调用点是 **7 个文件**：`AIChatPanel`、`AIWritePanel`、`AIReviewPanel`、`AIPolishPanel`、`ContextPanel`、`NameGenerator`、`PlanningWorkspace`。第八个若把 `ai.service.ts` 的方法定义算进去，那是被删对象，不是调用点。P0 验收按 7 个调用点清零即可。

### 16.4 对「现在能不能授权 P0」

第三人的三条都不挡授权。建议会议上把 15.2 + 16.2 收成 P0 验收附注后就可以开写，不必再等下一轮长文。

---

## 十七、本轮独立审查：仍需写死的问题（2026-09-13）

> **结论：** 两位开发者的收敛方向成立，P0 三件可以授权；但本文仍是路线图和会议记录，不是可直接执行的实施计划。下面第 17.1～17.7 属于 P1/P2 设计阻塞，不回答就不能写叙事时间迁移或分析任务；17.8～17.10 分别补齐 P0、P3/P4 与备份轨的验收合同。

### 17.1 文档合同仍有一处直接冲突

全局约束写的是“AI 只能提出事实、钩子和债务候选；正式叙事状态仍由作者确认”，第 12～14 节又已收敛为“非 hook 事实/人物知识自动落库，hook/debt/回收/偿还走 proposal”。两者不能同时作为施工合同。

建议拍板并改写全局约束为：

> AI 抽取的非 hook 事实与人物知识可按章节分析事务自动落库；hook、debt、推进、回收、偿还只创建 proposal，作者确认后才投影到正式叙事状态。

同时建议在 P0 修订稿生成后，把第 1～11 节标成“历史提案，不得施工”，只保留一份当前决策表。现在同一文件同时保留作废迁移号、旧 `content_revision` 和最新结论，执行者通过搜索很容易抄到旧合同。

### 17.2 P1 的 as-of 不能只查询当前 `status`

当前 `story_facts`、`character_knowledge`、`narrative_hooks`、`narrative_debts` 都会原地修改状态。只增加 `effective_chapter_id`、`state_key` 和债务期限，仍无法可靠回答“第 50 章当时是什么状态”：

- 一个钩子在第 80 章被标记 `resolved`，回看第 50 章时它应仍是 `open`。
- 一个债务在第 90 章 `paid`，回看第 60 章时它应仍是 `unpaid`。
- 一个事实现在是 `superseded/resolved`，若没有结束生效章节或状态事件，旧时间点无法重建。
- `partially_resolved`、`abandoned`、`waived` 目前没有足够的章节时间信息，仅靠 `resolved_in_chapter_id/paid_in_chapter_id` 不完整。

P1 Spec 必须先回答：

- [ ] 采用 `effective_from/effective_to`，还是新增不可变的状态事件/转换记录？
- [ ] 创作决策 effect 的 `created_at` 只是数据库时间，如何绑定故事时间？
- [ ] 旧记录缺少关闭章节时，按“未知历史状态”处理，还是只允许从迁移后的新变更开始精确回放？不得猜测回填。
- [ ] 作者确认记录与自动抽取记录发生同 `state_key` 冲突时，按章节先后、来源权威，还是转成待确认冲突？自动抽取不得静默覆盖作者确认事实。

### 17.3 `targetChapterId` 不足以表达不同 AI 任务的时间截面

“写第 N 章”“审第 N 章”“讨论第 N 章之后怎么写”和“复盘第 N 章”需要的边界不同。统一写成“目标章节之前”会让 Review 无法检查本章造成的状态变化；统一包含本章，又会让 Write 看到本章旧分析或未来信息。

建议 `ContextAssembler` 输入显式增加时间模式，而不是只传 `targetChapterId`：

- `before_target`：写章、重写目标章时使用，只取目标章之前。
- `through_target`：复盘/审查已完成章节时可用，包含目标章。
- `project_latest`：明确讨论当前全书已发生事实时使用。
- `planning_only`：正文尚未创建的规划章，只读策划输入，不进入运行时事实时间线。

需要拍板：

- [ ] 各入口和子操作分别使用哪种模式，能否由 Renderer 自由传值，还是由 Main 按 `taskType` 固定映射？建议 Main 校验合法组合，避免入口误传。
- [ ] Review 的“先验上下文”与“本章正文/本章抽取结果”是否分成两个区块，避免把待审内容当成审稿前已知事实？
- [ ] Chat 没有活动章节时默认 `project_latest` 还是必须让用户选择目标章？

### 17.4 规划章稳定 key 目前不存在

文中提出 `targetPlanningChapterKey`，但当前 `ChapterOutline` 只有 `volumeIndex + chapterNumber`，两者在插章、换卷和重排后都会变化，不能作为稳定绑定。若 hook/debt 先绑定规划章、创建正文后再绑定 chapterId，没有稳定 key 就会绑错。

P1 Spec 必须回答：

- [ ] 是否给 `ChapterOutline` 增加持久化 `id`，并对既有 chapter outline JSON 做确定性/一次性补 key？
- [ ] Obsidian 重导、replace/fill/keep、AI 重生成和作者手改章号时，哪些操作保留 key，哪些创建新 key？
- [ ] 正文创建成功后，规划 key → chapterId 的绑定保存在哪里，是否与章节创建处于同一事务/同一次 IPC？
- [ ] 删除正文后是否允许重新绑定同一规划 key，还是该 key 进入“正文已删除”状态？

在这些问题解决前，不应把 planning chapter key 写进外键或期限模型。

### 17.5 章节排序、删除与并章需要一个可执行的不变量

当前章节表没有 `(project_id, sort_order)` 唯一约束，`reorder()` 也没有校验 `chapterIds` 是否完整、重复或跨项目。把 `(sort_order, id)` 当全序可以让查询稳定，却会掩盖不完整重排造成的重复顺序。

建议 P1 合同写死：

- [ ] 正常业务状态下，同项目章节 `sort_order` 必须连续且唯一；reorder 在事务内校验“成员恰好一次、全部属于同项目”，失败不改任何行。
- [ ] `(sort_order, id)` 只作旧脏数据和迁移期间的确定性兜底，不作为允许并列的产品语义。
- [ ] 插章、移章、拆章、并章完成后都运行同一顺序规范化函数，并有数据库级回归。

删除章还有更深一层问题：现有事实/知识/hook/debt 的章节外键使用 `ON DELETE SET NULL`。一旦删章，原 `chapter_id` 会被清空；之后即使 Undo 用原 id 恢复章节，这些记录也不会自动重新绑定。因此“标记孤儿”目前会连“它原来属于哪一章”都丢掉。

需要拍板：

- [ ] 章节改为软删除/墓碑，还是另存不可被 FK 清空的 `source_chapter_id`/孤儿来源快照？
- [ ] Undo 恢复、并章迁移和永久删除各自如何处理事实、知识、钩子期限、债务期限及 creative decision effects？
- [ ] 孤儿项在 UI 由谁处理，未处理前必须从 as-of 排除还是按最后位置保留？

### 17.6 分析任务必须定义“发布事务”，不能只定义 job 状态

当前章节重抽取会删除该章非 `source_decision_id` 的事实/知识后重插。P2 若只在事务外检查一次 `source_generation/hash`，正文可能在检查后、结果提交前再次变化，迟到结果仍能落库。

建议 P2 Spec 明确：

- [ ] 发布分析结果的同一数据库事务内重新读取当前 `content_generation` 并做条件门禁；不匹配则只把 job 标为 `stale`，不得改任何派生表。
- [ ] summary、自动事实、人物知识、hook/debt proposals 的发布是一个原子事务；其中任何一步失败，保留上一代完整派生快照。
- [ ] 同章新世代发布时，旧的自动抽取事实/知识如何失效；作者决策来源记录继续保留，但与新正文冲突时如何提示。
- [ ] 幂等键除 `chapterId + source_generation + targetId + normalizedContent` 外是否还包含 `analysis_schema_version/prompt_version`；否则升级分析器后无法区分“重试”与“按新规则重抽”。
- [ ] `running` 在崩溃恢复后的状态转换、最大重试次数、指数退避、429/401/离线/取消分别进入什么状态。

### 17.7 可恢复 job 用哪一个 Provider，当前还没有合同

任务表不保存 API Key是正确的，但“重启后恢复”与“执行时使用当前请求级 Provider 配置”之间仍缺一层：AI 配置当前由 Renderer/localStorage 解密，Main 中的持久化 job 在启动时不一定拿得到同一配置。

需要拍板：

- [ ] job 持久化哪个非秘密快照：`savedConfigId/provider/model/baseUrl/configFingerprint` 中哪些字段？
- [ ] API Key 由 Renderer 在用户进入项目后临时注入，还是迁移到系统凭据存储后由 Main 解析？本轮不得把明文 Key 写进 SQLite。
- [ ] 原配置被删除、Key 失效或模型下线时，job 是 `blocked` 等待用户重新绑定，还是自动改用当前默认模型？建议禁止静默换模型。
- [ ] 并发数、每项目队列、公平性、单次/每日费用上限和批量补分析的估算口径是什么？润色/审稿后再跑分析是新增一次模型调用，不能描述成“没有新增费用”。
- [ ] 分析所用 Provider 与生成正文所用 Provider 是否必须一致？若不一致，结果页应记录哪一个模型完成了哪一次分析。

### 17.8 P0 PlanningSnapshot 还需补“失败与迟到写回”验收

“AI 只读上次成功落库快照”这个选择是对的，但受控组件至少要明确 `committedSnapshot` 与 `editingDraft` 两种状态，不能把所有字段重新塞回 App 后仍叫一份状态。当前独立 loader 在 `success:false` 时会调用 `onApply(projectId, null)`，实际会清空 App 快照，与注释中的“保留上次成功快照”相反；P0 改造时必须一并钉住失败语义。

建议 P0 验收增加：

- [ ] 同项目刷新失败保留上一份完整 committed snapshot，并显示 stale/error；切到新项目时才清空旧项目可见数据。
- [ ] 保存成功后先用 IPC 返回的完整记录更新 committed snapshot；不要用提交前草稿乐观伪装成功。
- [ ] 未保存 editing draft 只供策划页显示，所有 AI 入口只读 committed snapshot，并显示“存在未保存更改”。
- [ ] 长任务启动时捕获项目 id + operation epoch + committed snapshot 指纹；完成后在**写库前**校验，而不只是写库后拒绝 setState。
- [ ] A→B→A 快切、同项目保存后旧生成回执、Obsidian commit 成功但 refresh 失败三种场景均有真实 React→IPC 回归，且旧任务不得覆盖新保存内容。

### 17.9 ContextBundle、滚动摘要和性能验收仍需量化

`sourceRevision` 不能是含糊的单个数字，因为 bundle 同时依赖 planning、目标章世代、章节顺序、事实/知识和 hook/debt。建议返回结构化 provenance，例如各来源的版本/更新时间、选择数量、截断原因和时间模式，便于定位“模型为什么没看到某条资料”。

需要拍板：

- [ ] Token 预算使用哪个确定性估算器，是否按模型上下文上限动态计算，并为业务 Prompt、用户输入和输出至少保留多少空间？
- [ ] “300 章、上千条事实”验收的 fixture 大小、单次装配时延上限、bundle 字符/token 上限和必选信息不得丢失规则是什么？
- [ ] 相关性首版是否坚持本地确定性规则；若使用 AI rerank，它的费用、失败降级和时间边界如何保证？
- [ ] Renderer 收到 Bundle 后禁止再次拼人物/世界观/大纲全表，如何用契约测试覆盖 Chat、Review、单章 Write、批量 Write 四个入口？

滚动摘要还需单独回答：

- [ ] 摘要任务绑定 `through_sort_order` 后，新消息并发写入时如何 CAS，避免迟到摘要覆盖更晚摘要？
- [ ] 用户删除/编辑旧消息、拒绝某个方案或确认创作决策后，摘要如何失效或增量修订？
- [ ] 摘要由哪个 Provider 执行、是否自动产生费用、失败后何时重试；不得因为摘要失败回退发送全量历史。

### 17.10 自动备份必须使用 SQLite 在线备份语义

数据库启用了 WAL。现有手动备份是 `wal_checkpoint(TRUNCATE)` 后复制主 `.db` 文件，但没有检查 checkpoint 是否因活跃事务返回 busy；即使复制出的数据库能通过 `integrity_check`，也可能只是缺少尚在 WAL 中最近提交的旧快照。

阶段四需要拍板：

- [ ] 自动备份统一使用 better-sqlite3/SQLite online backup API（或经验证的 `VACUUM INTO`），不直接依赖“checkpoint 后 copyFile”。
- [ ] 备份期间允许继续写入还是短暂进入只读；busy、磁盘满、目标同盘损坏分别如何提示。
- [ ] integrity check 应针对备份文件的新连接执行，并记录备份来源时间、schema migration 版本、文件大小和校验结果。
- [ ] 恢复演练必须覆盖 WAL 活跃写入、迁移前后版本、恢复前再备份当前库，以及失败后原库仍可打开。

### 17.11 更新后的授权判断

- **P0：可以授权。** 但正式施工前应先拆成一份短实施计划，覆盖 7 个 `aiService.configure(...)` 调用点、已有 Provider key-cache 不倒退、AIWritePanel 文本预览，以及 17.8 的 committed/draft/失败语义。
- **P1：仍不可授权迁移。** 独立《叙事时间模型设计》至少回答 17.2～17.5，并先用纯函数和数据库 fixture 锁定。
- **P2：仍不可授权。** 独立《章节分析任务设计》至少回答 17.6～17.7，再决定是否建 `chapter_analysis_jobs` 及是否需要 `content_generation` 薄迁移。
- **P3/P4：方向成立。** ContextAssembler、摘要、里程碑和备份分别拆计划，不应回填进 P0 的提交。

---

## 十八、第二人对现稿的审查与仍未写死的问题（2026-09-13）

> **读法：** 本节审查的是「原文 + 十二～十六轮讨论 + 第十七节」这一整份现稿，不是再审 9 月 12 日的代码缺口。第十七节提出的 P1/P2 阻塞，第二人核对代码后**整体接受**。下面先说这份讨论稿现在怎么样，再只补第十七节还没钉死、会上仍会踩坑的问题。

### 18.1 这份讨论稿现在怎么样

**作为三人技术对齐：合格。** P0 三件、A5 范围、stages 只进拆章、Assembler 不接管 Prompt、分析不挂防抖、首次无迁移——这些已经收敛，可以授权。第三人把验收措辞修准，第十七节补上了前两轮都写浅了的时间语义。

**作为实施计划：不合格。** 同一文件里现在并排存在着：

| 位置 | 仍在说的旧合同 | 后文已经推翻 |
|---|---|---|
| 第一节第 3 点、全局约束 | 钩子债务闭环未完成；AI 只能提事实候选 | 第十二/十四节：兑现 A5 P2；非 hook 可自动落库 |
| 修改 3 / 第七节 / 第十一节 | PlanningSession 用 v21 revision | 第十二节：第一刀无迁移 |
| 修改 5 | `content_revision` + 与正文同事务入队 | 第十二节：只用 `content_generation`；分析异步 |
| 第十二节 12.2 分歧 2 | 用世代差值扫缺分析 | 第十四节分歧 A、第十五节补 3：禁止 |
| 第十二节 12.5 | P0 之后先做完整 chapter-run v21/v22 | 第十四节分歧 B：平行轨，不挡 P1 |
| 第十五节 15.1 | 8 个文件调用 `configure` | 第十六节：7 个调用点 |

执行者如果从目录点进「修改 5」或搜索 `v21`，仍会抄到作废方案。第十七节 17.1 要求把第 1～11 节标成历史提案——**第二人认为这是开会的第一件事**，比再追加第十九节更重要。在标历史之前，本文不能当施工合同。

建议会后产物不是第十八节，而是一页「当前合同」：已拍板项、P0 验收、P1 Spec 必须回答的问题。本讨论稿改为附录。

### 18.2 第十七节的代码核对与收窄

| 第十七节主张 | 核对 | 第二人态度 |
|---|---|---|
| 全局约束与 A5 打架 | 属实 | 接受 17.1 的改写 |
| as-of 不能只读当前 `status` | 属实，这是前两轮最大的漏 | 接受为 P1 第一问题 |
| 钩子/债务「没有足够章节时间信息」 | **收窄** | `narrative_hooks` 已有 `due_chapter_id`、`resolved_in_chapter_id`；债务已有 `paid_in_chapter_id`。缺口主要在：**事实/知识的 status 原地改、没有关闭章节；** `partially_resolved` / `abandoned` / `waived` / `overdue` 未绑章；确认账本 effect 只有墙钟 `created_at`。P1 不要重做钩子已有字段。 |
| `targetChapterId` 不够表达写/审/聊 | 属实 | 接受 17.3；Main 按 `taskType` 映射时间模式，Renderer 不得自由传任意截面 |
| `ChapterOutline` 无稳定 id | 属实，React key 甚至用 `chapterNumber` | 接受 17.4；P1 未补 key 前，禁止把规划章写入 hook/debt 外键 |
| `reorder` 不校验完整性；事实 FK 是 `ON DELETE SET NULL` | 属实 | `chapter_history` 是 `ON DELETE CASCADE`，删章会丢掉短期快照，和事实变孤儿不一致。见 18.3 Q5。 |
| 分析发布存在 TOCTOU | 属实 | 接受 17.6：条件更新必须在**同一写事务**里读世代 |
| job 恢复拿不到 Key | 属实；配置在 `localStorage['hi-story-ai-configs']`，应用级不是项目级 | 接受 17.7；P0 不要把配置迁 SQLite 或改成按项目 |
| `planning-loader` 失败时 `onApply(null)` | **属实，注释说保留快照，代码会清空** | 必须进 P0，不是 P1。见 17.8 |
| WAL 下 copyFile 备份不可靠 | 方向对 | 接受为 P4；不挡 P0 |

对 17.2，第二人建议会上直接采用下面的默认，而不是从零设计事件溯源：

1. **迁移前的旧记录不伪造历史。** as-of 只保证迁移后新写入的状态变化可回放。旧钩子若已有 `resolved_in_chapter_id` 则用；否则标「历史不完整」，查询时按当前 status，并在 ContextBundle 里声明局限。
2. **迁移后采用状态转换行，而不是只改当前行上的 status。** 每条转换带 `at_chapter_id`（故事时间）和 `decision_id`（可选）。`effective_from/to` 可以由转换折叠出来，不必一开始就上完整事件溯源框架。
3. **作者确认的故事时间 = 决策所绑定的源章节，不是点确认的墙钟。** 人在第 80 章确认第 20 章抽出的钩子，生效章仍是第 20 章。
4. **自动抽取不得静默覆盖 `source_decision_id IS NOT NULL` 的作者确认事实。** 这与现有重抽取合同一致，写进 as-of 冲突规则即可。

### 18.3 第十七节仍未写死、建议补进会上清单的问题

#### Q1. 现有 `fact_type` 如何分成状态/事件？

表里已经有 `location/possession/relationship/knowledge/event/emotional_state/hook`。P1 若让模型临时分类，as-of 会不可复现。

- [ ] 是否采用确定性映射：`location/possession/relationship/emotional_state` → 状态（同 `state_key` 只保留目标章之前最后一条）；`event` → 事件（范围内累计）；`knowledge` 走人物知识表，不在 `story_facts` 里再还原；`hook` 不再作为事实类型写入（A5）？
- [ ] 旧 `fact_type='hook'` 行迁移时删除、归档，还是只停止新写？不得再双写。

#### Q2. 批量写章在分析完成前，后一章吃什么？

原文要求「后一章至少接收前一章临时摘要」。P2 分析是异步的。若不拍板，批量会在没有 as-of、没有新事实的情况下连续生成，把串章问题从单章复制成整卷。

- [ ] 后一章只使用前一章**本次生成的临时摘要**（不入运行时事实表），还是必须等前一章分析 job 完成（可失败则暂停批量）？
- [ ] 批量过程中未确认的 hook/debt proposal 是否注入后一章？建议 **否**，避免未确认状态变成后文前提。
- [ ] 作者在批量中途改前一章正文，已排队的后一章是否作废？

#### Q3. `outline_nodes` 在 A4b 收口后的身份？

Assembler 切换批量入口时，写作侧大纲面板还在。若不定义，作者会继续改面板并以为 AI 会读。

- [ ] 收口后 `outline_nodes` 是否对所有 AI 入口不可见，只作作者私人提纲？
- [ ] 是否在 UI 标明「AI 不读此大纲」？删除面板是否仍留到 B3？

#### Q4. 内容安全红线与 Token 预算谁让路？

`WRITE_SYSTEM_PROMPT` 的安全红线必须进写章请求。Assembler 若按预算裁 ContextBundle，不得裁掉红线、施工卡和作者当次要求。

- [ ] 是否规定不可裁剪段：安全红线、任务 Prompt、施工卡、用户当次指令；可裁剪段才进入预算？
- [ ] 预算估算用哪套计数器（现有粗算还是按模型 tiktoken 近似）？P3 验收必须写死上限，避免「300 章 fixture」无法判定失败。

#### Q5. 删章时历史 CASCADE 与事实 SET NULL 如何统一？

删章后：`chapter_history` 没了，事实/钩子的 `chapter_id` 被置空。Undo 即使用原 id 插回章节，叙事状态也不会自动回来。

- [ ] P1 是否禁止硬删除章节，改为墓碑（`deleted_at`），历史与 FK 都保留，直到作者确认「永久删除并处理孤儿」？
- [ ] 若必须硬删除，是否先拒绝「仍有绑定事实/钩子/债务/知识」的章节，逼作者先迁移？
- [ ] 第二人倾向：墓碑 + 拒绝未处理孤儿的永久删除。Undo 只恢复墓碑。不要在 SET NULL 之上再做猜测性重绑。

#### Q6. `sort_order` 唯一约束会撞上脏数据

当前无 `(project_id, sort_order)` UNIQUE，`reorder` 只按传入数组下标更新，缺 id、重复 id、跨项目 id 都不会失败。直接加 UNIQUE 可能让旧库升不了级。

- [ ] P1 迁移是否必须先跑规范化（同项目重排为 0..n-1，冲突按 `(sort_order, id)` 打破）再加 UNIQUE？
- [ ] 规范化是否写进 `reorder/insertAfter` 的同一套纯函数，而不是只在迁移里做一次？

#### Q7. 分析提案会不会淹没决策账本？

润色/审稿默认开分析之后，同章小改也会产 hook/debt proposal。第十四节要求幂等，但没说 UI。

- [ ] 同章同世代的新提案是替换该世代未确认提案，还是追加？第二人倾向 **按幂等键替换未确认项**，已确认的不动。
- [ ] 决策面板是否按章+世代分组，避免作者面对几十条重复「推进钩子」？
- [ ] 作者长时间不确认时，写章上下文是否仍只读已确认运行时表（是）？

#### Q8. P0 预览用纯文本还是安全 Markdown？

第三人建议去掉 innerHTML，聚焦 `AIWritePanel` 一处。若 P0 直接上 Markdown 渲染，容易再引入 XSS。

- [ ] P0 是否只使用文本节点 / `pre-wrap` 展示 `generatedContent`，Markdown 另立安全任务？第二人倾向 **P0 纯文本**。

#### Q9. 应用级 AI 配置与项目切换

`hi-story-ai-configs` 是应用级 localStorage，不是按项目。切书不会换 Key。P0 请求级快照解决的是面板串台，不是「这本书用这把 Key」。

- [ ] P0 是否明确不把配置改成按项目？第二人倾向 **不改**，避免和串台修复缠在一起。按项目配置属于 B11，另授权。

#### Q10. 会议还要不要继续往本文追加章节？

- [ ] 是否冻结本文为讨论档案，会后只改一页当前合同 + 独立的 P0 实施计划 / P1 Spec？第二人强烈建议 **是**。再写第十九节会降低而不是提高可执行性。

### 18.4 建议的会议议程（90 分钟内应能结束）

1. **宣布第 1～11 节为历史提案**，施工只看「当前合同」。
2. **勾选已收敛、可当作合同的项**（下面 18.5）。
3. **授权 P0 短计划**，范围锁定为 18.5 的 P0 验收，含 17.8 失败语义。
4. **只讨论 P1 必须先回答的四个问题：** 17.2 历史状态（用 18.2 默认）、17.3 时间模式、17.4 规划章 key、18.3 Q5 删章。其余 Q 记入 P1/P2 Spec 草稿，不当场设计表结构。
5. **明确不授权：** 完整 chapter-run 二期、分析 jobs、Assembler、备份。需要时单独开会。

### 18.5 第二人认为已经可以写成合同的项

开会若只为 P0，下列项建议直接勾通过，不必再辩论：

- 首次授权只有三件无迁移 P0：请求级 Provider（7 个 `aiService.configure` 调用点清零，排除 TipTap）、已保存 PlanningSnapshot 受控、AIWritePanel 禁止 innerHTML（纯文本）。
- 缓存继续用现有 `providerCacheKey`，禁止整表 `invalidateCache`。
- AI 只读 committed 策划快照；loader 失败不得 `onApply(null)`。
- 非 hook 事实/知识可自动落库；hook/debt/回收/偿还走 proposal。
- stages 只进拆章；Assembler 将来只交 Bundle，Renderer 不得再拼全表。
- 分析不挂两秒防抖；缺分析只扫显式请求。
- P1 不依赖完整 chapter-run 二/三期；`content_generation` 薄迁移若发生，不加审稿两表。
- 故事时间绑定 `chapter_id`，顺序用当前 `sort_order`；旧债务整数不猜测映射。
- 手写分析用项目开关 +「同步本章」，不每保存弹窗。

P0 短计划写完即可开工。P1 在 18.3 的 Q1/Q2/Q5 和 17.2～17.4 写进独立 Spec 之前，不要碰迁移。

---

## 十九、第三人对第十八节现稿的意见（2026-09-13）

> **读法：** 本节审查的是「原文 + 十二～十八轮」这一整份现稿，不是再审 9 月 12 日代码。第十八节把讨论推进到了「已经可以写 P0 短计划」的程度，方向与事实基础我都重新核过，不再重复。下面只做三件事：给出我对现稿的总体判断、确认几个第十八节的关键事实、补两条第十八节仍没写死、但会实际卡住 P0 施工的点。

### 19.1 总体判断

**作为技术对齐，这份现稿已经是「过度收敛」了。** 十八节、四位视角、十来个 Q 编号问题，信息量已经超过「会前材料」所需，接近「把 Spec 拆解工作提前到讨论里做完了」。继续追加第十九节之后，边际价值是负的——这正是第十八节 Q10 自己说的「再写一节会降低可执行性」。

我的明确建议是：**接受第十八节 18.4 的议程，把本文件冻结为讨论档案，会后只产三样东西：**
1. 一页「当前合同」（18.5 已列出的可拍板项，勾选即可）；
2. 一份 P0 短实施计划（范围 = 18.5 的 P0 验收，含 17.8 失败语义）；
3. 一份独立的 P1《叙事时间模型设计》草稿骨架（只列 17.2～17.5 + 18.3 Q1/Q2/Q5 要回答的问题，不当场定表）。

不要再往本文追加第二十节。

### 19.2 第十八节的关键事实，我逐一重新核过，全部属实

| 第十八节主张 | 我的核对结果 |
|---|---|
| `narrative_hooks` 已有 `due_chapter_id`/`resolved_in_chapter_id`；债务已有 `paid_in_chapter_id` | 属实（migrations.ts 316/317/335 行） |
| 缺口主要在「事实/知识的 status 原地改、无关闭章节」+ `partially_resolved`/`abandoned`/`waived`/`overdue` 未绑章 | 属实（story_facts 无 `state_key`/`effective_chapter_id`，hooks 的 status CHECK 含 `partially_resolved`/`abandoned` 但无对应章节字段） |
| `planning-loader` 失败时 `onApply(projectId, null)`，注释说保留快照、代码清空 | **属实，且这是 P0 必修**（planning-loader.ts:42-44，注释第 17 行与实现矛盾） |
| `reorder` 不校验成员完整性/重复/跨项目 | 属实（chapter.repo.ts:159-173，只按下标 UPDATE，无校验） |
| 全局 `aiService.configure` 是 7 个调用点（非 8） | 属实，16.3 的校正正确 |
| `dangerouslySetInnerHTML` 全仓仅 AIWritePanel 一处 | 属实 |
| 最新迁移 v20 | 属实 |

### 19.3 第十八节仍没写死、但会卡住 P0 施工的两个点

#### 补 A：`planning-loader` 的失败语义修法，会牵连 `App.tsx` 的 `planningSnapshot` 状态

18.2 说「`onApply(null)` 必须进 P0」，但没写清修法。当前 `App.tsx` 的 `planningLoader` 是：

```ts
onApply: (projectId, planning) => setPlanningSnapshot({ projectId, planning }),
```

而 `planning-loader` 内部失败时会 `onApply(projectId, null)`，把 `planningSnapshot` 直接覆盖成 `{projectId, planning: null}`。

P0 修法不能是「在 loader 里失败就不调 onApply」这么简单——因为 `onApply` 的签名是「成功和失败共用一个入口」，它分不清「这是 `planning=null`（项目确实没策划）」还是「这是失败」。要真正实现 18.5 的「loader 失败不得清空快照」，必须：

- 给 `planning-loader` 的失败语义单独一个通道（例如 `onApply` 只在成功时调，失败走 `onError`，且 `onError` 不清空已有快照）；
- 或者 `onApply` 的 `planning` 参数改成带 `source: 'loaded' | 'empty' | 'error'` 的判别，App 据 `source` 决定「覆盖 / 保留」。

这是 P0 短计划里必须写的一步，不能只写「失败不得 onApply(null)」这句原则，否则执行者会面对「怎么区分 null 是空项目还是失败」而卡住。

#### 补 B：P0 的「请求级 Provider」会牵动 `AIWritePanel` 里已有的 `writeModel`/`summaryModel` 独立模型选择

当前 `AIWritePanel` 除了 `aiService.configure()`，还有 `writeModel`（写章模型）和 `summaryModel`（摘要/事实抽取模型）两个独立 state，用于在同一个面板内让「写章」和「抽取」走不同模型。P0 改成「每次请求带完整快照」后，`chat()`/`chatStream()` 的签名变成 `(config, messages, options)`，但 `writeModel`/`summaryModel` 是在 `options.model` 层面覆盖的，不是 `config` 层面。

这里有个语义冲突：P0 的目标是「请求级不可变 config 消除串台」，但 `writeModel` 恰恰是「同一面板内、按用途覆盖模型」的合法需求。P0 计划必须回答：

- 模型覆盖是「config 的一部分」（即 `AIRequestConfig.model` 由面板按用途构造），还是「options.model 的独立层」？
- 如果保留 `options.model` 覆盖层，那 P0 的「请求级 config」就不该把 model 写死在 config 里，否则 `writeModel`/`summaryModel` 会失效。

这条不写清楚，P0 做到一半会撞上「写章面板写章用 A 模型、抽取用 B 模型」的既有功能，要么回退、要么做坏。

### 19.4 结论

第十八节已经可以收束了。我的态度与 18.4 完全一致，只加两条：

1. **冻结本文**，会后产「当前合同 + P0 短计划 + P1 Spec 骨架」三样，不再追加章节。
2. **P0 短计划必须额外写清两处**（19.3 补 A 的 planning-loader 失败语义判别、补 B 的 writeModel/summaryModel 与请求级 config 的关系），否则 18.5 的「已可写合同项」落到代码时会卡住。

P0 三件仍可授权；P1 不写《叙事时间模型设计》不碰迁移——这两条既成结论，我不再重复表态。

---

## 二十、冻结声明：第二人对第十九节的确认（2026-09-13）

> **本文到此冻结。** 第十九节判断「继续追加边际价值为负」成立。第二人不再对路线图提新架构问题。下面只确认：那位工程师截图里的开工条件、以及 19.3 补 A/补 B 在 P0 短计划里的默认写法。

### 20.1 对「能不能开弓」的回答

**能开弓的是 P0 三件，不能开弓的是「直接按本讨论稿写代码」。** 这不是文档没讨论完，而是文档类型错了：它是会议记录，不是实施计划。P0 范围已经确定；缺的是冻结后的三份短产物。

与第十九节、截图建议完全一致：

1. 把本文标为讨论档案（本节即冻结）。
2. 另写一页当前合同（从 18.5 勾选，不必再辩论）。
3. 另写 P0 短实施计划；其中必须包含 19.3 补 A、补 B。
4. P1 及以后仍先写独立 Spec，不授权迁移。

### 20.2 接受补 A / 补 B，P0 计划按下列默认写，不再开会讨论

**补 A（planning-loader 空项目 vs 失败）——属实，必须写进 P0。**

当前 `success:false` 与「项目确实没有策划」都会变成 `onApply(projectId, null)`，App 无法区分。默认修法：

- `onApply` **只在 `response.success === true` 时调用**。`data === null` 表示空策划，这是合法成功，应当写入 `{ projectId, planning: null }`。
- `success:false` 或抛错走 `onError`：同项目刷新**不改**已有 committed snapshot，只标 stale/error；切到新项目时先丢掉旧项目快照（现有 `useEffect` 清空可以保留），新项目失败则保持「当前项目、无可用策划 + 错误」，不得把上一本书的纲显示出来。
- 不要给 `onApply` 再叠 `source` 联合类型，除非短计划里发现 `onError` 通道不够用。先走与 Obsidian loader 相同的成功/失败分通道。

**补 B（writeModel / summaryModel）——属实，必须写进 P0。**

这不是与请求级配置冲突的第二套全局状态。它是同一面板里两次请求用不同模型，合法。默认修法：

- 每次调用现场构造完整 `AIRequestConfig`。写章：`model = writeModel || 面板当前配置.model`；抽取：`model = summaryModel || 面板当前配置.model`。空字符串表示跟面板默认，行为与现在一致。
- **不要**再保留 `ChatOptions.model` 作为第二层覆盖。今天 `ai.service.ts` 用 `options?.model || this.currentModel`，正是全局可变状态的一部分。P0 把 model 放进当次 config 快照后，options 只留 `temperature` / `maxTokens` / `systemPrompt`。
- Provider / apiKey / baseUrl 仍来自该面板当次选中的保存配置，不随 writeModel 另换供应商。P0 不引入「抽取走另一家供应商」。

### 20.3 冻结后本文怎么用

| 要做什么 | 读哪里 |
|---|---|
| 理解当初为什么要改 | 第一～十一节（历史提案，禁止按此编码） |
| 查讨论过程 | 第十二～二十节 |
| 开工 | 合同 + 已修订短计划（三片顺序）。审查第七节是修订依据。独立 worktree、不并行、不 push。 |

不要再往本文件追加第二十一节。

