# P0 终审补录（2026-09-14）

> **范围：** `81856da..6ff75e1`（Provider / Planning / Preview / Obsidian 分隔 + 两处收口修复）  
> **性质：** 合入前收口核对。三片未做当时的隔离 fresh review；本文件按片补规格符合性与代码质量结论，并记录已接受偏差。  
> **合入：** 已快进到 `feature/skill-engine`（含 Important 收口 `9e8728b` / `6ff75e1` 与文档 `8a622f5`）。合入当时未 push；现已与 `origin/feature/skill-engine` 对齐。

## 总评

规格符合、质量可合入。无 Critical。无仍挡合入的 Important。

合入后在 `D:\ccx` 的 `feature/skill-engine`（`6ff75e1`）重跑最终门：全量 412/412、`build:main` 通过、`npx vite build` 通过、三条 rg 无匹配、写作 UI 12/12、Obsidian 导入 UI 119/119、决策账本 UI 16/16。

先前验证报告的 Important 已在代码中收口：

| 原问题 | 处理 |
|---|---|
| 迟到 `saved` 回执回退 committed | `9e8728b`：两条 `saved` 均查 `isPlanningWriteCurrent` |
| `onPlanningCommitStarted` 可选 | `6ff75e1`：改为必填，调用处去掉 `?.`，UI 测试补 noop |
| `dangerouslySetInnerHTML` 注释绊 rg | Preview 注释改为「零 innerHTML」，源码无该标识 |

## 按片

### Provider（`87f8040`）

- **规格：** 删除 `aiService.configure`；`chat` / `chatStream` 收当次 `ProviderConfig` 快照；`chatStream` 同步外壳；`projectId` 必填。主进程 `ChatOptions.model` 保留。未调 `invalidateCache`。
- **质量：** Approved。已知 Minor（不挡）：审稿/润色/素材各有一份精简 `PROVIDERS` 未抽共享；`AIChatPanel` 新增配置不持久化 `baseUrl`（既有 bug）；`PlanningWorkspace.loadFirstAiConfig` 仍用 `providerId` 当 `name`（现 `name===id` 不炸）。

### Planning（`eb835ab` + `9e8728b` + `6ff75e1`）

- **规格：** loader 失败不清 committed；普通保存用 save 返回值 `onPlanningCommitted`；epoch 在 IPC 前 reserve；导入 commit 前必填回调 reserve；`saved` 还须 token current。
- **质量：** Approved。
- **已接受偏差：** 无 `planningLoadError` state（计划 Step 7 的 JSX 从不读取；失败语义由不清快照 + `console.error` 承担）。
- **不挡合入的 Minor：** token 回归仍在 helper，没有组件级受控 Promise 锁；导入 UI 直接挂面板时 `onPlanningCommitStarted` 是 noop，没有「reserve 发生在 commit IPC 之前」的断言。

### Preview（`db755a2`）

- **规格：** 去掉 `dangerouslySetInnerHTML`；按 `<p>` 切成文本节点；抽不出段进 `<pre>`；保存仍是 HTML 原文。未改审稿/润色/写章 prompt。
- **质量：** Approved。

### Obsidian 分隔（`719a8b4`）

- **规格：** 与 P0 同分支合入（产品已拍板选 A）。布局 65/35 不持久化；扫描中/失败不挂空分隔条；P0 reserve 叠在重构后的 `commit` 上。
- **质量：** Approved。拖动几何无 E2E，靠手测。

## 遗留待办（不挡合入、不开 P1）

1. 策划加载失败没有用户可见横幅（可复用 `obsidianError` 同类提示，另立跟进）。
2. 组件级 token 竞态回归；导入 UI 断言 reserve-before-commit。
3. Task 1 已记 Minor：`baseUrl` 不持久化、Provider 预设未抽共享、`providerId` 当 `name`。
4. 外部供应商烟测需单独授权。

## 流程说明

未补 Task 2/3 迟到 implementer report（补妆无助于恢复片间隔离）。本文件代替整分支一次终审的按片结论。
