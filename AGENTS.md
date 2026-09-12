# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Build & Run

```bash
npm run dev              # Run dev (tsc main + electron + vite renderer)
npm run build            # Production build (main + renderer)
npm run start            # Rebuild native modules then launch electron
npm run test             # Run vitest tests
npm run electron:rebuild # Rebuild better-sqlite3 for Electron's Node version
```

**`npx vite build`** 用于验证前端打包，不执行完整 TypeScript 类型检查；主进程与 preload 使用 `npm run build:main` 验证。`tsconfig.main.json` 必须包含 `src/preload/**/*`，否则桥接代码不会更新。

Windows 下若 `npm run test` 的 Unix `rm` 不可用，或 Vitest 遇到 better-sqlite3 的 Node/Electron ABI 不匹配，可临时设置 `ELECTRON_RUN_AS_NODE=1`，用 `node_modules/electron/dist/electron.exe node_modules/vitest/vitest.mjs run` 执行测试，结束后恢复环境变量，无需覆盖应用使用的原生模块。

## Architecture

**Electron app** — main process (CommonJS) + renderer (React + Vite/ESM) + preload bridge.

**Data flow:** Renderer calls `window.electronAPI.invoke(channel, ...args)` → preload forwards to `ipcRenderer.invoke()` → main process `ipcMain.handle()` → Repository → SQLite (better-sqlite3, WAL mode). Results flow back as `IpcResult<T>` (`{ success, data? }` or `{ success: false, error }`).

**Build pipeline:** Two TypeScript configs targeting different module systems:
- `tsconfig.main.json` — `"module": "commonjs"`, outputs to `dist/main/`
- Vite — bundles renderer from `src/renderer/`, outputs to `dist/renderer/`
- The `main` field in `package.json` points to `dist/main/main/index.js`

### Main Process (`src/main/`)

- `index.ts` — Electron app lifecycle, window creation, global error handlers
- `db/connection.ts` — SQLite connection singleton, WAL mode, literary DB attachment
- `db/migrations.ts` — Single migration file (v1) with all tables
- `db/repositories/` — ChapterRepo, ProjectRepo, EntitiesRepo (characters, world entries, reference links), OutlineRepo
- `ipc/` — One file per domain (chapter.ipc.ts, ai.ipc.ts, etc.), all registered via `index.ts`
- `ai/` — `ProviderFactory` with presets for Codex (native Anthropic API), OpenAI-compatible endpoints (GPT, DeepSeek, 豆包, 通义千问, Moonshot, 智谱, custom); context builder; search engine for literary database FTS5
- `importer/` — TXT/ZIP novel import (zip-reader + main index)
- `menu.ts` — Native app menu with file/export actions, communicates to renderer via `webContents.send('menu:...')`

### Renderer (`src/renderer/`)

- `App.tsx` — Root component with `ErrorBoundary`; owns all entity state (chapters, characters, world entries, outline, relations) and panel toggles
- `components/` — All UI components
- `types/` — Shared TypeScript types (Chapter, Character, WorldEntry, IpcResult, etc.) and `electron.d.ts` for the preload API
- `hooks/` — `useProject.ts`, `useChapter.ts` (thin wrappers around IPC calls)
- `services/` — AI service, crypto service

### Preload (`src/preload/index.ts`)

Minimal bridge exposing `invoke` and `on` via `contextBridge.exposeInMainWorld('electronAPI', api)`. `on` returns an unsubscribe function so the preload keeps the original wrapped listener identity.

## Critical Implementation Details

### Project data load flow (App.tsx)

项目切换使用 `project-data-loader.ts` 的“项目 ID + 请求代次”双重校验：章节、大纲、人物、世界观和人物关系必须全部成功后才原子写入 React 状态；旧代次的成功、失败和 loading 回执一律忽略。选择动作会同步更新项目守卫，不能只在 `useEffect` 中判断，以免点击新项目到副作用执行之间的旧请求落地。独立面板的项目数据加载也必须复用同一守卫；切换项目先清除旧项目可见数据，当前项目刷新失败则保留已有完整快照。

### Obsidian readonly flow

迁移 v16 只在项目表保存 `obsidian_path`。`obsidian:scan` 按该项目路径只读扫描 Markdown，渲染端 `obsidian-loader.ts` 仍用“项目 ID + 请求代次”校验；它与核心 SQLite 快照分开加载，未配置、目录缺失和单文件损坏都不能阻断项目。禁止新增自动回写 Obsidian 的 IPC。AI 仅接收总计约 3500 token、单篇约 650 token 的摘录；人物、世界观和长期大纲优先参考 Obsidian，运行期事实仍以 SQLite 为准。使用说明见 `docs/obsidian.md`。

