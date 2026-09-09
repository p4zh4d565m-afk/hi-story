# 疑似相关项提示与决策修订实施计划

**目标：** 实现已批准的同名 spec，完成规则提示、无父修订、目标互斥和历史修订入口。

**架构：** 主进程负责规则查询与 SQLite 事务；渲染端负责保存草稿、选择和项目代次隔离。沿用当前 `feature/skill-engine` 工作区，按用户要求使用 executing-plans 和 TDD。

**技术：** Electron、React、TypeScript、better-sqlite3、Vitest。

## 全局约束

- 依据 `docs/superpowers/specs/2026-09-09-related-items-decision-revisions-design.md`，包含审阅提交 `459008e` 的三项补充。
- 保留 App.tsx 的 obsidianResult 用户修改，不混入任何提交。
- 不修改 Obsidian，不写旧 foreshadowings，不提交本地配置与 dist，不推送。
- 作者 hook/debt 提议主体必填；App.tsx 自动章节同步及底层 CreateHookInput/CreateDebtInput 允许空主体。
- 有父修订 targetId 必须非空且等于父 effect 目标；父 ID 从数据库 proposal 读取。
- 所有写入入口对同项目 targetTable + targetId 的 pending 修订互斥。

## 任务一：v19 与主体完整读写

文件：`src/main/db/migrations.ts`、`src/renderer/types/index.ts`、`src/main/db/repositories/narrative-hooks.repo.ts`；新增 `tests/unit/db/narrative-subject.test.ts`。

- [ ] 写 v18 升级、默认空值、DDL 失败回滚、hook/debt create/update/row mapper 往返测试。
- [ ] 用 Electron Node 模式运行该测试，观察缺列或丢失 subject 的失败。
- [ ] 追加 v19 两个 `ALTER TABLE ... ADD COLUMN subject TEXT NOT NULL DEFAULT ''`。
- [ ] 运行时类型增加 subject；底层创建与更新输入保持可选。INSERT 使用 `input.subject ?? ''`；UPDATE 未传 subject 时保留已有值；mapper 读取 subject。
- [ ] 专项测试和 build:main 通过后单独提交。

## 任务二：决策主体、修订事务与互斥

文件：`src/main/db/repositories/creative-decision.repo.ts`、`src/renderer/services/creative-decision-extraction.ts`、共享类型；扩展 `tests/unit/db/creative-decision.repo.test.ts`、`tests/unit/creative-decisions/extraction.test.ts`。

- [ ] 先覆盖四类无父 targetId 修订、有父 targetId 置空/改类型/改目标、同目标跨父互斥、事务回滚与旧载荷兼容；观察失败。
- [ ] 提议载荷增加必填 subject；提取器与仓储双重校验，旧行读取缺失主体映射为空。
- [ ] hook/debt 新增及原地修订 SQL 写入 subject，effect 包含真实前后值。
- [ ] updateProposal 用数据库 proposal 取得父 ID；完整校验与更新放进事务。
- [ ] 添加共享目标互斥校验，createProposals、updateProposal、createRevision 在写入事务中使用，阻断任何入口绕过唯一 pending。
- [ ] confirmMany 在同一事务内按目标复检批内和批外 pending，按 targetId 选择投影；confirmed 走原 effects 幂等分支。
- [ ] createRevision 固定父 effect 目标；增加只读修订预填方法，返回含固定 targetId 的原 draft。
- [ ] 更新旧合法测试数据的主体字段，专项及全量测试通过后提交。

## 任务三：主进程相关项查询与 IPC

文件：新增 `src/main/db/repositories/decision-related-items.ts`；修改 `creative-decision.repo.ts`、`src/main/ipc/creative-decision.ipc.ts`、共享类型；新增相关项单测。

- [ ] 测试 NFKC/trim/大小写、六类事实键、人物 ID 优先/姓名兜底/20 条排序、钩子债务类型主体键与空主体兜底、跨项目和非活跃排除；观察失败。
- [ ] 返回 `CreativeDecisionRelatedItems`：`matches`、`knowledge`、`missingSubject` 三组；条目包含目标表、ID、描述、主体与状态。
- [ ] `findRelatedItems({ projectId, decisionId })` 只读已保存 proposed；SQL 粗筛后 JS 精确归一化比较。
- [ ] 暴露 `db:creativeDecisions:findRelatedItems` 与 `db:creativeDecisions:prepareRevision`；遵守 IpcResult 错误契约。
- [ ] 专项和 build:main 通过后提交。

## 任务四：确认选择、历史修订与异步守卫

文件：`src/renderer/components/CreativeDecisionPanel.tsx`、`src/renderer/App.tsx`；必要时提取独立确认工作流服务；扩展 `tests/ui/creative-decision-ledger.tsx` 与服务单测。

- [ ] 写确认选择、保存失败阻止整批、取消跳过、历史预填、空主体补填、A→B→A 迟到回执、重复点击测试并运行失败。
- [ ] hook/debt 编辑器增加主体；旧数据 `subject ?? ''`。
- [ ] 查询已保存 proposal 并展示三个分区；独立项 targetId=null，修订选择设置 targetId 并保存。全部保存成功后一次 confirmMany；取消项排除。
- [ ] 明确 targetId 修订展示目标，不再选择；历史 confirmed 提供创建修订，prepareRevision 返回固定目标，createRevision 只建 proposed。
- [ ] 项目 ID 和请求代次双重守卫覆盖所有 await 后的状态提交、刷新、catch/finally；请求同步上锁阻止双击。
- [ ] App.tsx 自动钩子创建补传 subject，允许为空；保持用户 obsidianResult 修改。
- [ ] 服务、UI 专项及 vite build 通过后只提交本任务相关差异。

## 任务五：回归与项目记忆

文件：`tests/ui/run-creative-decision-ledger.cjs` 及对应测试、`AGENTS.md`、`docs/tool-builder/state.md`。

- [ ] 真实 UI 覆盖规则提示、空主体兜底、四类修订代表路径、历史预填、项目切换、重复操作与失败重试；实际 SQLite 测试覆盖同目标交错与整批回滚。
- [ ] 运行新功能专项、`node tests/ui/run-writing-workspace.cjs`、`node tests/ui/run-creative-decision-ledger.cjs`、`npm run test`、`npm run build`、`git diff --check`。
- [ ] 记录真实测试数量、已知限制、外部 AI 烟测是否执行；更新两份项目记忆并单独提交。
- [ ] 汇报所有提交号、验证结果和未验证项。

专项命令使用 `$env:ELECTRON_RUN_AS_NODE='1'` 后执行 `node_modules/electron/dist/electron.exe node_modules/vitest/vitest.mjs run <测试文件>`，在 finally 中恢复原环境变量。完整测试使用现有 `npm run test`。
