# hi story Phase 1 — 核心框架与小说项目管理 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭建 hi story 桌面应用的骨架：Electron 壳、React + TypeScript 渲染层、SQLite 数据层，以及小说项目的 CRUD 与导航栏布局。Phase 1 完成后，用户可以通过 UI 创建/打开/删除小说项目，看到三栏布局的导航结构。

**Architecture:** Electron 主进程负责窗口管理、菜单、IPC 桥接；Preload 脚本暴露安全的 API 到渲染进程；渲染进程用 React + TypeScript，状态管理用 React Context + useReducer；数据层通过 better-sqlite3 在主进程运行，渲染进程通过 IPC 调用；SQLite 使用 WAL 模式。

**Tech Stack:** Electron 33+, React 18, TypeScript 5, better-sqlite3 11+, Vite (渲染进程打包), Tailwind CSS 3

## Global Constraints

- 所有本地数据存于 `%APPDATA%/hi-story/` 下
- SQLite WAL 模式必须开启
- IPC 通道命名规范：`db:<operation>` 用于数据库操作，`app:<action>` 用于应用行为
- TypeScript strict mode 必须启用
- 每个数据实体必须有 `id`（UUID v4）、`created_at`、`updated_at` 字段
- 所有文件路径使用 forward slash（`/`）

---

## 文件结构总览

```
hi-story/
├── package.json                    # 根包配置
├── tsconfig.json                   # 根 TS 配置
├── electron-builder.yml            # 打包配置
├── src/
│   ├── main/                       # Electron 主进程
│   │   ├── index.ts                # 入口：创建窗口、注册 IPC
│   │   ├── ipc/
│   │   │   ├── index.ts            # IPC 注册中心
│   │   │   └── project.ipc.ts      # 项目相关 IPC handler
│   │   ├── db/
│   │   │   ├── connection.ts       # SQLite 连接管理
│   │   │   ├── migrations.ts       # 数据库迁移
│   │   │   └── repositories/
│   │   │       └── project.repo.ts # 项目数据访问层
│   │   └── menu.ts                 # 应用菜单模板
│   ├── preload/
│   │   └── index.ts                # Preload 脚本（contextBridge）
│   └── renderer/                   # React 渲染进程
│       ├── index.html
│       ├── main.tsx                # React 入口
│       ├── App.tsx                 # 根组件
│       ├── types/
│       │   └── index.ts            # 共享类型定义
│       ├── hooks/
│       │   └── useProject.ts       # 项目状态 hook
│       ├── components/
│       │   ├── Layout.tsx          # 三栏布局容器
│       │   ├── Sidebar.tsx         # 左侧导航栏
│       │   ├── ProjectList.tsx     # 项目列表
│       │   ├── MainArea.tsx        # 中间主区域（占位）
│       │   ├── ContextPanel.tsx    # 右侧上下文面板（占位）
│       │   └── CreateProjectDialog.tsx  # 创建项目对话框
│       └── styles/
│           └── index.css           # Tailwind 入口
├── resources/                      # 静态资源
│   └── icon.png
└── tests/
    ├── unit/
    │   └── db/
    │       └── project.repo.test.ts
    └── e2e/
        └── project-crud.test.ts
```

---

### Task 1: 项目脚手架与构建配置

**Files:**
- Create: `package.json`, `tsconfig.json`, `electron-builder.yml`, `vite.config.ts` (x2), `.gitignore`
- Create: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html`, `src/renderer/main.tsx`, `src/renderer/App.tsx`, `src/renderer/styles/index.css`
- Create: `tailwind.config.js`, `postcss.config.js`

**Interfaces:**
- Produces: Electron 窗口启动成功，渲染进程可加载 React 应用
- Produces: `npm run dev` 启动开发模式，`npm run build` 生产构建

- [ ] **Step 1: 初始化 package.json 和安装依赖**

```bash
mkdir hi-story && cd hi-story
```

创建 `package.json`:
```json
{
  "name": "hi-story",
  "version": "0.1.0",
  "description": "小说写作辅助工具",
  "main": "dist/main/index.js",
  "scripts": {
    "dev": "concurrently \"npm run dev:main\" \"npm run dev:renderer\"",
    "dev:main": "tsc -p tsconfig.main.json && electron .",
    "dev:renderer": "vite",
    "build:main": "tsc -p tsconfig.main.json",
    "build:renderer": "vite build",
    "build": "npm run build:main && npm run build:renderer",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@types/uuid": "^10.0.0",
    "autoprefixer": "^10.4.19",
    "concurrently": "^8.2.2",
    "electron": "^33.0.0",
    "electron-builder": "^25.1.0",
    "postcss": "^8.4.38",
    "tailwindcss": "^3.4.4",
    "typescript": "^5.5.3",
    "vite": "^5.3.3",
    "vitest": "^1.6.0"
  },
  "dependencies": {
    "better-sqlite3": "^11.1.2",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "uuid": "^10.0.0"
  }
}
```

Run: `npm install`

- [ ] **Step 2: 配置 TypeScript**

创建 `tsconfig.json`（根配置，供 IDE 使用）:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "exclude": ["node_modules", "dist"]
}
```

创建 `tsconfig.main.json`（主进程专用）:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "module": "commonjs",
    "outDir": "dist/main",
    "rootDir": "src/main"
  },
  "include": ["src/main/**/*"]
}
```

- [ ] **Step 3: 配置 Vite（渲染进程）**

创建 `vite.config.ts`:
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  root: 'src/renderer',
  base: './',
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/renderer'),
    },
  },
  server: {
    port: 5173,
  },
});
```

- [ ] **Step 4: 配置 Tailwind CSS**

创建 `tailwind.config.js`:
```javascript
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        sidebar: { DEFAULT: '#1e1e2e', hover: '#2a2a3c', active: '#363650' },
        accent: '#7c5cfc',
      },
    },
  },
  plugins: [],
};
```