### AI conversation persistence

迁移 v17 将 AI 会话和消息正式归入 SQLite，并用 `data_migration_state` 按项目记录旧 `hi-story-threads-{projectId}` 的一次性导入；导入事务失败必须保留旧 localStorage 数据且不能留下部分记录。渲染端 `conversation-persistence.ts` 用项目 ID + 请求代次过滤迟到回执，加载失败不得用空快照覆盖当前状态。用户消息在发起 AI 请求前落库；assistant 消息仅在流正常结束后写入，中断、空回复或失败不得伪装成完整成功消息。创作决策确认账本不属于该链路。

### Creative decision ledger

迁移 v18 新增 `creative_decisions` 与 `creative_decision_effects`，每个迁移的 DDL 与版本登记必须处于同一事务。AI 提取只创建 `proposed`，作者确认由 `CreativeDecisionRepo.confirmMany` 在单个 SQLite 事务内校验归属、投影到事实/人物知识/叙事钩子/叙事债务、记录前后快照并更新状态。渲染端不得串联目标表 IPC，必须保留其他候选的未保存草稿并忽略切换项目后的旧操作回执。事实与人物知识的章节重抽取 `DELETE` 必须排除 `source_decision_id IS NOT NULL`，知识上下文只读 `active`。新决策不写旧 `foreshadowings`，不写 Obsidian。确认后四类运行时状态立即刷新到普通对话；未解决钩子与未偿债务另按“逾期债务→高强度钩子→临近到期→其他”进入写章、审稿和普通对话，独立预算最多约 800 token。

v19 为 hook/debt 增加 `subject`，作者提议及修订必填，底层 create 和 App.tsx 章节自动同步仍允许空主体。疑似相关项提示为主进程 NFKC 规则查询，空主体进入同类活跃兜底区；人物知识仅提示相关已有条目。修订由 `targetId` 决定路径，允许无父修订；同项目 `targetTable + targetId` 只能有一个 pending，创建、保存和确认以写事务互斥。有父 proposal 的父 ID 从数据库读取，类型及非空目标必须等于父投影。hook/debt 原地更新 subject 和决策来源，并保留 effect 前后快照。界面覆盖项目 ID + 代次守卫、历史预填和失败草稿恢复。真实回归先 `npm run build:main`，再 `node tests/ui/run-creative-decision-ledger.cjs`（独立隐藏窗口、内存 SQLite，不接触用户数据）。

### Chapter save flow (WritingArea.tsx)

The save mechanism has been hardened against data-loss race conditions:

1. **`RichEditor` is keyed by `activeChapter.id`** — switching chapters destroys and recreates the entire TipTap editor. The `content` prop seeds the editor from the App-level `chapters` state.

2. **`handleUpdate` captures the chapter ID at keystroke time**, not timer-fire time. The 2-second debounce timer checks that `activeChapterRef.current?.id` still matches before saving — if not, the save is skipped (the chapter-switch effect already flushed it).

3. **On chapter switch**, the `useEffect([activeChapter?.id])` flushes any pending save for the previous chapter immediately, then loads the new chapter's content. Uses refs (`chaptersRef`, `onSaveChapterRef`) to avoid stale closures.

4. **`handleSaveChapter` in App.tsx checks `res.success`** before updating local state — silent DB write failures no longer masquerade as successful saves.

5. **策划/写作切换保留编辑器挂载** — `DockLayout` 用 `hidden` 隐藏写作区，保留待保存正文并继续执行两秒防抖保存，避免快速返回时读到旧正文。`WritingArea.isActive` 控制 Ctrl+S 监听，隐藏时不接管快捷键。真实编辑器回归命令：`node tests/ui/run-writing-workspace.cjs`（独立隐藏 Electron 窗口、临时目录及内存数据）。

6. **保存失败保留正文** — `onSaveChapter` 返回明确成功布尔值；`WritingArea` 按章节保留待保存正文，失败时显示“保存失败、等待重试”，1 秒后自动重试（最多 2 次）且可点击立即重试。切章往返优先恢复草稿，只有对应内容成功落库后才清除。

### IPC contract

Every IPC handler wraps its repository call in try/catch and returns `IpcResult<T>`. The renderer **must check `res.success`** before using the data.

### Native module: better-sqlite3

