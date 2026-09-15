# 五项联合验收报告（成功链路）

> 日期：2026-09-15  
> 稳定提交：`08c6765`（`origin/master`）  
> 定位：**成功链路验收**。`docs/reports/2026-09-15-narrative-time-failclosed-manual-test.md` 只证明 as-of **失败时阻断**，**不能**替代本报告的写章/审稿/对话/导入成功路径。  
> 数据边界：全部在隔离库 `%TEMP%\hi-story-writing-admission\user-data\hi-story.db` 完成。未写入生活库 `C:\Users\Ariel\AppData\Roaming\hi-story\hi-story.db`。隔离库由生活库副本升到迁移 **v22**。  
> AI：日常配置解密后使用 **DeepSeek / `deepseek-chat`**（本文不记录 API Key）。  
> 印记：写章「青梧驿站」；修订「修订印记：赤铜铃」；对话甲/乙/丙。

---

## 环境

| 项 | 值 |
|---|---|
| 日常目录 | `D:\ccx`，由 `f57221b` 快进到 `08c6765` |
| 生活库备份 | `C:\Users\Ariel\AppData\Roaming\hi-story\hi-story.db.bak-2026-09-15-writing-admission-2026-09-15-141237` |
| 隔离 userData | `%TEMP%\hi-story-writing-admission\user-data` |
| Obsidian 源 | `D:\obsidian\我的基础库\02 项目\我有一个妹妹`（只读复制） |
| Obsidian 副本 | `%TEMP%\hi-story-writing-admission\obsidian-copy` |
| 第一阶段 | Electron 隐藏窗加载真实 renderer + preload，走正式 IPC |
| 重启 | 结束第一进程后另启第二进程，只读隔离库核对 |

---

## 1. AI 写一章，保存、切章、重启后正文正确

**测试项目：** 「我有一个妹妹」`4cd81aeb-2ca3-42e4-a269-7a6fb86e26bc`

**操作：**
1. `db:narrative:buildAsOfContext`（`taskType: write`，`placement: after_chapter`，锚点为活跃末章）拿到非空 `textBlock`。
2. 真实 DeepSeek 生成约 400 字下一章，正文必须含「青梧驿站」。
3. `db:chapter:create` 保存为「联合验收-AI生成章」。
4. 切到另一章 `b3e7740f-8e0f-474f-8890-d0d611d1fc62`（标题「初见」），写入切章探针「【切章探针】联合验收切章标记」。
5. 立即回读新章，确认未被切章改写。
6. 结束进程后第二进程再读库。

**操作结果：** 通过。新章 id `b55b8069-d58d-4e3a-a356-37313c1b25ae`，CJK 约 **409** 字。生成正文含青梧驿站旧书店、牵妹妹摸猫等情节。切章后新章内容未变。

**数据库核对（重启后只读隔离库）：**

| 核对 | 结果 |
|---|---|
| 新章仍在 | 是，`title=联合验收-AI生成章`，`length(content)=596` |
| 含「青梧驿站」 | 是（`instr=300`） |
| 新章不含切章探针 | 是（`instr=0`） |
| 「初见」含切章探针 | 是 |
| 新章正文与第一阶段落库一致 | 是（重启校验与 `admission-state.json` 比对通过） |

**结论：通过。** 此项是成功生成并持久化，不是 fail-closed 阻断。

---

## 2. AI 审稿并应用一次修订，重启后修订正确

**测试项目：** 同上「我有一个妹妹」；对象即第 1 项新章 `b55b8069-…`。

**操作：**
1. 真实 DeepSeek 审稿，返回 JSON（4 条 warning：手的比喻绕、驿站首次出现突兀、鱼/蜗牛比喻重复、结尾点题直白）。
2. 按审稿意见修订全文，要求保留「青梧驿站」，文末写入「修订印记：赤铜铃」。
3. `db:chapter:update` 写回该章。
4. 进程重启后再读。

