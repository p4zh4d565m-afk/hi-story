# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run

```bash
npm run dev              # Run dev (tsc main + electron + vite renderer)
npm run build            # Production build (main + renderer)
npm run start            # Rebuild native modules then launch electron
npm run test             # Run vitest tests
npm run electron:rebuild # Rebuild better-sqlite3 for Electron's Node version
```

**`npx vite build`** is the fastest way to verify TypeScript compiles across the full codebase (Vite bundles both renderer and imported main-process modules). No dev server or Electron needed.

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
- **Obsidian 导入策划** — 策划页「从 Obsidian 导入」把 Obsidian 里的总纲/分卷纲/章纲/人物/世界观单向导入策划工作台与原生列表（零 AI、只读不回写）。纯规则解析适配作者真实格式（无 frontmatter、表格章纲、`[[wiki链接]]`、有序列表）；核心在 `markdown-blocks.ts` + `import-parser.ts` + `import-candidates.ts` + `obsidian-import.repo.ts`。覆盖策略 keep/fill/replace/clear、锁定层默认保护、覆盖人物保留 `profileOutline`、世界观保留 `parentId`；commit 前有运行时 DTO validator、最终实体名称模拟、最终卷策略纯函数与三层动作语义（UI 预判与主进程共用同一纯函数）。真实 DOM 回归 `node tests/ui/run-obsidian-import.cjs`。**stage 落库（2026-09-11）**：卷内阶段文件（`分卷大纲/卷N/阶段N.md`）从「忽略」升级为独立 `stage` 候选，`parseStage` 一文件一阶段解析，`identifySlots` 先于 `/分卷/` 与 `role:volume` 判 stage，`volumeDirToIndex` 按父目录段预填归属卷；提交时 `overlayStages(finalVolumes, existingVolumes, stageDrafts)` 在最终卷列表上按 volumeIndex 归堆写入 `VolumeOutline.stages`（`volume_outlines` JSON 列，无迁移），空桶按导入前 `existingVolumes[i].stages ?? []` 保留（fill/replace 未勾阶段不擦除）、部分勾选整组替换不 merge、keep 只勾阶段也能写库、clear/未归属/越界/锁定未解锁均拦截；不第四策划层、不回填章纲/总纲、阶段不进 AI 上下文。parser 字段增强（章纲 pov/openingSituation/keyBeats/characterChange、总纲 phase 子字段）为「可选列/小节才解析、无来源留空」，真实 vault 这些字段仍为空
- **Stop Hook** — 每次会话结束自动执行 `npx vite build` + 提示音

## Git 远程仓库

- 仓库: `git@github.com:p4zh4d565m-afk/hi-story.git`
- SSH config (`~/.ssh/config`): GitHub 走 `ssh.github.com:443`（解决国内 22 端口被封）