Native Node module compiled against Electron's V8. After `npm install`, run `npm run electron:rebuild`. If the app crashes with `NODE_MODULE_VERSION` mismatch, rebuild is needed.

### TipTap editor

Uses ProseMirror under the hood. Document structure: `doc` → block nodes (paragraph, heading, etc.) → inline nodes (text, marks, hard_break). `hard_break` = Shift+Enter in TipTap. The smart format button (`handleSmartFormat`) iterates `doc.forEach` (direct children only) to preserve paragraph boundaries.

## File Structure (non-obvious)

```
dist/                   # Build output
  main/                 # tsc output (CommonJS)
  renderer/             # Vite output
src/
  main/                 # Electron main process (CommonJS)
  preload/              # contextBridge (CommonJS)
  renderer/             # React app (ESM via Vite)
resources/
  literary.db           # FTS5 literary knowledge database (bundled)
.Codex/
  settings.local.json   # Project-local hooks (Stop: vite build + bell)
  agents/               # Custom agents (hi-story-auditor)
```
始终使用中文回复，所有的解释，对话，代码注释都应显示中文
每次完成我的任务，请回答已完成，并有^-^表情符号
项目新增功能、踩坑经验、架构变更时，同步更新此文件，保持精简

## 已装技能

| 技能 | 路径 | 用途 |
|------|------|------|
| skill-creator | `~/.Codex/skills/skill-creator/` | 创建/迭代自定义技能 |
| find-skills | `~/.Codex/skills/find-skills/` | 搜索开源技能生态 |
| hi-story-auditor | `.Codex/agents/` | 审计 Electron+React+SQLite 跨进程一致性 |

## 已实现功能

- **疑似相关项提示与修订（2026-09-10）** — 纯规则查询、空主体兜底、独立确认/修订/取消、无父目标修订和已确认历史修订入口；全量 122 项测试、写作 UI 10 项、决策 UI 16 项通过，后者包含真实 React→IPC→内存 SQLite 的四类修订、交错互斥和故障回滚。请求进行中禁止关闭决策面板，确保成功回执刷新上下文。外部 AI 烟测未执行。

- **维护修复（2026-09-07）** — preload 的 `on` 返回取消订阅函数，菜单与 AI 流式消息统一调用该函数释放监听，避免跨 contextBridge 比较回调引用；启动清理仅针对 768 维 Float32 旧向量（3072 字节），保留已构建的 1024 维索引。详情见 `docs/maintenance-review-2026-09-07.md`。