**操作结果：** 通过。修订后补了「窗外巷子尽头那家旧书店的招牌在风里晃」、改了「不，是我长大了，她的手才显得小」、删蜗牛句、结尾改为把猫递到她手边，并追加修订印记段。

**数据库核对（重启后）：**

| 核对 | 结果 |
|---|---|
| 仍含「青梧驿站」 | 是 |
| 含「修订印记：赤铜铃」 | 是（`instr=585`，靠近文末） |
| 正文等于第一阶段 `revisedContent` | 是 |
| 未把切章探针写进新章 | 是 |

**结论：通过。** 审稿+应用修订+重启后的成功写回。本轮 live 审稿未再调 `review` as-of（见复核 B 偏差）；fail-closed 手测不能代替本条。

---

## 3. 对话连续交流，删除一轮、撤销、清空后继续

**测试项目：** 「我有一个妹妹」`4cd81aeb-…`  
**会话：** 「联合验收对话」`762337e9-f5bf-48b9-955d-b7eb6aad0955`

**操作（均为正式 IPC）：**
1. `createThread` → 两轮 `appendMessage`（用户先落库再 `ai:chat` 再写助手）：印记甲、印记乙。模型均原样回到「对话印记甲 / 乙」。
2. `deleteTurn` 删第一轮（甲）。
3. `restoreBatch` 撤销，甲恢复。
4. `clearThread` 清空活跃消息。
5. 再发一轮「对话印记丙」，模型回复「对话印记丙」。
6. 进程重启后再读。

**操作结果：** 通过。

**数据库核对（重启后）：**

| 状态 | 结果 |
|---|---|
| 活跃消息 | 仅 2 条：user「…对话印记丙」+ assistant「对话印记丙」 |
| 软删消息 | 4 条（甲用户+甲助手、乙用户+乙助手），同一 `deletion_batch_id=15951383-490d-469e-9ee1-43ed12e88b35` |
| 活跃区不含甲/乙 | 是 |
| `deleted_at IS NULL` 过滤器 | 重启后 `find` 等价查询只见丙 |

**结论：通过。** 软删批次仍在库中，活跃历史只有清空后继续的一轮。

---

## 4. Obsidian 副本导入总纲 / 分卷纲 / 章纲 / 人物 / 世界观

**测试项目：** 新建「联合验收-Obsidian导入」`03d2187b-ffcd-4492-934d-4a2df8deeba6`（空策划，避免改测试书原策划）。  
**Obsidian：** 源目录副本，`obsidian_path` 指向副本。

**操作：**
1. `obsidian:preparePlanningImport` 扫描副本。
2. 勾选含总纲/分卷/章纲/人物/世界观槽位的候选；三层 `fill`。
3. `obsidian:commitPlanningImport`。
4. 再算源目录 37 个 `.md` 的 SHA-256，与导入前对照。
5. 重启后读导入项目策划 JSON 与人物/世界观表。

**预览：**

| 槽位 | 预览 |
|---|---|
| 总纲 | `我有一个妹妹_完整大纲`，premise 切片「未来 ABO 星际时代，」 |
| 分卷 | 3：`大纲_卷1/2/3` |
| 章纲 | 150 |
| 人物 | 12 |
| 世界观 | 5 |

**提交摘要：** `master/volumes/chapters = filled`；人物 created 12；世界观 created 5。

**数据库核对（重启后）：**

