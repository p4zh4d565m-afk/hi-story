# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run

```bash
npm run dev              # Run dev (tsc main + electron + vite renderer)
npm run build            # Production build (main + renderer)
npm run typecheck:renderer # Renderer 全量 tsc --noEmit（jsx + DOM）
npm run start            # Rebuild native modules then launch electron
npm run test             # Electron-as-Node vitest（--pool=forks）
npm run electron:rebuild # Rebuild better-sqlite3 for Electron's Node version
```

**`npx vite build`** 只做打包转译，不跑完整类型检查。正式前端门槛是 `npm run typecheck:renderer`（`tsconfig.renderer.json`）；`build:renderer` 会先跑该门槛。主进程用 `npm run build:main`。

## Architecture

**Electron app** — main process (CommonJS) + renderer (React + Vite/ESM) + preload bridge.

**Data flow:** Renderer calls `window.electronAPI.invoke(channel, ...args)` → preload forwards to `ipcRenderer.invoke()` → main process `ipcMain.handle()` → Repository → SQLite (better-sqlite3, WAL mode). Results flow back as `IpcResult<T>` (`{ success, data? }` or `{ success: false, error }`).

**Build pipeline:** Two TypeScript configs targeting different module systems:
- `tsconfig.main.json` — `"module": "commonjs"`, outputs to `dist/main/`
- `tsconfig.renderer.json` — `"jsx": "react-jsx"` + DOM lib，仅 `tsc --noEmit`
- Vite — bundles renderer from `src/renderer/`, outputs to `dist/renderer/`
- The `main` field in `package.json` points to `dist/main/main/index.js`

### Main Process (`src/main/`)

- `index.ts` — Electron app lifecycle, window creation, global error handlers
- `db/connection.ts` — SQLite connection singleton, WAL mode, literary DB attachment
- `db/migrations.ts` — Single migration file (v1) with all tables
- `db/repositories/` — ChapterRepo, ProjectRepo, EntitiesRepo (characters, world entries, reference links), OutlineRepo
- `ipc/` — One file per domain (chapter.ipc.ts, ai.ipc.ts, etc.), all registered via `index.ts`
- `ai/` — `ProviderFactory` with presets for Claude (native Anthropic API), OpenAI-compatible endpoints (GPT, DeepSeek, 豆包, 通义千问, Moonshot, 智谱, custom); context builder; search engine for literary database FTS5
- `importer/` — TXT/ZIP novel import (zip-reader + main index)
- `menu.ts` — Native app menu with file/export actions, communicates to renderer via `webContents.send('menu:...')`

### Renderer (`src/renderer/`)

- `App.tsx` — Root component with `ErrorBoundary`; owns all entity state (chapters, characters, world entries, outline, relations) and panel toggles
- `components/` — All UI components
- `types/` — Shared TypeScript types (Chapter, Character, WorldEntry, IpcResult, etc.) and `electron.d.ts` for the preload API
- `hooks/` — `useProject.ts`, `useChapter.ts` (thin wrappers around IPC calls)
- `services/` — AI service, crypto service

### Preload (`src/preload/index.ts`)

Minimal bridge exposing `invoke`, `on`, `removeListener` via `contextBridge.exposeInMainWorld('electronAPI', api)`.

## Critical Implementation Details

### Chapter save flow (WritingArea.tsx)

The save mechanism has been hardened against data-loss race conditions:

1. **`RichEditor` is keyed by `activeChapter.id`** — switching chapters destroys and recreates the entire TipTap editor. The `content` prop seeds the editor from the App-level `chapters` state.

2. **`handleUpdate` captures the chapter ID at keystroke time**, not timer-fire time. The 2-second debounce timer checks that `activeChapterRef.current?.id` still matches before saving — if not, the save is skipped (the chapter-switch effect already flushed it).

3. **On chapter switch**, the `useEffect([activeChapter?.id])` flushes any pending save for the previous chapter immediately, then loads the new chapter's content. Uses refs (`chaptersRef`, `onSaveChapterRef`) to avoid stale closures.

4. **`handleSaveChapter` in App.tsx checks `res.success`** before updating local state — silent DB write failures no longer masquerade as successful saves.

### Planning committed snapshot