- **写作 Skill 引擎底座** — `npm run skills:sync` 从相邻的 `cc-write_skill 库/skills` 同步统一领域 Skill 到 `resources/writing-skills/`（当前 12 个）；主进程 `SkillRegistry` 提供清单、全文读取和按任务路由，通过 `skills:list/get/route` IPC 暴露。正式包通过 `extraResources` 携带 Skill 资源，后续策划工作台不得把方法全文硬编码进 UI prompt。
- **策划工作台（故事方案阶段）** — 顶栏可在「策划 / 写作」间切换；策划页保存用户创意与额外要求，按任务路由 Skill 后调用当前首个 AI 配置生成 3 个结构化故事方向，选择结果写入 `planning_ideas`。迁移 v11 只新增表，不改旧项目数据。
- **结构化全书总纲** — 确认故事方向后按 Skill 生成 4—6 个全书阶段，保存前提、结局、人物弧、核心冲突、结构理由、副线与故事承诺；字段和阶段可直接编辑、重新生成或锁定。迁移 v12 只为 `planning_ideas` 新增总纲字段。
- **结构化分卷纲** — 仅在全书总纲锁定后生成 2—10 卷，记录每卷目标、起止状态、主线/人物推进、关键事件、高潮及承诺收放；支持编辑、重生成和锁定。修改上游总纲会清空已失效的分卷纲。迁移 v13 新增分卷字段。
- **逐章章纲** — 分卷纲锁定后按卷生成，记录每章目标、开场处境、冲突代价、关键节拍、人物变化、信息揭示、回报与章末钩子；支持逐项编辑、单卷重生成和锁定。迁移 v14 新增章纲字段。
- **章纲到正文闭环** — 锁定章纲后可选择“自己写”创建空白正文，或把章纲送入 AI 代写面板；正文章节保存创建时的章纲快照，并在编辑器顶部显示可折叠施工卡。迁移 v15 新增章节章纲快照字段。
- **全书字数统计** — 小说名后显示 `{totalWords.toLocaleString()} 字`，统计所有章节 CJK 字符
- **章节保存防丢失** — 保存失败保留待保存正文并显示重试入口；切章、延迟回执与策划/写作切换防护见上方 Critical Implementation Details
- **项目异步加载隔离** — 项目选择与五类核心数据加载使用请求代次及当前项目双重校验，整组数据成功后原子提交；旧项目迟到或失败的回执不会覆盖当前界面，策划、素材、伏笔和角色关联加载遵守同一约束
- **Obsidian 单向读取 MVP** — 每个项目可配置独立目录，只读扫描人物、世界观和长期大纲 Markdown，支持 YAML frontmatter、文件隔离告警、只读浏览和有界 AI 上下文；保留全部原有 SQLite 模块，不监听或回写 Obsidian
- **AI 会话 SQLite 持久化** — 会话、消息、顺序、功能上下文和更新时间按项目落库；旧 localStorage 会话事务化导入一次且保留原数据，项目竞态与加载失败隔离，流式失败不会写入完整 AI 消息
- **创作决策确认账本** — AI 已落库回复可整理为四类结构化提议；作者编辑、拒绝或批量确认后，由 v18 账本单事务写入运行时表并记录 effect，支持幂等确认、单线修订、写入结果与历史查看。章节重抽取保护作者确认状态，确认后四类状态立即刷新到普通对话，开放钩子与未偿债务按 800 token 独立预算进入后续 AI 上下文
- **去 AI 味润色** — 工具栏「✨ 润色」整章润色 + 右键「✨ AI 润色」选中文本润色。保守润色（保留原意、只改不通顺/生硬/有 AI 味处），结果并排预览对比、确认后才写回。复用 `aiService.chatStream` + `POLISH_SYSTEM_PROMPT`，无需改 main 进程
- **内容安全红线** — `WRITE_SYSTEM_PROMPT` 内置「内容安全红线」段：禁止性行为/性器官/性暗示隐喻描写，亲密戏用含蓄留白+蒙太奇转场，确保生成内容通过番茄等网文平台审核
- **全书文风统计** — 审稿面板「📊 全书文风统计」Tab：纯本地正则零 LLM 统计全书句式 tic（章均频率/口头禅/跨章重复句/章末形态同构/开篇时间词率），发现单章看不出的固化 AI 味。参考 voocel/ainovel-cli 的 stylestat 设计，核心在 `runStyleStats`
- **组合式起名** — 起名助手离线兜底从「整词硬编码」升级为「姓×名用字组合式生成」（移植自 TulanCN/vibe-noveling 的 novel-name skill）。固定姓氏永远能出名字、离线大量不重复、防尬名（过滤霸天/弑神等）、含稀有度。核心在 `name-data.ts` + `name-generator.ts`，覆盖人物/势力/地点/装备/功法/怪兽 6 类
- **Obsidian 导入策划** — 策划页「从 Obsidian 导入」把 Obsidian 里的总纲/分卷纲/章纲/人物/世界观单向导入策划工作台与原生列表（零 AI、只读不回写）。纯规则解析适配作者真实格式（无 frontmatter、表格章纲、`[[wiki链接]]`、有序列表）；核心在 `markdown-blocks.ts` + `import-parser.ts` + `import-candidates.ts` + `obsidian-import.repo.ts`。方案 A1+B1+C1+D1+E1 定案：不新增迁移、先导入后补字段、固定资源上限（2MiB/500/50MiB）、进程内 operationId 幂等、`obsidian:*` IPC。覆盖策略 keep/fill/replace/clear，锁定层默认保护，覆盖人物保留 `profileOutline`、世界观保留 `parentId`。**闭环补齐（2026-09-10）**：commit 前有运行时 DTO validator（`import-validator.ts`）、最终实体名称模拟（`entity-name-simulator.ts`）、最终卷策略纯函数（`final-volumes.ts`）、override 归一化合并（`override-merge.ts`）与三层动作语义（`layer-actions.ts`），UI 预判与主进程校验共用同一纯函数；reparse 有全局 epoch + 候选级代次 + pending 提交门禁；写库成功后进入 refreshPending，刷新失败只重试 `onImported` 不重复 commit。真实 DOM 回归 `node tests/ui/run-obsidian-import.cjs`（92/92 check）断言三层 JSON 内容、锁定解锁、手动分类、上下游非法组合、提交期间全控件冻结、reparse 失败重试结果落地与刷新重试。**自动验收收敛（2026-09-11）**：`createImportedEntitiesRefresher` 抽出实体刷新（App 与测试共用），真实挂载 PlanningWorkspace 证明 planning/entity IPC 失败时面板停留 refreshPending、刷新中关闭门禁与并发双击互斥。**8.4 安全烟测与总纲预览对照已通过**（已授权真实项目「我有一个妹妹」目录，一次性本地跑过，脚本未入库）：复制到临时副本、记录原目录 39 文件 hash、内存库只指向副本、主进程仓储跑完扫描/DTO 校验/名称模拟/卷策略/事务写库（24/24，含原目录 hash 完全不变、删副本）；再以副本路径挂真实导入面板，总纲 premise/ending/phase 标题与 commit 后 SQLite JSON 同词包含（12/12）。本项目策划为空、无锁定层，解锁沿用 8.3 D 组真实 DOM 回归。**parser 字段增强（2026-09-11）**：章纲 `pov/openingSituation/keyBeats/characterChange` 与总纲 phase 子字段（`purpose/turningPoint/emotionTrend/keyEvents`）改为「可选列/小节」解析——仅当表头命中对应列（视角/开场处境/关键节拍/人物变化）或 phase 以「heading + 小节列表」形式存在时才填充，未命中留空（绝不猜测、绝不跨文件推导）；`isOutlineAuxiliary` 让卷内阶段文件（`分卷大纲/卷N/阶段N.md`，文件名以 `阶段N` 开头才忽略）与分卷总览（`小说大纲_分卷大纲.md`）不再误判为卷、导入时忽略；phase heading 需完整命中「阶段 N：标题（第 x-y 章）」才走小节路径，否则回退三卷索引。自动回归通过（256 单测 + build:main + vite build + UI 92/92），真实副本烟测有书面记录（volume 候选数 = 3、37 个 md 的 SHA-256 前 12 位 hash 一致、脚本未入库），未做第二人独立复跑。注意：当前 vault 的章纲 `pov/openingSituation/keyBeats/characterChange` 与总纲 phase 子字段**仍为空**（真实 Markdown 无这些列/小节），本轮收益是「可选才解析 + 修误判」，不是已从这本书解析出这些字段**。stage 落库（2026-09-11）**：卷内阶段文件（`分卷大纲/卷N/阶段N.md`）从「导入时忽略」升级为独立 `stage` 候选，`parseStage` 一文件一阶段解析（标题/这一阶段做什么/关键推进/主要人物/调用的世界观/阶段出口/可选卷末钩子，`查看逐章细纲` 导航段只忽略该小节本身）；`identifySlots` 先于 `/分卷/` 与 `role:volume` 判 stage，`isOutlineAuxiliary` 只保留分卷总览忽略；`volumeDirToIndex` 按父目录段预填归属卷（卷一/卷1=0）。提交时 `overlayStages` 在 `computeFinalVolumes` 结果上按 `volumeIndex` 归堆写入对应卷 `VolumeOutline.stages`（`volume_outlines` JSON 列，**无迁移**）；keep 且只勾阶段也能写库（`touchesPlanning` 已含 stage）、fill/replace 未勾阶段不擦除已有 stages（空桶按 `existingVolumes[i].stages ?? []` 保留）、部分勾选整组替换不 merge、clear/未归属/越界/最终无卷/分卷纲锁定未解锁均拦截。不新增第四策划层、不回填章纲/总纲；落库轮阶段只在策划页只读列出、当时不进 AI 上下文（拆章注入见后文）。UI 回归 `node tests/ui/run-obsidian-import.cjs` 增到 **102/102**（场景 N 勾阶段+keep 归堆、场景 O 锁定分卷+勾阶段的解锁勾选，第二人独立复跑）。真实 vault 未做第二轮独立复跑，仅 fixture 覆盖（真实卷 1 有 5 个阶段文件、卷 2/3 无）**。stages 进 AI 上下文（2026-09-11）**：把已落库的 `VolumeOutline.stages` 以分级有界形式注入**拆章** prompt——`formatStagesContext(entries, 'full'|'brief')` 纯函数按 `StageContextEntry.index` 渲染绝对卷号（切片传入不错位）、full 含 keyProgressions 与非空 endingHook、brief 只含标题/章范围/目标/出口，均不泄漏 characters/worldRefs；`buildChapterOutlinesPrompt` 当前卷注入完整形、相邻卷注入精简形，**当前卷无 stages 则整段不注入**，卷 JSON 仍剥掉 stages 不重复。写正文与普通对话**不采纳**（写正文已通过章纲 marker 拿到章级产物、普通对话会与 outline_nodes 形成双份真相）。**改总纲清空阶段的就地提示**：`updateOutlineField`/`updatePhase` 改总纲会静默清空分卷纲与 stages（不写库），本轮加独立 `stageClearedNotice` state 在总纲区内就地渲染完成时文案（区分「本地清空」与「写库」，不复用页首 error 通道）。「重新生成分卷纲会清空 stages」定案选「不做 + 记风险」（真相源在 Obsidian，清空是缓存失效可重导），仍是独立 P2。UI 回归增到 **110/110**（场景 P 改总纲清空提示 P0—P7）
- **Stop Hook** — 每次会话结束自动执行 `npx vite build` + 提示音

