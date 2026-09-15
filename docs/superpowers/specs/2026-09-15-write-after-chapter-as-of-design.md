# 写章「末章之后」as-of 正式语义（#146 设计修订，2026-09-15）

> **效力：** 本文是对叙事时间接入合同的**薄修订**，只解决「新章尚无 chapter id 时，写章必须用真 `taskType:'write'`，不得再挂 `chat`」。
> **前置：** 叙事时间接入（选项 B）与 fail-closed 已在 master；AI 对话清理（PR #4）正交，**不**绑在同一功能 PR。
> **本轮不做：** #147、P2 总清单、先建空章再写、渲染端自选任意 `TimeMode`、改审稿/对话映射。
> **修订史：** 第二轮（同日）——纠正债务逾期与恒等式范围、末章锚点校验、歧义字段拒绝。

---

## 0. 一句话

写「下一新章」时，IPC 必须声明 `taskType: 'write'` + `placement: 'after_chapter'` + 合法 `anchorChapterId`；Main 校验锚点为**库内当前活跃末章**后，按「锚点 *之后* 的虚拟新章」做 `before_target` 折叠；对外 `mode` 体现写章/`before_target`；**不得**返回 `through_target`、挂 `chat`，或忽略互相矛盾的入参。

---

## 1. 问题

`AIWritePanel.loadNarrativeAsOfForWrite` 当前在「新章无 id」时走：

- `taskType: 'chat'`
- `targetChapterId: 末章 id`
- 因而 `resolveTimeMode` → `through_target(末章)`

问题：

1. 任务类型是假的（写章挂 chat）；
2. 返回 `mode` 是 `through_target`，日志/验收无法区分写章与对话；
3. 无章节时退回 `planning`，语义不干净；
4. 即便折叠「包含范围」近似，**债务逾期派生也不等价**（见 §2）。

---

## 2. 恒等式与债务例外

设活跃章序中末章为 \(L\)，虚拟新章 \(N\) 的故事位置严格在 \(L\) 之后。

### 2.1 包含范围（成立）

对**基础折叠**（哪些转换/投影进入截面）有：

\[
\texttt{before\_target}(N)\text{ 的包含范围} \equiv \texttt{through\_target}(L)
\]

即：事实、事件、钩子、知识，以及债务的**基础折叠包含集**与旧 `chat+through_target(L)` 等价。  
**禁止**用 `write + before_target(L)`：那会裁掉 \(L\) 自身转换。

### 2.2 逾期派生（不要求与旧方案等价）

`deriveDebtOverdue` 用**目标位置**判断逾期：期限章 \(D\) 在 target **严格之前**则逾期。

- 旧方案 `through_target(L)`：target=\(L\)。若 `dueChapterId=L`，则 \(D\) 不在 \(L\) 之前 → **仍未逾期**。
- 正确写下一章 `before_target(N)`：target=\(N\)（在 \(L\) 之后）。若 `dueChapterId=L`，则 \(D\) 在 \(N\) 之前 → **应为逾期**。

因此验收**不得**要求 debts 状态与旧 chat 方案完全集合等价；逾期按虚拟下一章位置计算，**允许与旧方案不同**（且应以新语义为准）。

### 2.3 实现含义

不得整条管道只用 `through_target(L)` 冒充（否则逾期会错）。应构造故事位置 \(> L\) 的虚拟目标（或等价手段），以 `before_target` 跑完整折叠 + `deriveDebtOverdue`。

---

## 3. IPC / 入参合同

扩展 `LoadNarrativeAsOfInput`（名称可微调，语义固定）：

| 字段 | 写「已有目标章」 | 写「末章之后新章」 | 无任何章 |
|---|---|---|---|
| `taskType` | `'write'` | `'write'` | `'write'` |
| `placement` | 省略或 `'at_chapter'` | **`'after_chapter'`** | 省略 |
| `targetChapterId` | 目标章 id | **禁止传入**（见 §4.2） | 禁止 / null |
| `anchorChapterId` | 不用 | **必填，且必须是库内活跃末章** | null |
| `hasActiveChapter` | **由 Main 推导**，渲染端勿传；若传则必须与推导一致，否则拒绝 | 同左 | 同左 |

渲染端写章路径：

- 有活跃章列表 → 只传 `taskType:'write'`, `placement:'after_chapter'`, `anchorChapterId = 当前列表末章 id`（不传 `targetChapterId` / 不传或勿依赖自填的 `hasActiveChapter`）；
- 无章 → `taskType:'write'`，无 placement/anchor（见 §5.2）。