创建 `postcss.config.js`:
```javascript
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

创建 `src/renderer/styles/index.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

html, body, #root {
  @apply h-full m-0 p-0 overflow-hidden;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif;
}
```

- [ ] **Step 5: 创建 Electron 主进程入口**

创建 `src/main/index.ts`:
```typescript
import { app, BrowserWindow } from 'electron';
import path from 'path';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    title: 'hi story',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
```

- [ ] **Step 6: 创建 Preload 脚本**

创建 `src/preload/index.ts`:
```typescript
import { contextBridge, ipcRenderer } from 'electron';

export interface ElectronAPI {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  on: (channel: string, callback: (...args: unknown[]) => void) => void;
  removeListener: (channel: string, callback: (...args: unknown[]) => void) => void;
}

const api: ElectronAPI = {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (channel, callback) => ipcRenderer.on(channel, (_event, ...args) => callback(...args)),
  removeListener: (channel, callback) => ipcRenderer.removeListener(channel, callback),
};

contextBridge.exposeInMainWorld('electronAPI', api);
```

- [ ] **Step 7: 创建渲染进程入口**

创建 `src/renderer/index.html`:
```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';" />
  <title>hi story</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="./main.tsx"></script>
</body>
</html>
```

创建 `src/renderer/main.tsx`:
```typescript
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/index.css';

const container = document.getElementById('root')!;
const root = createRoot(container);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

创建 `src/renderer/App.tsx`:
```typescript
import React from 'react';

const App: React.FC = () => {
  return (
    <div className="h-full flex items-center justify-center bg-gray-900 text-white">
      <h1 className="text-3xl font-bold">hi story</h1>
    </div>
  );
};

export default App;
```

- [ ] **Step 8: 创建 .gitignore**

```bash
cat > .gitignore << 'EOF'
node_modules/
dist/
.env
*.db
*.db-journal
*.db-wal
.DS_Store
thumbs.db
EOF
```

- [ ] **Step 9: 验证开发模式启动**

```bash
npm run dev
```

Expected: Electron 窗口打开，显示 "hi story" 标题。

- [ ] **Step 10: Commit**

```bash
git init
git add -A
git commit -m "feat: scaffold Electron + React + TypeScript + Tailwind project"
```

---

### Task 2: 共享类型定义

**Files:**
- Create: `src/renderer/types/index.ts`

**Interfaces:**
- Produces: `Project`, `CreateProjectInput`, `UpdateProjectInput` 类型
- Produces: TypeScript 类型可在主进程和渲染进程间共享

- [ ] **Step 1: 定义核心类型**

创建 `src/renderer/types/index.ts`:
```typescript
// ===== 小说项目 =====
export interface Project {
  id: string;
  name: string;
  typeTags: string[];       // 类型标签: ["仙侠", "宫斗"]
  style: string;             // 风格描述
  summary: string;           // 简介
  createdAt: string;         // ISO 8601
  updatedAt: string;         // ISO 8601
}

export interface CreateProjectInput {
  name: string;
  typeTags?: string[];
  style?: string;
  summary?: string;
}

export interface UpdateProjectInput {
  id: string;
  name?: string;
  typeTags?: string[];
  style?: string;
  summary?: string;
}

// ===== 数据库通用 =====
export interface PaginationParams {
  limit?: number;
  offset?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
}

// ===== IPC 响应 =====
export interface IpcResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

// ===== 窗口状态 =====
export type MainView = 'write' | 'chat' | 'canvas';

// ===== 关联引用 =====
export type EntityType = 'project' | 'character' | 'chapter' | 'world_entry' | 'outline_node' | 'conversation' | 'material';

export interface ReferenceLink {
  id: string;
  sourceType: EntityType;
  sourceId: string;
  targetType: EntityType;
  targetId: string;
  relationType: string;
  createdAt: string;
}

// ===== 后续模块占位类型 =====
export interface OutlineNode {
  id: string;
  projectId: string;
  parentId: string | null;
  title: string;
  summary: string;
  sortOrder: number;
}

export interface Character {
  id: string;
  projectId: string;
  name: string;
  aliases: string;
  appearance: string;
  personality: string;
  background: string;
  arc: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorldEntry {
  id: string;
  projectId: string;
  parentId: string | null;
  category: 'place' | 'faction' | 'race' | 'law' | 'history' | 'culture';
  name: string;
  description: string;
  sortOrder: number;
}

export interface Chapter {
  id: string;
  projectId: string;
  title: string;
  content: string;          // HTML (TipTap 输出)
  status: 'draft' | 'final';
  wordCount: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationThread {
  id: string;
  projectId: string;
  title: string;
  category: 'character' | 'plot' | 'world' | 'general';
  createdAt: string;
}

export interface ConversationMessage {
  id: string;
  threadId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  providerId?: string;
  timestamp: string;
}

export interface Material {
  id: string;
  projectId: string | null;  // null = 全局素材
  sourceLayer: 'public_domain' | 'history_military' | 'myth_fantasy' | 'dictionary' | 'user';
  title: string;
  content: string;
  url: string | null;
  tags: string[];
  createdAt: string;
}

export interface AIConfig {
  id: string;
  provider: string;
  apiKey: string;           // 加密存储
  model: string;
  baseUrl: string;
  isActive: boolean;
  createdAt: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/types/index.ts
git commit -m "feat: define core TypeScript types for all entities"
```

---

### Task 3: SQLite 数据库连接与迁移

**Files:**
- Create: `src/main/db/connection.ts`
- Create: `src/main/db/migrations.ts`

**Interfaces:**
- Produces: `getDb()` 返回 SQLite 数据库实例（WAL 模式）
- Produces: `runMigrations(db)` 创建所有表结构
- Consumes: 无

- [ ] **Step 1: 实现数据库连接管理**

