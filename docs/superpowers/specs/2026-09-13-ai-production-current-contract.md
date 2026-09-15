# 长篇生产当前合同（2026-09-13）

> **效力：** 本文取代讨论稿第 1～11 节作为施工合同。讨论过程见已冻结的 `docs/superpowers/plans/2026-09-13-ai-long-novel-production-architecture-plan.md`。
>
> **状态：** P0 短计划已按 `docs/superpowers/plans/2026-09-13-p0-provider-planning-preview-review.md` 第七节修订，**按三片顺序施工**。叙事时间（P1）已按 `docs/superpowers/specs/2026-09-14-narrative-time-model-design.md`（设计）→ `docs/superpowers/plans/2026-09-14-p1-narrative-time-reducer.md`（纯函数 + 单测）→ `docs/superpowers/specs/2026-09-14-narrative-time-integration-design.md`（接入 Spec）→ `docs/superpowers/plans/2026-09-14-narrative-time-integration.md`（实施计划）施工并合入 `master`。
>
> **施工进度（2026-09-14）：** P0 三片 + Obsidian 导入分隔已快进合入 `feature/skill-engine`（`81856da..6ff75e1`，文档 `8a622f5`），现已在 `origin/feature/skill-engine`。进度说明见 `docs/superpowers/plans/2026-09-13-p0-status.md`。叙事时间（P1）已合入 `master`（PR #2，合并提交 `e15fbde`，含 v21 迁移 + 投影/转换双写 + 章节软删/恢复 + as-of 固定截面 + 章节删除/撤销双层守卫）。

## 已批准：P0（无数据库迁移）

只做这三件，详见 `docs/superpowers/plans/2026-09-13-p0-provider-planning-preview.md`。三片顺序：Provider → Planning → Preview，不并行。

1. **请求级 Provider 快照**
   - 删除 `aiService.configure` 及全部 **7** 个调用点：`AIChatPanel`、`AIWritePanel`、`AIReviewPanel`、`AIPolishPanel`、`ContextPanel`、`NameGenerator`、`PlanningWorkspace`。
   - 验收：`rg "aiService\\.configure" src` 无匹配。不统计 TipTap 的 `Placeholder.configure`。`chat` / `chatStream` 调用点共 14 处，全部改为传入当次快照。
   - `chat` / `chatStream` 每次接收完整 `ProviderConfig` 快照（`name/apiKey/model/baseUrl`）。`name` = 主进程 `ProviderFactory` 认识的供应商标识（现预设里等于 `ProviderPreset.name` / `id`），禁止传 `displayName`。
   - `chatStream` 必须用**同步外壳**在调用瞬间拷贝快照，再进入内部 `async *`；`projectId` 必填（trim 后非空）。`chat()` 是普通 async，入口快照即可，不强制 `projectId`。
   - 写章 `writeModel`、抽取 `summaryModel` 在构造当次快照时写入 `config.model`；**删除渲染端** `ChatCallOptions.model` 第二层覆盖。空字符串 / 空白 = 用面板当前配置的 model。不换供应商。
   - 主进程 `src/main/ai/provider.ts` 的 `ChatOptions.model` 与 `options?.model || this.defaultModel` **本轮保留**（`embed` 仍走 `options.model`）。渲染端不传该字段。
   - 继续使用现有 `providerCacheKey`。禁止因改配置调用 `ProviderFactory.invalidateCache()` 清空整表。进行中的流持有 `create()` 当时的实例。
   - 不搬迁供应商预设目录。不把 `hi-story-ai-configs` 改成按项目。

