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

- **全书字数统计** — 小说名后显示 `{totalWords.toLocaleString()} 字`，统计所有章节 CJK 字符
- **章节保存防丢失** — 三层修复见上方 Critical Implementation Details
- **去 AI 味润色** — 工具栏「✨ 润色」整章润色 + 右键「✨ AI 润色」选中文本润色。保守润色（保留原意、只改不通顺/生硬/有 AI 味处），结果并排预览对比、确认后才写回。复用 `aiService.chatStream` + `POLISH_SYSTEM_PROMPT`，无需改 main 进程
- **内容安全红线** — `WRITE_SYSTEM_PROMPT` 内置「内容安全红线」段：禁止性行为/性器官/性暗示隐喻描写，亲密戏用含蓄留白+蒙太奇转场，确保生成内容通过番茄等网文平台审核
- **Stop Hook** — 每次会话结束自动执行 `npx vite build` + 提示音

## Git 远程仓库

- 仓库: `git@github.com:p4zh4d565m-afk/hi-story.git`
- SSH config (`~/.ssh/config`): GitHub 走 `ssh.github.com:443`（解决国内 22 端口被封）