创建 `src/main/db/connection.ts`:
```typescript
import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';

let db: Database.Database | null = null;

export function getDbPath(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'hi-story.db');
}

export function getDb(): Database.Database {
  if (db) return db;

  const dbPath = getDbPath();

  db = new Database(dbPath);

  // WAL 模式 — 支持并发读，写入性能更好
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
```

- [ ] **Step 2: 实现数据库迁移**

创建 `src/main/db/migrations.ts`:
```typescript
import Database from 'better-sqlite3';

const MIGRATIONS = [
  // 001: 核心表
  {
    version: 1,
    sql: `
      -- 小说项目
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type_tags TEXT NOT NULL DEFAULT '[]',  -- JSON array
        style TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- 大纲节点
      CREATE TABLE IF NOT EXISTS outline_nodes (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        parent_id TEXT,
        title TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (parent_id) REFERENCES outline_nodes(id) ON DELETE SET NULL
      );

      -- 角色
      CREATE TABLE IF NOT EXISTS characters (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        aliases TEXT NOT NULL DEFAULT '',
        appearance TEXT NOT NULL DEFAULT '',
        personality TEXT NOT NULL DEFAULT '',
        background TEXT NOT NULL DEFAULT '',
        arc TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      -- 世界观条目
      CREATE TABLE IF NOT EXISTS world_entries (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        parent_id TEXT,
        category TEXT NOT NULL CHECK(category IN ('place','faction','race','law','history','culture')),
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (parent_id) REFERENCES world_entries(id) ON DELETE SET NULL
      );

      -- 章节
      CREATE TABLE IF NOT EXISTS chapters (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '未命名章节',
        content TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','final')),
        word_count INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      -- 对话线程
      CREATE TABLE IF NOT EXISTS conversation_threads (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '新对话',
        category TEXT NOT NULL DEFAULT 'general' CHECK(category IN ('character','plot','world','general')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      -- 对话消息
      CREATE TABLE IF NOT EXISTS conversation_messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
        content TEXT NOT NULL DEFAULT '',
        provider_id TEXT,
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (thread_id) REFERENCES conversation_threads(id) ON DELETE CASCADE
      );

      -- 素材
      CREATE TABLE IF NOT EXISTS materials (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        source_layer TEXT NOT NULL CHECK(source_layer IN ('public_domain','history_military','myth_fantasy','dictionary','user')),
        title TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        url TEXT,
        tags TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
      );

      -- 通用关联表
      CREATE TABLE IF NOT EXISTS reference_links (
        id TEXT PRIMARY KEY,
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_rl_source ON reference_links(source_type, source_id);
      CREATE INDEX IF NOT EXISTS idx_rl_target ON reference_links(target_type, target_id);

      -- AI 配置
      CREATE TABLE IF NOT EXISTS ai_configs (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        api_key TEXT NOT NULL,
        model TEXT NOT NULL,
        base_url TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- 迁移版本表
      CREATE TABLE IF NOT EXISTS _migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
];

export function runMigrations(db: Database.Database): void {
  // 确保迁移表存在
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set(
    db.prepare('SELECT version FROM _migrations').all()
      .map((row: unknown) => (row as { version: number }).version)
  );

  for (const migration of MIGRATIONS) {
    if (!applied.has(migration.version)) {
      db.exec(migration.sql);
      db.prepare('INSERT INTO _migrations (version) VALUES (?)').run(migration.version);
      console.log(`Migration v${migration.version} applied.`);
    }
  }
}
```

- [ ] **Step 3: 在应用启动时初始化数据库**

修改 `src/main/index.ts`，在 `app.whenReady()` 回调中添加数据库初始化调用（插入到 `createWindow()` 之前）:

```typescript
import { getDb } from './db/connection';
import { runMigrations } from './db/migrations';

// In app.whenReady():
app.whenReady().then(() => {
  const db = getDb();
  runMigrations(db);
  createWindow();
});
```

- [ ] **Step 4: 编写数据库连接测试**

创建 `tests/unit/db/connection.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';

describe('Database Connection', () => {
  let db: Database.Database;
  const testDbPath = path.join(os.tmpdir(), 'hi-story-test.db');

  beforeAll(() => {
    db = new Database(testDbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  });

  afterAll(() => {
    db.close();
  });

  it('should enable WAL mode', () => {
    const result = db.pragma('journal_mode');
    expect(result[0].journal_mode).toBe('wal');
  });

  it('should enable foreign keys', () => {
    const result = db.pragma('foreign_keys');
    expect(result[0].foreign_keys).toBe(1);
  });

  it('should create tables from migrations', () => {
    // Run migrations inline for test
    db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type_tags TEXT NOT NULL DEFAULT '[]',
        style TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='projects'"
    ).all();
    expect(tables.length).toBe(1);
  });
});
```

Run: `npx vitest run tests/unit/db/connection.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/main/db/ src/main/index.ts tests/unit/db/
git commit -m "feat: add SQLite connection with WAL mode and migration system"
```

---

### Task 4: 项目 Repository 层

**Files:**
- Create: `src/main/db/repositories/project.repo.ts`

**Interfaces:**
- Produces: `ProjectRepo` 类，含 `create`, `findById`, `findAll`, `update`, `remove` 方法
- Produces: 每个方法返回 `IpcResult<T>`
- Consumes: `getDb()` from `../connection`

- [ ] **Step 1: 编写测试**

创建 `tests/unit/db/project.repo.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { ProjectRepo } from '../../../src/main/db/repositories/project.repo';

describe('ProjectRepo', () => {
  let db: Database.Database;
  let repo: ProjectRepo;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type_tags TEXT NOT NULL DEFAULT '[]',
        style TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    repo = new ProjectRepo(db);
  });

  afterEach(() => {
    db.close();
  });

  it('should create a project', () => {
    const result = repo.create({
      name: '测试小说',
      typeTags: ['仙侠'],
      style: '古风',
      summary: '一部测试小说',
    });

    if (!result.success || !result.data) {
      throw new Error('Expected success');
    }
    expect(result.data.name).toBe('测试小说');
    expect(result.data.typeTags).toEqual(['仙侠']);
    expect(result.data.id).toBeTruthy();
  });

  it('should find a project by id', () => {
    const created = repo.create({ name: '测试小说' });
    if (!created.success || !created.data) throw new Error('Expected success');

    const found = repo.findById(created.data.id);
    if (!found.success || !found.data) throw new Error('Expected success');
    expect(found.data.name).toBe('测试小说');
  });

  it('should return error for non-existent project', () => {
    const result = repo.findById('non-existent-id');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Project not found');
  });

  it('should find all projects ordered by updated_at desc', () => {
    repo.create({ name: '项目A' });
    repo.create({ name: '项目B' });

    const result = repo.findAll();
    if (!result.success || !result.data) throw new Error('Expected success');
    expect(result.data.total).toBe(2);
    expect(result.data.items[0].name).toBe('项目B'); // 最新的在前
  });

  it('should update a project', () => {
    const created = repo.create({ name: '旧名称' });
    if (!created.success || !created.data) throw new Error('Expected success');

    const updated = repo.update({
      id: created.data.id,
      name: '新名称',
      typeTags: ['武侠'],
    });
    if (!updated.success || !updated.data) throw new Error('Expected success');
    expect(updated.data.name).toBe('新名称');
    expect(updated.data.typeTags).toEqual(['武侠']);
  });

  it('should delete a project', () => {
    const created = repo.create({ name: '待删除' });
    if (!created.success || !created.data) throw new Error('Expected success');

    const removed = repo.remove(created.data.id);
    expect(removed.success).toBe(true);

    const found = repo.findById(created.data.id);
    expect(found.success).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
npx vitest run tests/unit/db/project.repo.test.ts
```
Expected: FAIL — ProjectRepo not found.

- [ ] **Step 3: 实现 ProjectRepo**

创建 `src/main/db/repositories/project.repo.ts`:
```typescript
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { Project, CreateProjectInput, UpdateProjectInput, PaginatedResult, IpcResult } from '../../../renderer/types';

export class ProjectRepo {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  create(input: CreateProjectInput): IpcResult<Project> {
    const now = new Date().toISOString();
    const id = uuidv4();
    const tags = JSON.stringify(input.typeTags ?? []);
    const style = input.style ?? '';
    const summary = input.summary ?? '';

    const stmt = this.db.prepare(`
      INSERT INTO projects (id, name, type_tags, style, summary, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(id, input.name, tags, style, summary, now, now);

    return this.findById(id);
  }

  findById(id: string): IpcResult<Project> {
    const row = this.db.prepare(
      'SELECT * FROM projects WHERE id = ?'
    ).get(id) as Record<string, unknown> | undefined;

    if (!row) {
      return { success: false, error: 'Project not found' };
    }

    return { success: true, data: this.rowToProject(row) };
  }

  findAll(limit = 50, offset = 0): IpcResult<PaginatedResult<Project>> {
    const total = (this.db.prepare(
      'SELECT COUNT(*) as count FROM projects'
    ).get() as { count: number }).count;

    const rows = this.db.prepare(
      'SELECT * FROM projects ORDER BY updated_at DESC LIMIT ? OFFSET ?'
    ).all(limit, offset) as Record<string, unknown>[];

    return {
      success: true,
      data: {
        items: rows.map(r => this.rowToProject(r)),
        total,
      },
    };
  }

  update(input: UpdateProjectInput): IpcResult<Project> {
    const existing = this.findById(input.id);
    if (!existing.success || !existing.data) {
      return { success: false, error: 'Project not found' };
    }

    const project = existing.data;
    const now = new Date().toISOString();
    const name = input.name ?? project.name;
    const typeTags = input.typeTags !== undefined
      ? JSON.stringify(input.typeTags)
      : JSON.stringify(project.typeTags);
    const style = input.style ?? project.style;
    const summary = input.summary ?? project.summary;

    this.db.prepare(`
      UPDATE projects
      SET name = ?, type_tags = ?, style = ?, summary = ?, updated_at = ?
      WHERE id = ?
    `).run(name, typeTags, style, summary, now, input.id);

    return this.findById(input.id);
  }

  remove(id: string): IpcResult<void> {
    const existing = this.findById(id);
    if (!existing.success) {
      return { success: false, error: 'Project not found' };
    }

    this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    return { success: true };
  }

  private rowToProject(row: Record<string, unknown>): Project {
    return {
      id: row.id as string,
      name: row.name as string,
      typeTags: JSON.parse(row.type_tags as string) as string[],
      style: row.style as string,
      summary: row.summary as string,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
npx vitest run tests/unit/db/project.repo.test.ts
```
Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/db/repositories/ tests/unit/db/project.repo.test.ts
git commit -m "feat: implement ProjectRepo with CRUD operations"
```

---

### Task 5: IPC 通道注册

**Files:**
- Create: `src/main/ipc/project.ipc.ts`
- Create: `src/main/ipc/index.ts`
- Modify: `src/main/index.ts` — 注册 IPC handlers
- Modify: `src/renderer/types/index.ts` — 确保类型可被主进程引用

**Interfaces:**
- Produces: IPC handlers 注册到 Electron，渲染进程可通过 `window.electronAPI.invoke('db:project:create', ...)` 调用
- Consumes: `ProjectRepo` from Task 4, `getDb()` from Task 3

- [ ] **Step 1: 实现项目 IPC handlers**

创建 `src/main/ipc/project.ipc.ts`:
```typescript
import { ipcMain } from 'electron';
import { getDb } from '../db/connection';
import { ProjectRepo } from '../db/repositories/project.repo';
import type { CreateProjectInput, UpdateProjectInput, IpcResult, Project, PaginatedResult } from '../../renderer/types';

function getRepo(): ProjectRepo {
  return new ProjectRepo(getDb());
}

export function registerProjectIpc(): void {
  ipcMain.handle('db:project:create', (_event, input: CreateProjectInput): IpcResult<Project> => {
    try {
      return getRepo().create(input);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('db:project:findAll', (_event, limit?: number, offset?: number): IpcResult<PaginatedResult<Project>> => {
    try {
      return getRepo().findAll(limit, offset);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('db:project:findById', (_event, id: string): IpcResult<Project> => {
    try {
      return getRepo().findById(id);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('db:project:update', (_event, input: UpdateProjectInput): IpcResult<Project> => {
    try {
      return getRepo().update(input);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('db:project:remove', (_event, id: string): IpcResult<void> => {
    try {
      return getRepo().remove(id);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });
}
```

- [ ] **Step 2: 实现 IPC 注册中心**

创建 `src/main/ipc/index.ts`:
```typescript
import { registerProjectIpc } from './project.ipc';

export function registerAllIpc(): void {
  registerProjectIpc();
}
```

- [ ] **Step 3: 在主进程入口注册 IPC**

修改 `src/main/index.ts`，在 `app.whenReady()` 中添加 IPC 注册:

```typescript
import { registerAllIpc } from './ipc';

app.whenReady().then(() => {
  const db = getDb();
  runMigrations(db);
  registerAllIpc();
  createWindow();
});
```

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc/ src/main/index.ts
git commit -m "feat: register project CRUD IPC handlers"
```

---

### Task 6: React 三栏布局与导航组件

**Files:**
- Create: `src/renderer/components/Layout.tsx`
- Create: `src/renderer/components/Sidebar.tsx`
- Create: `src/renderer/components/ProjectList.tsx`
- Create: `src/renderer/components/MainArea.tsx`
- Create: `src/renderer/components/ContextPanel.tsx`
- Create: `src/renderer/components/CreateProjectDialog.tsx`
- Create: `src/renderer/hooks/useProject.ts`
- Modify: `src/renderer/App.tsx`

**Interfaces:**
- Produces: 三栏布局渲染在屏幕上
- Consumes: ElectronAPI 类型（通过 declare global）

- [ ] **Step 1: 声明 ElectronAPI 全局类型**

创建 `src/renderer/types/electron.d.ts`:
```typescript
import type { ElectronAPI } from '../../preload';

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
```

- [ ] **Step 2: 实现 Layout 组件**

创建 `src/renderer/components/Layout.tsx`:
```typescript
import React from 'react';

interface LayoutProps {
  sidebar: React.ReactNode;
  main: React.ReactNode;
  contextPanel?: React.ReactNode;
  showContextPanel?: boolean;
}

const Layout: React.FC<LayoutProps> = ({ sidebar, main, contextPanel, showContextPanel = true }) => {
  return (
    <div className="h-full flex bg-gray-900 text-gray-100">
      {/* 左侧导航栏 */}
      <aside className="w-[280px] flex-shrink-0 border-r border-gray-700 bg-sidebar">
        {sidebar}
      </aside>

      {/* 中间主区域 */}
      <main className="flex-1 min-w-0">
        {main}
      </main>

      {/* 右侧上下文面板 */}
      {showContextPanel && contextPanel && (
        <aside className="w-[320px] flex-shrink-0 border-l border-gray-700 bg-sidebar">
          {contextPanel}
        </aside>
      )}
    </div>
  );
};

export default Layout;
```

- [ ] **Step 3: 实现 Sidebar 组件**

创建 `src/renderer/components/Sidebar.tsx`:
```typescript
import React from 'react';
import ProjectList from './ProjectList';
import type { Project } from '../types';

interface SidebarProps {
  projects: Project[];
  activeProjectId: string | null;
  onSelectProject: (id: string) => void;
  onCreateProject: () => void;
  onDeleteProject: (id: string) => void;
  loading: boolean;
}

const Sidebar: React.FC<SidebarProps> = ({
  projects,
  activeProjectId,
  onSelectProject,
  onCreateProject,
  onDeleteProject,
  loading,
}) => {
  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
        <h1 className="text-lg font-bold text-accent">hi story</h1>
        <button
          onClick={onCreateProject}
          className="w-7 h-7 rounded hover:bg-sidebar-hover flex items-center justify-center text-gray-400 hover:text-white transition-colors"
          title="新建小说"
        >
          +
        </button>
      </div>

      {/* Project List */}
      <div className="flex-1 overflow-y-auto">
        <ProjectList
          projects={projects}
          activeProjectId={activeProjectId}
          onSelect={onSelectProject}
          onDelete={onDeleteProject}
          loading={loading}
        />
      </div>
    </div>
  );
};

export default Sidebar;
```

- [ ] **Step 4: 实现 ProjectList 组件**

创建 `src/renderer/components/ProjectList.tsx`:
```typescript
import React, { useState } from 'react';
import type { Project } from '../types';

interface ProjectListProps {
  projects: Project[];
  activeProjectId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  loading: boolean;
}

const ProjectList: React.FC<ProjectListProps> = ({
  projects,
  activeProjectId,
  onSelect,
  onDelete,
  loading,
}) => {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="px-4 py-8 text-center text-gray-500 text-sm">
        加载中...
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-gray-500 text-sm">
        还没有小说项目
        <br />
        点击 + 创建第一个
      </div>
    );
  }

  return (
    <ul className="py-1">
      {projects.map((project) => (
        <li key={project.id}>
          <div
            className={`
              group flex items-center px-4 py-2.5 cursor-pointer text-sm
              ${project.id === activeProjectId
                ? 'bg-sidebar-active border-l-2 border-accent text-white'
                : 'border-l-2 border-transparent hover:bg-sidebar-hover text-gray-300'
              }
            `}
            onClick={() => onSelect(project.id)}
          >
            <span className="mr-2 text-base">📖</span>
            <span className="flex-1 truncate">{project.name}</span>

            {/* Delete button — appear on hover */}
            {confirmDeleteId === project.id ? (
              <div className="flex items-center gap-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(project.id);
                    setConfirmDeleteId(null);
                  }}
                  className="text-red-400 hover:text-red-300 text-xs px-1"
                >
                  确认
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmDeleteId(null);
                  }}
                  className="text-gray-400 hover:text-gray-300 text-xs px-1"
                >
                  取消
                </button>
              </div>
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmDeleteId(project.id);
                }}
                className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 transition-all text-sm"
                title="删除项目"
              >
                🗑
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
};

export default ProjectList;
```

- [ ] **Step 5: 实现占位组件**

创建 `src/renderer/components/MainArea.tsx`:
```typescript
import React from 'react';
import type { Project } from '../types';

interface MainAreaProps {
  activeProject: Project | null;
}

const MainArea: React.FC<MainAreaProps> = ({ activeProject }) => {
  if (!activeProject) {
    return (
      <div className="h-full flex items-center justify-center text-gray-600">
        <div className="text-center">
          <p className="text-4xl mb-4">📝</p>
          <p className="text-lg">选择一本小说开始创作</p>
          <p className="text-sm mt-2 text-gray-700">或点击 + 创建新项目</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col items-center justify-center text-gray-400">
      <p className="text-2xl mb-2">📖 {activeProject.name}</p>
      <p className="text-sm text-gray-600">编辑器将在后续版本中上线</p>
    </div>
  );
};

export default MainArea;
```

创建 `src/renderer/components/ContextPanel.tsx`:
```typescript
import React from 'react';
import type { Project } from '../types';

interface ContextPanelProps {
  activeProject: Project | null;
}

const ContextPanel: React.FC<ContextPanelProps> = ({ activeProject }) => {
  if (!activeProject) {
    return (
      <div className="h-full flex items-center justify-center text-gray-600 text-sm">
        <p>选择一个项目查看上下文</p>
      </div>
    );
  }

  return (
    <div className="h-full p-4 overflow-y-auto">
      <h3 className="text-sm font-semibold text-gray-300 mb-3 uppercase tracking-wide">
        项目信息
      </h3>

      <dl className="space-y-3 text-sm">
        <div>
          <dt className="text-gray-500">书名</dt>
          <dd className="text-gray-200">{activeProject.name}</dd>
        </div>
        {activeProject.typeTags.length > 0 && (
          <div>
            <dt className="text-gray-500">类型</dt>
            <dd className="flex flex-wrap gap-1 mt-0.5">
              {activeProject.typeTags.map((tag) => (
                <span
                  key={tag}
                  className="px-1.5 py-0.5 rounded text-xs bg-gray-700 text-gray-300"
                >
                  {tag}
                </span>
              ))}
            </dd>
          </div>
        )}
        {activeProject.style && (
          <div>
            <dt className="text-gray-500">风格</dt>
            <dd className="text-gray-200">{activeProject.style}</dd>
          </div>
        )}
        {activeProject.summary && (
          <div>
            <dt className="text-gray-500">简介</dt>
            <dd className="text-gray-200 text-xs leading-relaxed mt-0.5">
              {activeProject.summary}
            </dd>
          </div>
        )}
        <div>
          <dt className="text-gray-500">创建时间</dt>
          <dd className="text-gray-400 text-xs">
            {new Date(activeProject.createdAt).toLocaleDateString('zh-CN')}
          </dd>
        </div>
      </dl>
    </div>
  );
};

export default ContextPanel;
```

- [ ] **Step 6: 实现 CreateProjectDialog 组件**

创建 `src/renderer/components/CreateProjectDialog.tsx`:
```typescript
import React, { useState } from 'react';
import type { CreateProjectInput } from '../types';

interface CreateProjectDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (input: CreateProjectInput) => void;
  creating: boolean;
}

const TYPE_TAG_OPTIONS = [
  '仙侠', '武侠', '玄幻', '奇幻', '科幻',
  '历史', '宫斗', '言情', '悬疑', '恐怖',
  '都市', '军事', '游戏', '轻小说', '其他',
];

const CreateProjectDialog: React.FC<CreateProjectDialogProps> = ({
  open,
  onClose,
  onCreate,
  creating,
}) => {
  const [name, setName] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [style, setStyle] = useState('');
  const [summary, setSummary] = useState('');

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onCreate({
      name: name.trim(),
      typeTags: selectedTags,
      style,
      summary,
    });
  };

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-800 rounded-lg shadow-2xl w-[480px] max-h-[90vh] overflow-y-auto border border-gray-700">
        <div className="px-6 py-4 border-b border-gray-700 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">创建新小说</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* 书名 */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">
              书名 <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="给你的故事起个名字..."
              className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-white text-sm
                         focus:outline-none focus:border-accent placeholder-gray-600"
              autoFocus
            />
          </div>

          {/* 类型标签 */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">类型标签</label>
            <div className="flex flex-wrap gap-1.5">
              {TYPE_TAG_OPTIONS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  className={`
                    px-2 py-1 rounded text-xs transition-colors
                    ${selectedTags.includes(tag)
                      ? 'bg-accent text-white'
                      : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                    }
                  `}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>

          {/* 风格 */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">风格</label>
            <input
              type="text"
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              placeholder="如：古风、轻松、沉重..."
              className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-white text-sm
                         focus:outline-none focus:border-accent placeholder-gray-600"
            />
          </div>

          {/* 简介 */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">简介</label>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="简单介绍一下你想写的故事..."
              rows={3}
              className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-white text-sm
                         focus:outline-none focus:border-accent placeholder-gray-600 resize-none"
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!name.trim() || creating}
              className="px-6 py-2 text-sm bg-accent text-white rounded hover:bg-purple-600
                         disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {creating ? '创建中...' : '创建'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateProjectDialog;
```

- [ ] **Step 7: 实现 useProject hook**

创建 `src/renderer/hooks/useProject.ts`:
```typescript
import { useState, useEffect, useCallback } from 'react';
import type { Project, CreateProjectInput, UpdateProjectInput } from '../types';

interface UseProjectReturn {
  projects: Project[];
  activeProject: Project | null;
  loading: boolean;
  creating: boolean;
  setActiveProjectId: (id: string | null) => void;
  createProject: (input: CreateProjectInput) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  refreshProjects: () => Promise<void>;
}

export function useProject(): UseProjectReturn {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const refreshProjects = useCallback(async () => {
    setLoading(true);
    try {
      const result = await window.electronAPI.invoke('db:project:findAll', 50, 0) as any;
      if (result.success && result.data) {
        setProjects(result.data.items);
      }
    } catch (err) {
      console.error('Failed to load projects:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshProjects();
  }, [refreshProjects]);

  // When activeProjectId changes, load full project data
  useEffect(() => {
    if (!activeProjectId) {
      setActiveProject(null);
      return;
    }
    // Find in local list first, then fetch if needed
    const found = projects.find((p) => p.id === activeProjectId);
    if (found) {
      setActiveProject(found);
    } else {
      window.electronAPI.invoke('db:project:findById', activeProjectId)
        .then((result: any) => {
          if (result.success && result.data) {
            setActiveProject(result.data);
          }
        });
    }
  }, [activeProjectId, projects]);

  const createProject = useCallback(async (input: CreateProjectInput) => {
    setCreating(true);
    try {
      const result = await window.electronAPI.invoke('db:project:create', input) as any;
      if (result.success && result.data) {
        await refreshProjects();
        setActiveProjectId(result.data.id);
      } else {
        console.error('Failed to create project:', result.error);
      }
    } finally {
      setCreating(false);
    }
  }, [refreshProjects]);

  const deleteProject = useCallback(async (id: string) => {
    try {
      await window.electronAPI.invoke('db:project:remove', id);
      if (activeProjectId === id) {
        setActiveProjectId(null);
      }
      await refreshProjects();
    } catch (err) {
      console.error('Failed to delete project:', err);
    }
  }, [activeProjectId, refreshProjects]);

  return {
    projects,
    activeProject,
    loading,
    creating,
    setActiveProjectId,
    createProject,
    deleteProject,
    refreshProjects,
  };
}
```

- [ ] **Step 8: 整合 App 组件**

修改 `src/renderer/App.tsx`:
```typescript
import React, { useState } from 'react';
import Layout from './components/Layout';
import Sidebar from './components/Sidebar';
import MainArea from './components/MainArea';
import ContextPanel from './components/ContextPanel';
import CreateProjectDialog from './components/CreateProjectDialog';
import { useProject } from './hooks/useProject';
import type { CreateProjectInput } from './types';

const App: React.FC = () => {
  const {
    projects,
    activeProject,
    loading,
    creating,
    setActiveProjectId,
    createProject,
    deleteProject,
  } = useProject();

  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const handleCreateProject = async (input: CreateProjectInput) => {
    await createProject(input);
    setShowCreateDialog(false);
  };

  return (
    <>
      <Layout
        sidebar={
          <Sidebar
            projects={projects}
            activeProjectId={activeProject?.id ?? null}
            onSelectProject={setActiveProjectId}
            onCreateProject={() => setShowCreateDialog(true)}
            onDeleteProject={deleteProject}
            loading={loading}
          />
        }
        main={<MainArea activeProject={activeProject} />}
        contextPanel={<ContextPanel activeProject={activeProject} />}
      />

      <CreateProjectDialog
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        onCreate={handleCreateProject}
        creating={creating}
      />
    </>
  );
};

export default App;
```

- [ ] **Step 9: 运行开发模式验证 UI**

```bash
npm run dev
```

Expected: Electron 窗口显示三栏布局。左侧项目列表（空状态），中间提示选择项目，右侧提示选择项目。点击 + 按钮弹出创建对话框，填写表单可创建项目。

- [ ] **Step 10: Commit**

```bash
git add src/renderer/
git commit -m "feat: implement three-column layout, project list, and create project dialog"
```

---

### Task 7: 应用菜单与窗口管理

**Files:**
- Create: `src/main/menu.ts`
- Modify: `src/main/index.ts` — 注册菜单

**Interfaces:**
- Produces: 应用菜单栏（File、Edit、View、Help）
- Consumes: `app`, `BrowserWindow` from Electron

- [ ] **Step 1: 实现菜单模板**

创建 `src/main/menu.ts`:
```typescript
import { app, Menu, BrowserWindow, type MenuItemConstructorOptions } from 'electron';

export function createAppMenu(mainWindow: BrowserWindow): void {
  const isMac = process.platform === 'darwin';

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' as const },
        { type: 'separator' as const },
        { role: 'quit' as const },
      ],
    }] : []),
    {
      label: '文件',
      submenu: [
        {
          label: '新建小说',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            mainWindow.webContents.send('menu:create-project');
          },
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'forceReload', label: '强制重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '重置缩放' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于 hi story',
          click: () => {
            const { dialog } = require('electron');
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: '关于 hi story',
              message: 'hi story v0.1.0',
              detail: '小说写作辅助工具\n帮助你从构思到完稿的全流程创作助手。',
            });
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
```

- [ ] **Step 2: 在主进程中启用菜单**

修改 `src/main/index.ts`，在 `createWindow` 之后调用 `createAppMenu`:

```typescript
import { createAppMenu } from './menu';

// In app.whenReady():
app.whenReady().then(() => {
  const db = getDb();
  runMigrations(db);
  registerAllIpc();
  createWindow();
  createAppMenu(mainWindow!);
});
```

- [ ] **Step 3: 在渲染进程响应菜单事件**

修改 `src/renderer/App.tsx`，添加菜单事件监听:

```typescript
import { useEffect } from 'react';

// Inside App component, add:
useEffect(() => {
  const handleMenuCreate = () => {
    setShowCreateDialog(true);
  };

  window.electronAPI.on('menu:create-project', handleMenuCreate);
  return () => {
    window.electronAPI.removeListener('menu:create-project', handleMenuCreate);
  };
}, []);
```

- [ ] **Step 4: Commit**

```bash
git add src/main/menu.ts src/main/index.ts src/renderer/App.tsx
git commit -m "feat: add application menu with File/Edit/View/Help"
```

---

### Task 8: Electron Builder 打包配置与最终集成测试

**Files:**
- Create: `electron-builder.yml`
- Create: `tests/e2e/project-crud.test.ts`

**Interfaces:**
- Produces: 可打包为 Windows .exe 安装程序
- Consumes: 全部前置任务

- [ ] **Step 1: 配置 electron-builder**

创建 `electron-builder.yml`:
```yaml
appId: com.history.desktop
productName: hi story
directories:
  output: release
  buildResources: resources
files:
  - dist/**/*
  - package.json
win:
  target:
    - target: nsis
      arch: [x64]
  icon: resources/icon.png
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
  installerIcon: resources/icon.png
extraResources:
  - from: resources/
    to: resources/
    filter:
      - "*.db"
```

- [ ] **Step 2: 编写端到端测试**

创建 `tests/e2e/project-crud.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// E2E test for project CRUD via direct DB repo testing
// (Full Electron E2E with Spectron/Playwright requires additional setup
//  and is deferred to a later phase)
import Database from 'better-sqlite3';
import { ProjectRepo } from '../../src/main/db/repositories/project.repo';
import { runMigrations } from '../../src/main/db/migrations';

describe('Project CRUD E2E', () => {
  let db: Database.Database;
  let repo: ProjectRepo;

  beforeAll(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db); // Create all tables
    repo = new ProjectRepo(db);
  });

  afterAll(() => {
    db.close();
  });

  it('should create, read, update, and delete a project', () => {
    // Create
    const createResult = repo.create({
      name: '苍云传',
      typeTags: ['仙侠', '武侠'],
      style: '古风',
      summary: '少年背负古剑，踏上寻找真相的旅途。',
    });
    expect(createResult.success).toBe(true);
    const projectId = createResult.data!.id;

    // Read
    const readResult = repo.findById(projectId);
    expect(readResult.success).toBe(true);
    expect(readResult.data!.name).toBe('苍云传');

    // Update
    const updateResult = repo.update({
      id: projectId,
      name: '苍云传·修订版',
    });
    expect(updateResult.success).toBe(true);
    expect(updateResult.data!.name).toBe('苍云传·修订版');

    // Delete
    const deleteResult = repo.remove(projectId);
    expect(deleteResult.success).toBe(true);

    // Verify deleted
    const notFound = repo.findById(projectId);
    expect(notFound.success).toBe(false);
  });

  it('should list projects sorted by updated_at desc', () => {
    repo.create({ name: '最早' });
    repo.create({ name: '最新' });

    const result = repo.findAll();
    expect(result.success).toBe(true);
    expect(result.data!.total).toBeGreaterThanOrEqual(2);
    expect(result.data!.items[0].name).toBe('最新');
  });
});
```

Run: `npx vitest run tests/e2e/project-crud.test.ts`

- [ ] **Step 3: 运行全部测试**

```bash
npx vitest run
```

Expected: All tests PASS.

- [ ] **Step 4: 验证生产构建**

```bash
npm run build
```

Expected: `dist/main/` 和 `dist/renderer/` 目录生成成功，无编译错误。

- [ ] **Step 5: Commit**

```bash
git add electron-builder.yml tests/e2e/
git commit -m "feat: add electron-builder config and E2E project CRUD tests"
```

---

## Phase 1 完成检查清单

- [ ] `npm run dev` 启动 Electron 窗口
- [ ] 三栏布局正常渲染（侧栏 280px / 主区自适应 / 右侧 320px）
- [ ] 创建小说项目（填写书名、选标签、写简介）→ 出现在左侧列表
- [ ] 点击项目 → 高亮选中 → 右侧面板显示项目信息
- [ ] 删除项目 → 确认后消失
- [ ] 菜单栏「文件→新建小说」（Ctrl+N）可触发创建对话框
- [ ] `npm test` 全部通过
- [ ] `npm run build` 构建成功
- [ ] 数据持久化：关闭重开后项目仍在

---

## Phase 2-5 预览（详细任务在对应阶段展开）

### Phase 2: 写作模块与 AI 对话引擎
- Task 9: TipTap 富文本编辑器集成
- Task 10: 章节 CRUD + 写作状态管理
- Task 11: AI Provider 抽象层（Claude/GPT SDK 适配）
- Task 12: AI 对话 UI + 流式响应 + 对话持久化
- Task 13: 上下文自动构建器
- Task 14: Prompt 模板系统

### Phase 3: 角色、大纲、世界观模块
- Task 15: 大纲树形编辑器（拖拽排序）
- Task 16: 角色卡片编辑器
- Task 17: 世界观条目编辑器（层级管理）
- Task 18: 关联关系管理（ReferenceLink UI）
- Task 19: 角色关系图可视化（力导向图）
- Task 20: AI Prompt 角色模板（角色设计师/世界观规划师）

### Phase 4: 文学数据库
- Task 21: 公版文本数据采集脚本
- Task 22: 历史军事数据采集脚本
- Task 23: 神话志怪数据采集脚本
- Task 24: 词典/修辞数据采集脚本
- Task 25: 数据清洗/分段/FTS5 索引构建
- Task 26: 数据库打包与首次安装流程
- Task 27: 用户导入层（链接抓取 + 手动素材）

### Phase 5: 灵感搜索与集成
- Task 28: 跨层并发搜索引擎
- Task 29: 灵感面板 UI
- Task 30: AI 语义精排集成
- Task 31: 关联操作（复制引用/添加素材/发送对话）
- Task 32: 整体联调与性能优化

---

## 变更记录

| 日期 | 变更 |
|------|------|
| 2026-06-19 | v1.0 初稿，Phase 1 详细计划完成 |