- **A1–A6 生产管线收口（2026-09-12）** — 技术审查报告后「第 0 步」确定 bug 修复 + 大纲真相收敛。**A6** 章节历史去掉 7 天过期、只按每章 30 份上限淘汰；**M3** 审稿接受修订弃 `'current'` 字面量、用真实 projectId + 回写 App；**M1** OpenAI 兼容路径读取 `systemPrompt`（抽 `merge-system-prompt.ts` 两端共用）；**M2** Provider 缓存键含 baseUrl + 完整 apiKey。**A3** 迁移 v20：`planning_ideas` 去重 + `UNIQUE(project_id)`，坏 JSON 由静默变空改为 `success:false` 报错，`save` 改为读-改-写合并（`undefined` 未传保留旧值、显式 `null`/`[]` 才清空，禁用 `??`）。**A2** 策划长任务完成后校验项目（`shouldApplyPlanningResult` + `persistPlanning` 后台写回不污染 UI）。**A1** 写章落库改同步链路：`create` 返回章节 id 并写 word_count，弃 sortOrder 猜章/套娃 timer/localStorage 旁路。**A5** 钩子单轨：写章抽取 `factType===hook` 走 `creative_decisions` proposed（新 IPC `createChapterExtractionProposals`，`factsToHookDrafts` 纯函数），非 hook 仍自动落库，停止 facts+hooks 双写。写章抽取不产债务（prompt 无 debt 类型）；债务仍走对话账本，写章抽债务另立 P2。**A4a** 普通对话改读策划（`createPlanningLoader` 独立加载失败不阻断 + `ContextBuilder.planningContext` 有策划时跳过 outlineNodes）。**A4b** 策划入口写章/审稿改读章纲（AI 代写不再复制 outline_nodes 节点；审稿有章纲则读章纲）。工具栏代写/批量仍读 outline_nodes，接章纲另立 P2。单测 323、写作 UI 12/12、决策账本 UI 16/16、Obsidian 导入 UI 114/114。参见 `docs/2026-09-12-A1-A6实施方案.md`
- **AI 流真实取消（一期，2026-09-12）** — Spec 一期。`ChatOptions.signal` 贯穿 Claude / OpenAI 兼容路径；主进程 `stream-registry` + `ai:cancelStream`；渲染端 `streamId→projectId` 映射。**复核补丁：** `cancel` 后从注册表删除；`ignoreProjectStreams` 必须 wake 并抛 `AI_IGNORED_MESSAGE` 结束 for-await（否则 complete 会把旧草稿 yield 进新项目）；审稿主路径改为 `chatStream`，关审稿/润色面板会取消。切项目仍不 abort 主进程。踩坑：主进程取消后不再发事件，必须 wake generator；complete 与最后 token 同 tick 会丢尾巴，先 drain 再判 finished。单测 `tests/unit/stream-registry.test.ts`、`tests/unit/ai-stream-cancel.test.ts`。真实供应商烟测未做。详情见工作区 `ai-stream-cancel-report.md`。
- **工作区 P0 止血（2026-09-12）** — 灵感/参考/起名互斥打开；三栏宽度 `localStorage['hi-story-panel-widths']`；浮窗 move/resize/窗口缩放夹紧视口；顶栏 `flex-wrap`；AI 输入 `resize-y`、润色区解除 340px 双锁。不上 docking 库、不改主题色。纯函数在 `src/renderer/workspace/`。单测 12/12，写作 UI 12/12。Spec：`docs/superpowers/specs/2026-09-12-dockable-workspace-theme-design.md`。

## Git 远程仓库

- 仓库: `git@github.com:p4zh4d565m-afk/hi-story.git`
- SSH config (`~/.ssh/config`): GitHub 走 `ssh.github.com:443`（解决国内 22 端口被封）