AI 对话只读 App 持有的 committed `PlanningIdea`，不得把策划页未保存草稿送进模型。`createPlanningLoader`：仅 `success:true` 才 `onApply`（`data===null` 是合法空策划）；失败走 `onError`，同项目不得清空已有快照。普通保存用 `db:planning:save` 返回值立刻 `onPlanningCommitted`。触及策划的 Obsidian 导入在 commit IPC 前必须调用必填回调 `onPlanningCommitStarted` → `reservePlanningWrite`。写库仲裁是进程内 `Map<projectId, number>` epoch，invoke 前同步比较+递增，失败不回滚；`saved` 回执还须 `isPlanningWriteCurrent` 才更新 UI。P0 不加 DB revision。

### IPC contract

Every IPC handler wraps its repository call in try/catch and returns `IpcResult<T>`. The renderer **must check `res.success`** before using the data.

### Native module: better-sqlite3

Native Node module compiled against Electron's V8（ABI 130）。After `npm install`, run `npm run electron:rebuild`，或在 `node_modules/better-sqlite3` 下 `npx prebuild-install --runtime electron --target 33.4.11`。If the app crashes with `NODE_MODULE_VERSION` mismatch, rebuild is needed. `npm run test` 走 Electron-as-Node 且强制 `--pool=forks`：Windows 上默认 threads 会把 sqlite 打成 `0xC0000409`。worktree 若缺 `dist/electron.exe`，先 `node node_modules/electron/install.js`。

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
.claude/
  settings.local.json   # Project-local hooks (Stop: vite build + bell)
  agents/               # Custom agents (hi-story-auditor)
