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

Windows 下若 Vitest 遇到 better-sqlite3 的 Node/Electron ABI 不匹配，可临时设置 `ELECTRON_RUN_AS_NODE=1`，用 `node_modules/electron/dist/electron.exe node_modules/vitest/vitest.mjs run` 执行测试，结束后恢复环境变量，无需覆盖应用使用的原生模块。

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
- **去 AI 味润色** — 工具栏「✨ 润色」整章润色 + 右键「✨ AI 润色」选中文本润色。保守润色（保留原意、只改不通顺/生硬/有 AI 味处），结果并排预览对比、确认后才写回。复用 `aiService.chatStream` + `POLISH_SYSTEM_PROMPT`，无需改 main 进程
- **内容安全红线** — `WRITE_SYSTEM_PROMPT` 内置「内容安全红线」段：禁止性行为/性器官/性暗示隐喻描写，亲密戏用含蓄留白+蒙太奇转场，确保生成内容通过番茄等网文平台审核
- **全书文风统计** — 审稿面板「📊 全书文风统计」Tab：纯本地正则零 LLM 统计全书句式 tic（章均频率/口头禅/跨章重复句/章末形态同构/开篇时间词率），发现单章看不出的固化 AI 味。参考 voocel/ainovel-cli 的 stylestat 设计，核心在 `runStyleStats`
- **组合式起名** — 起名助手离线兜底从「整词硬编码」升级为「姓×名用字组合式生成」（移植自 TulanCN/vibe-noveling 的 novel-name skill）。固定姓氏永远能出名字、离线大量不重复、防尬名（过滤霸天/弑神等）、含稀有度。核心在 `name-data.ts` + `name-generator.ts`，覆盖人物/势力/地点/装备/功法/怪兽 6 类
- **Stop Hook** — 每次会话结束自动执行 `npx vite build` + 提示音

## Git 远程仓库

- 仓库: `git@github.com:p4zh4d565m-afk/hi-story.git`
- SSH config (`~/.ssh/config`): GitHub 走 `ssh.github.com:443`（解决国内 22 端口被封）
