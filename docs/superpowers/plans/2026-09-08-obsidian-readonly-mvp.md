# Obsidian 单向读取 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为每个小说项目配置 Obsidian 目录，安全只读地浏览 Markdown，并将有界摘录接入 AI 上下文。

**Architecture:** SQLite 只保存目录路径；Electron 主进程负责目录选择、扫描和 YAML 解析；React 通过带项目代次的独立加载器消费扫描结果。Obsidian 数据不参与核心项目加载事务，也没有任何写文件 IPC。

**Tech Stack:** Electron、React、TypeScript、SQLite、Node.js `fs/promises`、`js-yaml`、Vitest。

## Global Constraints

- 只做 Obsidian → hi-story 单向读取，禁止自动回写 Obsidian。
- 保留现有人物、世界观、大纲模块及数据库表。
- 未配置、路径缺失或文件损坏不得影响原有项目功能。
- 不实现文件监听、双向同步或旧数据迁移。

---

### Task 1: 项目路径持久化

**Files:** `src/main/db/migrations.ts`、`src/main/db/repositories/project.repo.ts`、`src/renderer/types/index.ts`、`tests/unit/db/project.repo.test.ts`

**Interfaces:** `Project.obsidianPath: string`；`UpdateProjectInput.obsidianPath?: string`。

- [ ] 先写路径创建、读取和更新测试并确认失败。
- [ ] 增加 v16 迁移与仓储字段映射，使空路径保持向后兼容。
- [ ] 运行仓储测试确认通过。

### Task 2: 只读 Markdown 扫描器与 IPC

**Files:** `src/main/obsidian/markdown-vault.ts`、`src/main/ipc/obsidian.ipc.ts`、`src/main/ipc/index.ts`、`src/renderer/types/index.ts`、`tests/unit/obsidian/markdown-vault.test.ts`

**Interfaces:** `scanObsidianVault(path): Promise<ObsidianScanResult>`；IPC `obsidian:chooseDirectory`、`obsidian:scan(projectId)`。

- [ ] 先写正常读取、frontmatter、文件名回退、缺失路径、过滤和损坏隔离测试并确认失败。
- [ ] 用 UTF-8 读取 `.md`，用 `js-yaml` 解析 frontmatter，逐文件捕获错误。
- [ ] 注册只读扫描和系统目录选择 IPC；不存在路径返回状态而非抛错。
- [ ] 运行扫描器测试确认通过。

### Task 3: 项目隔离与 AI 预算

**Files:** `src/renderer/services/obsidian-loader.ts`、`src/main/ai/context-builder.ts`、`tests/unit/obsidian/obsidian-loader.test.ts`、`tests/unit/obsidian/context.test.ts`

**Interfaces:** `createObsidianLoader(...)`；`ContextBuilder.getObsidianContext(documents)`；`ContextSources.obsidianDocuments`。

- [ ] 先写 A 晚于 B、旧请求失败和上下文 token 上限测试并确认失败。
- [ ] 实现项目 ID + 请求代次守卫，旧回执不触发状态或错误回调。
- [ ] 构建带来源和优先级说明的有限 Obsidian 上下文块。
- [ ] 运行相关测试确认通过。

### Task 4: 配置与只读浏览

**Files:** `src/renderer/components/ObsidianPanel.tsx`、`src/renderer/components/Sidebar.tsx`、`src/renderer/hooks/useProject.ts`、`src/renderer/App.tsx`、`src/renderer/components/AIWritePanel.tsx`、`src/renderer/components/AIReviewPanel.tsx`

**Interfaces:** 项目设置可选择、保存、清除目录；面板按人物/世界观/长期大纲浏览；聊天、写章、审稿接收相同的有限上下文字符串。

- [ ] 接入项目更新方法和独立扫描状态，不让扫描失败进入核心项目加载失败路径。
- [ ] 增加带“来自 Obsidian / 只读”标识的配置与浏览面板。
- [ ] 将统一上下文块接入聊天、写章和审稿，不替换旧 SQLite 上下文。
- [ ] 用前端构建验证接口与组件集成。

### Task 5: 模板、说明与验收

**Files:** `docs/obsidian.md`、`resources/obsidian-templates/*.md`、`electron-builder.yml`、`AGENTS.md`、`docs/tool-builder/state.md`

**Interfaces:** 中文目录规范与三类可复制模板，安装包携带模板。

- [ ] 写清数据归属、目录、frontmatter、错误行为和只读限制。
- [ ] 增加人物、世界观、长期大纲模板并纳入打包资源。
- [ ] 跑完整测试、`npm run build`、`git diff --check`。
- [ ] 提交实现，不推送。