| 项 | 预览 | 落库 |
|---|---|---|
| 总纲 premise | 「未来 ABO 星际时代，」 | 「未来 ABO 星际时代，Beta 骗子米尘为治病和守护妹妹…」含预览切片 |
| 分卷数 / 题 | 3 | 3：卷 1 霍昭线 · 骗婚骗心；卷 2 祁景然线 · 蛇窝囚笼；卷 3 萧君耀线 · 身世修罗场 |
| 章纲 | 150 | 150；样例第 1–3 章「初见 / 调戏？ / 等价交换」volumeIndex=0 |
| 人物 12 | 陈城、贺景妤、贺莲、贺云意，贺霁言、霍昭、米尘、米粒、米向之、祁景然、席风、萧君耀、薛闻 | 同名 12 条 |
| 世界观 5 | 5 个候选 | 关键物品、疾病与药物、势力格局、主要场景、ABO规则（验收脚本对缺省分类写入 `place`） |
| 源目录 hash | 导入前 37 文件 | 导入后 37 文件，逐文件 SHA-256 **完全一致** |

**结论：通过。** 预览与落库数量/关键词一致；原 vault 未被写入。

---

## 5. 两位独立复核

均只读，未改代码，未打开生活库。#147 / 其余 P2 不作为阻塞。

### 复核人 A（代码 / SQLite / IPC / 叙事时间）

- 代理：[Reviewer A](4298fbee-8a7f-4394-9ab0-3a6cc75bda35)  
- **总评：有条件通过**  
- **Critical：无**  
- **稳定写作准入：是**

**Important（不阻断）：**
1. 材料库等既有 SQL 不在 `src/main/db/`（非本轮回归）。
2. `ai:cancelStream` 失败时无 `error` 字段，形态偏瘦。
3. `AIWritePanel` 注释仍写 through_target，实现已是 `write` + `after_chapter`。

**已核对成立：** 对话 `deleteTurn/clearThread/restoreBatch`、写章 `after_chapter` 末章校验与 fail-closed、章节/Obsidian/AI IPC 与 preload 匹配、v22 软删列同事务且登记失败回滚。

### 复核人 B（测试覆盖 / 真实写作路径）

- 代理：[Reviewer B](ec303709-4c04-4496-852e-eb63f09e7db2)  
- **总评：有条件通过**  
- **Critical：无**  
- **稳定写作准入：有条件是**（落库合同与面板 IPC 对齐）

**路径等价：**
- 写章 as-of → `db:chapter:create` 与 `AIWritePanel` 合同等价。
- 对话清理三件套即 `AIChatPanel` 所用 IPC。
- Obsidian `prepare/commit` 即导入面板写库通道。

**Important 偏差（不阻断，须记账）：**
1. Live 用 `ai:chat`，UI 主路径是 `ai:chatStream`（停止/取消本轮未用真实供应商再证）。
2. 审稿 live **未**调 `db:narrative:buildAsOfContext`；面板 fail-closed 靠代码+单测。
3. 「切章」证明两章库隔离，未走 WritingArea 防抖 flush（既有 `run-writing-workspace.cjs` 覆盖）。
4. 对话 live 未带 chat as-of（等于「无叙事注入」分支）。
5. 导入未走 `onPlanningCommitStarted` / 刷新门禁（独立导入 UI 回归覆盖）。

**定向单测：** 清理/v22/after_chapter/A7 相关工作区文件 **105/105** 通过（含 vitest 扫到的 worktree 副本共计 41 files / 457 passed）。

---

## 总表

| # | 项 | 测试项目 | 结果 |
|---|---|---|---|
| 1 | AI 写章 + 保存 + 切章 + 重启 | 我有一个妹妹 | 通过 |
| 2 | AI 审稿 + 应用修订 + 重启 | 我有一个妹妹（新章） | 通过 |
| 3 | 对话删 / 撤 / 清后继续 | 我有一个妹妹 | 通过 |
| 4 | Obsidian 副本导入 | 联合验收-Obsidian导入 | 通过 |
| 5 | 双人独立复核 | `08c6765` 只读 | 有条件通过，无 Critical，准入成立 |

**不能用 fail-closed 报告代替的原因：** 那份报告只证「as-of 失败则写章/审稿停、对话失忆」。本轮证的是 as-of **成功**后真实模型写出可重启正文、修订可写回、软删对话可继续、Obsidian 预览与 SQLite 一致。

已完成 ^-^