**删除**写章路径上的 `taskType:'chat'` 与 `taskType:'planning'` 临时分支。

---

## 4. Main 校验（fail-closed）

### 4.1 `after_chapter` 锚点

当 `taskType==='write' && placement==='after_chapter'`：

1. `anchorChapterId` 必填；
2. 锚点必须属于 `projectId`；
3. 锚点必须**未软删**（活跃章）；
4. **锚点必须等于该项目当前活跃章序的末章**（按库内 `sort_order` 等既有活跃序规则取「最后一章」）。渲染端列表可能过期；若期间已新增章节，旧锚点 → **`success:false`**，提示用户重试（重新拉章列表后再写）；
5. 任一失败 → IPC `success:false`，写章面板**继续阻断生成**。

### 4.2 歧义字段：拒绝，不忽略

`placement==='after_chapter'` 时：

- 若同时传入非空 `targetChapterId` → **直接拒绝**（不得忽略后继续）；
- `hasActiveChapter`：**由 Main 根据锚点存在且活跃推导为 true**；若请求体显式传入且与推导结果矛盾 → **拒绝**；推荐渲染端不再传该字段。
- `requestedMode: 'through_target'`（或其它非 write 允许模式）→ **拒绝**。

其它非法组合（均失败）：

- `write` + `after_chapter` + 锚点跨项目 / 已删 / 缺失 / **非当前末章**；
- `chat` / `review` / `planning` 带 `placement:'after_chapter'`。

---

## 5. 折叠与返回 mode

### 5.1 有锚点（`after_chapter`）

- 以虚拟新章位置 \(N\)（严格在锚点末章 \(L\) 之后）跑 **`before_target`** 全管道（含 `deriveDebtOverdue`）。
- **对外** `ctx.mode` / IPC `data.mode` 固定为 `before_target`；可选回传 `placement` / `anchorChapterId`。  
  **不得**返回 `through_target`。
- `textBlock` 标明写章 / before_target / after_chapter 锚点，避免「chat 截面」措辞。

### 5.2 无章节

- `taskType: 'write'`，无 placement/anchor；
- **不**改走 `planning`；
- 返回 `mode: 'before_target'`，运行时事实/钩子/债务/知识均为空；非 as-of 通道不变；
- as-of 失败仍 fail-closed。

### 5.3 已有目标章重写（非本修订重点）

继续 `write` + `before_target(targetChapterId)`，与现 Spec 一致。

---

## 6. 验收

| # | 断言 |
|---|---|
| A1 | 写章「下一新章」IPC 的 `taskType` 恒为 `'write'`，不再出现 `'chat'`。 |
| A2 | `after_chapter` + 合法末章锚点：事实、事件、钩子、知识及**债务基础折叠包含范围**与旧 `chat+through_target(末章)` 等价；**逾期派生按虚拟下一章计算，允许（且应以）与旧方案不同**（例：`due=末章` 在新语义下应为 overdue）。 |
| A3 | 返回 `mode` 为 `before_target`，不是 `through_target`。 |
| A4 | 锚点跨项目 / 已删 / 缺失 / **不是库内当前活跃末章** → `success:false`；写章阻断。 |
| A5 | `after_chapter` 同时带 `targetChapterId`，或 `hasActiveChapter` 与 Main 推导矛盾 → `success:false`。 |
| A6 | 项目无章节：零运行时 as-of；不伪装 `planning`。 |
| A7 | as-of 加载失败：写章 fail-closed。 |

**明确不测：** textBlock 与旧 chat 逐字相同；debts **状态**与旧 chat 完全一致；`mode === 'through_target'`。

---

## 7. 实现边界

- 改：`LoadNarrativeAsOfInput`、loader/context、虚拟目标位置、`AIWritePanel.loadNarrativeAsOfForWrite`、单测（含逾期差异用例 + 非末章锚点拒绝）。
- 可改：`textBlock` 标签；IPC 回传 `placement`/`anchorChapterId`。
- 不改：对话/审稿映射；#147；P2 清单；对话清理 PR。

---

## 8. 分支纪律（实施时再定）

设计修订阶段不强制新 worktree。真实施 #146 时从当时最新合适 tip 新开短分支；**不要**塞进对话清理 PR。

---

## 9. 审查对齐

- 方案 B 字段 + 返回写章/`before_target` mode。
- 债务：包含范围等价，逾期按虚拟下一章（可异于旧 chat）。
- 锚点必须是库内当前活跃末章。
- 歧义字段拒绝；`hasActiveChapter` 由 Main 推导。
- #147 / P2 清单：本轮暂停。