2. **已保存 PlanningSnapshot**
   - App 持有 committed 快照；AI 对话上下文只读该快照（含未保存草稿的策划页不得把草稿送进模型）。
   - `createPlanningLoader`：`onApply` 仅在 `success === true` 时调用。`data === null` 是空策划，合法成功。`success: false` 或抛错走 `onError`，**同项目刷新不得清空**已有快照。
   - 切到新项目时可以先丢掉旧项目快照；新项目失败则「当前项目、无可用策划 + 错误」，不得显示上一本书的纲。
   - 普通保存 / 锁定 / 后台 persist 成功：用 `db:planning:save` 返回的 `PlanningIdea` 立刻 `onPlanningCommitted(projectId, planning)`。不要 fire-and-forget `void planningLoader.load()`。Obsidian 导入仍走 guarded reload。
   - 同项目旧 AI 结果：内存 `Map<projectId, number>` write epoch，长任务启动时捕获，`db:planning:save` **之前**比较；不一致则禁止落库并提示。P0 **不**把 PlanningWorkspace 全部字段抬进 App，**不加** `planning_ideas.revision`。

3. **AIWritePanel 预览禁止 HTML 注入**
   - 去掉唯一一处 `dangerouslySetInnerHTML`。不上 Markdown 渲染。不改审稿/润色。不改写章 prompt（模型仍输出 HTML，章节仍存 HTML 原文）。
   - 预览按 `<p>` 切成 React 文本节点分段渲染；抽不出段时整份进 `<pre>` 文本节点。不要 `htmlToPlainText` 预览却 HTML 保存，也不要 `<pre>` 直出标签当主路径。

## 已批准、但不在 P0 做

- 非 hook 事实/知识可自动落库；hook / debt / 推进 / 回收 / 偿还走 `creative_decisions` proposal。
- `VolumeOutline.stages` 只进拆章 Prompt；普通对话、写正文、审稿不直接注入 stages。
- 分析不挂 WritingArea 两秒防抖。缺分析只扫显式请求，不扫 `content_generation` 差值。
- P1 as-of **不以**完整 chapter-run 二期/三期为前置。若以后需要世代列，薄迁移只加 `content_generation` + `normalizeChapterText`，不绑审稿两表。
- 故事时间绑定稳定 `chapter_id`，顺序用当前 `sort_order`。旧债务整数期限不猜测映射。
- 手写分析：项目级开关 +「同步本章」按钮，不每保存弹窗。
- ContextAssembler 将来只交 Bundle，不接管业务 Prompt；Renderer 不得再拼人物/世界观/大纲全表。
- 永久里程碑是 P4 必需，首批 chapter + planning。
- Renderer 强制 `tsc`、CSP、IPC 白名单走独立质量轨，不挡 P0。

## 未批准（禁止本轮编码）

| 项 | 前置 |
|---|---|
| ~~叙事时间 as-of、事实时间字段、规划章稳定 key~~ | **已完成**：Spec `docs/superpowers/specs/2026-09-14-narrative-time-model-design.md`，施工合入 `master`（PR #2，`e15fbde`） |
| `chapter_analysis_jobs`、写章抽债务 | 独立《章节分析任务设计》（17.6～17.7） |
| 完整 chapter-run 二期/三期（审稿账本、写章运行单） | 已批准 Spec 单独授权，不插入 P0→P1 |
| ContextAssembler、滚动摘要、entity_revisions、自动备份 | 各自独立计划 |
| `content_revision`、策划 DB 乐观锁、分析与正文同事务、把事实改成一律 proposal | 已否决，不得复活 |

## 迁移号

当前仓库最高版本 **v20**。文档里出现的 v21/v22 预留属于 chapter-run Spec，不是给策划 revision 或事实时间字段用的。任何新迁移执行前读 `MIGRATIONS`，不信讨论稿第七节。

## 验收命令（P0）

`npm run test` 不转发 argv，始终全量。定向测用 Electron Node（见短计划 Global Constraints）。

```bash
npm run test
npm run build:main
npx vite build
rg "aiService\\.configure" src
rg "dangerouslySetInnerHTML" src
rg "invalidateCache" src/renderer
node tests/ui/run-writing-workspace.cjs
node tests/ui/run-obsidian-import.cjs
node tests/ui/run-creative-decision-ledger.cjs
```

期望：测试通过；`build:main` 与 vite 通过；三条 rg 在指定范围内无匹配（TipTap `configure` 允许；`src/main` 的 `invalidateCache` 定义可保留）。三个 UI runner 是整分支最终门，不是每片都跑。外部供应商烟测需单独授权。