```
始终使用中文回复，所有的解释，对话，代码注释都应显示中文
每次完成我的任务，请回答已完成，并有^-^表情符号
项目新增功能、踩坑经验、架构变更时，同步更新此文件，保持精简

## 已装技能

| 技能 | 路径 | 用途 |
|------|------|------|
| skill-creator | `~/.claude/skills/skill-creator/` | 创建/迭代自定义技能 |
| find-skills | `~/.claude/skills/find-skills/` | 搜索开源技能生态 |
| hi-story-auditor | `.claude/agents/` | 审计 Electron+React+SQLite 跨进程一致性 |

## 已实现功能

- **写作 Skill 引擎底座** — `npm run skills:sync` 从相邻的 `cc-write_skill 库/skills` 同步统一领域 Skill 到 `resources/writing-skills/`（当前 12 个）；主进程 `SkillRegistry` 提供清单、全文读取和按任务路由，通过 `skills:list/get/route` IPC 暴露。正式包通过 `extraResources` 携带 Skill 资源，后续策划工作台不得把方法全文硬编码进 UI prompt。
- **策划工作台（故事方案阶段）** — 顶栏可在「策划 / 写作」间切换；策划页保存用户创意与额外要求，按任务路由 Skill 后调用当前首个 AI 配置生成 3 个结构化故事方向，选择结果写入 `planning_ideas`。迁移 v11 只新增表，不改旧项目数据。
- **结构化全书总纲** — 确认故事方向后按 Skill 生成 4—6 个全书阶段，保存前提、结局、人物弧、核心冲突、结构理由、副线与故事承诺；字段和阶段可直接编辑、重新生成或锁定。迁移 v12 只为 `planning_ideas` 新增总纲字段。
- **结构化分卷纲** — 仅在全书总纲锁定后生成 2—10 卷，记录每卷目标、起止状态、主线/人物推进、关键事件、高潮及承诺收放；支持编辑、重生成和锁定。修改上游总纲会清空已失效的分卷纲。迁移 v13 新增分卷字段。
- **逐章章纲** — 分卷纲锁定后按卷生成，记录每章目标、开场处境、冲突代价、关键节拍、人物变化、信息揭示、回报与章末钩子；支持逐项编辑、单卷重生成和锁定。迁移 v14 新增章纲字段。
- **章纲到正文闭环** — 锁定章纲后可选择“自己写”创建空白正文，或把章纲送入 AI 代写面板；正文章节保存创建时的章纲快照，并在编辑器顶部显示可折叠施工卡。迁移 v15 新增章节章纲快照字段。
- **全书字数统计** — 小说名后显示 `{totalWords.toLocaleString()} 字`，统计所有章节 CJK 字符
- **章节保存防丢失** — 三层修复见上方 Critical Implementation Details
- **去 AI 味润色** — 工具栏「✨ 润色」整章润色 + 右键「✨ AI 润色」选中文本润色。保守润色（保留原意、只改不通顺/生硬/有 AI 味处），结果并排预览对比、确认后才写回。复用 `aiService.chatStream` + `POLISH_SYSTEM_PROMPT`，无需改 main 进程
- **内容安全红线** — `WRITE_SYSTEM_PROMPT` 内置「内容安全红线」段：禁止性行为/性器官/性暗示隐喻描写，亲密戏用含蓄留白+蒙太奇转场，确保生成内容通过番茄等网文平台审核
- **全书文风统计** — 审稿面板「📊 全书文风统计」Tab：纯本地正则零 LLM 统计全书句式 tic（章均频率/口头禅/跨章重复句/章末形态同构/开篇时间词率），发现单章看不出的固化 AI 味。参考 voocel/ainovel-cli 的 stylestat 设计，核心在 `runStyleStats`
- **组合式起名** — 起名助手离线兜底从「整词硬编码」升级为「姓×名用字组合式生成」（移植自 TulanCN/vibe-noveling 的 novel-name skill）。固定姓氏永远能出名字、离线大量不重复、防尬名（过滤霸天/弑神等）、含稀有度。核心在 `name-data.ts` + `name-generator.ts`，覆盖人物/势力/地点/装备/功法/怪兽 6 类
- **Obsidian 导入策划** — 策划页「从 Obsidian 导入」把 Obsidian 里的总纲/分卷纲/章纲/人物/世界观单向导入策划工作台与原生列表（零 AI、只读不回写）。纯规则解析适配作者真实格式（无 frontmatter、表格章纲、`[[wiki链接]]`、有序列表）；核心在 `markdown-blocks.ts` + `import-parser.ts` + `import-candidates.ts` + `obsidian-import.repo.ts`。覆盖策略 keep/fill/replace/clear、锁定层默认保护、覆盖人物保留 `profileOutline`、世界观保留 `parentId`；commit 前有运行时 DTO validator、最终实体名称模拟、最终卷策略纯函数与三层动作语义（UI 预判与主进程共用同一纯函数）。真实 DOM 回归 `node tests/ui/run-obsidian-import.cjs`。**stage 落库（2026-09-11）**：卷内阶段文件（`分卷大纲/卷N/阶段N.md`）从「忽略」升级为独立 `stage` 候选，`parseStage` 一文件一阶段解析，`identifySlots` 先于 `/分卷/` 与 `role:volume` 判 stage，`volumeDirToIndex` 按父目录段预填归属卷；提交时 `overlayStages(finalVolumes, existingVolumes, stageDrafts)` 在最终卷列表上按 volumeIndex 归堆写入 `VolumeOutline.stages`（`volume_outlines` JSON 列，无迁移），空桶按导入前 `existingVolumes[i].stages ?? []` 保留（fill/replace 未勾阶段不擦除）、部分勾选整组替换不 merge、keep 只勾阶段也能写库、clear/未归属/越界/锁定未解锁均拦截；不第四策划层、不回填章纲/总纲；落库轮阶段只在策划页只读列出、当时不进 AI 上下文（拆章注入见后文）。parser 字段增强（章纲 pov/openingSituation/keyBeats/characterChange、总纲 phase 子字段）为「可选列/小节才解析、无来源留空」，真实 vault 这些字段仍为空**。stages 进 AI 上下文（2026-09-11）**：把 `VolumeOutline.stages` 分级有界注入拆章 prompt（`formatStagesContext`，full 含关键推进/钩子、brief 只含边界，绝对卷号不错位）；写正文/普通对话不采纳（双份真相）；改总纲静默清空 stages 补总纲区就地提示
- **Stop Hook** — 每次会话结束自动执行 `npx vite build` + 提示音

- **A1–A6 生产管线收口（2026-09-12）** — 技术审查报告后的「第 0 步」确定 bug 修复 + 大纲真相收敛。**A6** 章节历史去掉 7 天过期、只按每章 30 份上限淘汰；**M3** 审稿接受修订弃 `'current'` 字面量、用真实 projectId + 回写 App；**M1** OpenAI 兼容路径读取 `systemPrompt`（抽 `merge-system-prompt.ts` 两端共用）；**M2** Provider 缓存键含 baseUrl + 完整 apiKey。**A3** 迁移 v20：`planning_ideas` 去重 + `UNIQUE(project_id)`，坏 JSON 由静默变空改为 `success:false` 报错，`save` 改为读-改-写合并（`undefined` 未传保留旧值、显式 `null`/`[]` 才清空，禁用 `??`）。**A2** 策划长任务完成后校验项目（`shouldApplyPlanningResult` + `persistPlanning` 后台写回不污染 UI）。**A1** 写章落库改同步链路：`create` 返回章节 id 并写 word_count，弃 sortOrder 猜章/套娃 timer/localStorage 旁路。**A5** 钩子单轨：写章抽取 `factType===hook` 走 `creative_decisions` proposed（新 IPC `createChapterExtractionProposals`，`factsToHookDrafts` 纯函数），非 hook 仍自动落库，停止 facts+hooks 双写。写章抽取不产债务（prompt 无 debt 类型）；债务仍走对话账本，写章抽债务另立 P2。**A4a** 普通对话改读策划（`createPlanningLoader` 独立加载失败不阻断 + `ContextBuilder.planningContext` 有策划时跳过 outlineNodes）。**A4b** 策划入口写章/审稿改读章纲（AI 代写不再复制 outline_nodes 节点；审稿有章纲则读章纲）。工具栏代写/批量仍读 outline_nodes，接章纲另立 P2。单测 323、写作 UI 12/12、决策账本 UI 16/16、Obsidian 导入 UI 114/114。参见 `docs/2026-09-12-A1-A6实施方案.md`
- **AI 流真实取消（一期，2026-09-12）** — 停止会 abort 主进程流；切项目作废映射并结束 for-await。复核补丁与下一步见 `docs/reports/ai-stream-cancel-report.md`。
- **工作区 P0 止血（2026-09-12）** — 灵感/参考/起名互斥；侧栏/AI/右栏宽度写入 `hi-story-panel-widths`；浮窗夹紧视口；顶栏 `flex-wrap`；AI 输入与润色区可拉高。未引入 docking 库，未改主题。核心在 `src/renderer/workspace/`。单测 `tests/unit/workspace-p0.test.ts` 12/12，写作 UI 12/12。
- **工作区 P1 主题（2026-09-12）** — CSS 变量令牌 + 顶栏浅色/深色切换（`hi-story-theme`）；Dark 外观与旧色板一致。写章/审稿/润色灰底与按钮显式白字未扫。
- **工作区 P2 分隔条与折叠（2026-09-12）** — 手写三条横向 splitter 换成 `react-resizable-panels` v4（`Group`/`Panel`/`Separator`/`useDefaultLayout`/`usePanelRef`）；仅侧栏折叠成 24px 边轨，AI/右栏关闭仍卸载；加纵向空 bottom 槽占位（P2 不渲染分隔条，P3 才放面板）。比例用 `useDefaultLayout` 持久化，P0 的 `hi-story-panel-widths` 只作首次种子不双写。核心在 `src/renderer/workspace/split-flags.ts`。单测 `tests/unit/workspace-p2.test.ts` 3/3，写作 UI 12/12。**手测修复两 bug（`30c08f1`）**：侧栏点 ☰ 未真 collapse 需双向同步 `expand/collapse`；条件渲染面板需给 `useDefaultLayout` 传 `panelIds` 否则刷新回默认。几何无 Electron E2E，靠手测，无自动回归锁。**第二人复核：** 先写 P3 计划再编码；`panelIds` 应抽纯函数单测；空 bottom 的 `minSize={120}` 是 P3 雷。详见 Spec「P2 收口第二人复核」。
- **工作区 P3 拖放进槽（2026-09-13 已落地）** — `WorkspaceLayoutV1` 管大纲/素材/伏笔/灵感/参考/起名入 right + 侧栏归属；**写章/审稿/润色保持浮动窗**（产品实测翻案，走布尔 + `display:none` 保活）；AI 对话不迁。拖拽 HTML5 drag（SlotTabs 标签 + 槽 onDrop + 拖拽期空槽热区）；空 bottom 卸载（有面板才挂 Separator）；顶栏 `openOrFocus` 不再把已拖走面板拽回默认槽；**面板归属不持久化，重启清空**（只保留槽比例）。删 WritingGoal，bottom 有面板时隐藏底部字数/状态栏。**技术债**：侧栏 `layout.slots.left` 未消费；拖拽无 Electron E2E。核心 `src/renderer/workspace/layout-model.ts` + `useWorkspaceLayout.ts`。单测 `workspace-layout` 17/17、`workspace-p2` 6/6，全量 373，写作 UI 12/12。
- **Obsidian 导入弹窗纵向分隔（2026-09-13 已落地）** — 候选/详情与导入方案之间用现有 `react-resizable-panels` 纵向 Group，默认 65/35、不写 localStorage；「确认导入」钉在下半底部。扫描中/失败不挂空分隔条。核心 `obsidian-import-split.ts`。与长篇生产 P0 同分支合入。拖动几何仍靠手测。
- **长篇生产 P0（2026-09-14 已合入 `feature/skill-engine`）** — 请求级 Provider 快照、策划 committed 快照 + 写库 epoch、写章预览分段文本节点（零 innerHTML）。含 Obsidian 导入分隔。HEAD `8a622f5`（代码止于 `6ff75e1`），现已在 `origin/feature/skill-engine`。合同 `docs/superpowers/specs/2026-09-13-ai-production-current-contract.md`。已接受偏差：无 `planningLoadError` UI（失败只 `console.error`）。P1 未授权；讨论稿第 1–11 节仍禁止编码。
- **叙事时间接入（2026-09-14，选项 B）** — 迁移 v21：`narrative_transitions` + 空 `chapter_alias` + 章节软删墓碑 + 事实 `state_key`/`archived`；重抽取/confirm/resolve/payDebt 同事务双写投影与转换；AI 对话/写章/审稿经 `db:narrative:buildAsOfContext` 固定截面（`reduce*AsOf`）。v21 重建章表在事务外关 FK，升级后 `foreign_key_check` 且历史/锚点数量不变；as-of 读 superseded 历史并输出业务内容；章纲稳定 ID 在生成/导入/保存时分配，建章写 `planningOutlineId`。不永久删除、不并章、不新增墓碑 UI。合同 `docs/superpowers/specs/2026-09-14-narrative-time-integration-design.md`。
- **叙事时间 fail-closed 手测收口（2026-09-15）** — 写章/审稿 as-of 失败阻断；对话失败不注入叙事。
- **写章 after_chapter as-of（#146，2026-09-15）** — 新章无 id 时 `write` + `placement:'after_chapter'` + 库内活跃末章锚点，虚拟下一章跑正式 `before_target`（含债务逾期）；禁再挂 `chat`/`planning`；无章返回空运行时 `before_target`。合同 `docs/superpowers/specs/2026-09-15-write-after-chapter-as-of-design.md`。
- **Renderer 全量类型检查门槛（#145，2026-09-15）** — `tsconfig.renderer.json` + `npm run typecheck:renderer`；`build:renderer` 先 typecheck 再 vite。
- **AI 对话清理** — 迁移 v22 消息软删 + batch 撤销；聊天面板按轮删/清空当前会话，约 10 秒内可恢复；清理粒度为项目内 thread，不绑定章节。
- **第一版稳定写作基线（2026-09-15）** — 标签 `writing-baseline-v1`；IPC 成功链路与可见 UI 验收报告见 `docs/reports/2026-09-15-writing-admission-joint-report.md`、`docs/reports/2026-09-15-visible-ui-admission-report.md`。日常启动 `Launch hi story.bat`；可见 UI 回归 `node tests/ui/run-visible-ui-admission.cjs`。
- **边写边维护（#147 / 其余 P2）** — 不再阻塞写作；先拆清单，优先数据安全、上下文正确性、后续开发阻断项。

## Git 远程仓库

- 仓库: `git@github.com:p4zh4d565m-afk/hi-story.git`
- SSH config (`~/.ssh/config`): GitHub 走 `ssh.github.com:443`（解决国内 22 端口被封）
