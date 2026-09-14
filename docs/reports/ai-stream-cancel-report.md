# AI 流真实取消（Spec 一期）— 实现报告

> 日期：2026-09-12
>
> 提交：`f0780ba`（分支 `feature/skill-engine`）
>
> 对应 Spec：`docs/superpowers/specs/2026-09-10-chapter-run-review-ledger-design.md` 一期（已批准设计）
>
> 范围：只做一期「AI 流真实取消」，**未碰**二期（审稿版本账本 / 迁移 v21）与三期（写章运行记录 / 迁移 v22）。
>
> 本文档原放工作区；整分支合入稳定后的卫生阶段已归档至 `docs/reports/`。

---

## 一、完成内容

按 Spec 一期，把「用户点停止后后台仍继续生成、迟到结果还可能写进界面」这个真实风险修掉。改动分四层，外加一个在测试中暴露的真实 bug：

### 1. Provider 层 —— 贯穿 AbortSignal

- `src/main/ai/provider.ts`：`ChatOptions` 新增 `signal?: AbortSignal`，并导出错误码常量 `AI_STREAM_CANCELLED`。
- Claude（`claude.ts`）：`client.messages.stream(body, { signal })` 传入取消信号；`signal` 触发时主动 `stream.abort()`，让流走 error 分支，归一为「已停止生成」，不再显示成普通网络失败。
- OpenAI 兼容（`generic-openai.ts`）：把「用户取消 signal」与「内部 2 分钟超时 abort」**合并**——任一方 abort 都取消，互不吞掉。取消归一为 `AI_STREAM_CANCELLED`，超时仍是「请求超时（2分钟）」。

### 2. 主进程 —— 流注册表

- 新建 `src/main/ai/stream-registry.ts`：进程内 `Map<streamId, { controller, senderId, projectId, runId?, terminal }>`。
- `cancel(id, projectId)`：**先标 terminal 再 abort**，且必须同时匹配 `streamId` 与 `projectId`，关掉 abort 与迟到回调之间的竞态窗口。
- `abortAllForSender(senderId)`：窗口销毁时中止该窗口全部流。

### 3. 主进程 IPC —— `ai.ipc.ts`

- `ai:chatStream` 新增入参 `projectId`，登记到流注册表；每个 Token / complete / error 回调前都查 `terminal` 与 `sender.isDestroyed()`，terminal 或窗口已毁则丢弃。
- 新增 `ai:cancelStream`：`{ streamId, projectId }`，确认 terminal 后 abort。
- `sender.once('destroyed')` 挂销毁钩子，窗口关闭即中止该窗口所有流。

### 4. 渲染端 —— `ai.service.ts` 映射与拒收

- `chatStream` 新增第三参 `projectId`，登记 `streamId → { projectId, ignored, cancelled, wake }` 映射。
- `cancelActiveStreams(projectId)`：精确取消该项目下所有活跃流，并**唤醒对应 generator 抛「已停止，不会保存」**（关键：主进程取消后不再发事件，不主动唤醒的话 for-await 会永远挂住）。
- `ignoreProjectStreams(projectId)`：只作废不 abort（切项目不误杀后台，符合 Spec「切项目不自动取消旧流」）。

### 5. 四面板接取消

- `AIWritePanel`：停止按钮从「只改本地 state」改为真正 `cancelActiveStreams`；单章与批量两条流都带 `projectId`；停止态静默（不报「AI 写作失败」）。
- `AIChatPanel`：两处流带 `projectId`；发送按钮在流式时变成「⏹ 停止」。
- `AIReviewPanel` / `AIPolishPanel`：流带 `projectId`，停止态静默。
- `App.tsx`：切项目时对旧项目调 `ignoreProjectStreams`（用 prev ref 记住上一个 projectId，作废的是旧项目而非新项目）。

### 6. 顺带修复的真实 bug

原 `ai.service.chatStream` 的 `while (!finished)` 循环里，当 `complete` 与最后一个 token 在**同一事件循环 tick** 到达时，generator 从 `await` 醒来看到 `finished=true` 直接跳出，**未消费 pendingTokens 就结束了**，导致正文末尾丢失。改为「先 drain pendingTokens、再判 finished」，用 `continue` 把积攒的 token 优先消费掉。

---

## 二、修改文件

**生产代码（主进程）**
- `src/main/ai/provider.ts`（`ChatOptions.signal` + `AI_STREAM_CANCELLED`）
- `src/main/ai/providers/claude.ts`（signal 传给 SDK + `stream.abort()`）
- `src/main/ai/providers/generic-openai.ts`（合并用户 signal 与超时 abort）
- `src/main/ai/stream-registry.ts`（**新增**，流注册表）
- `src/main/ipc/ai.ipc.ts`（chatStream 登记 + cancelStream + 窗口销毁钩子）

**生产代码（渲染端）**
- `src/renderer/services/ai.service.ts`（映射与拒收 + 修复丢 token bug）
- `src/renderer/App.tsx`（切项目作废旧项目流）
- `src/renderer/components/AIWritePanel.tsx`（停止真实取消 + 批量流 projectId）
- `src/renderer/components/AIChatPanel.tsx`（停止按钮 + 流 projectId）
- `src/renderer/components/AIReviewPanel.tsx`（流 projectId + 停止静默）
- `src/renderer/components/AIPolishPanel.tsx`（流 projectId + 停止静默）

**测试**
- `tests/unit/stream-registry.test.ts`（**新增**，5 项：cancel 匹配 / 不存在 / 重复取消 / markTerminal / abortAllForSender 不误伤）
- `tests/unit/ai-stream-cancel.test.ts`（**新增**，4 项：正常流式 / 切项目拒收 / 取消抛「已停止」/ 不同项目互不干扰）

**文档**
- `docs/superpowers/specs/2026-09-10-chapter-run-review-ledger-design.md`（状态改「已批准设计」）
- `AGENTS.md`（新增「AI 流真实取消（一期）」条目）

---

## 三、遇到问题

### 1. 真实 bug：complete 与最后 token 同 tick 到达丢正文

原 generator 的 `while (!finished)` 逻辑，在 `complete` 紧跟着最后一个 `onToken` 到达时，会先看到 `finished=true` 跳出循环，把还在 `pendingTokens` 队列里的最后一段 token 丢掉。这是**测试抓出来的真问题**，不是测试自身问题——真实 SSE 场景里 `onComplete` 紧跟在最后一个 `onToken` 之后完全可能发生。修复：改为 `while (true)` + 「先 drain、再判 finished」。

### 2. 主进程取消后 generator 会永远挂住

取消后主进程 terminal 门禁会把后续所有事件都丢弃，渲染端 `for await` 就再也等不到任何事件，永远不结束。这是 Spec 里没显式写、实现时才暴露的坑。解法：`cancelActiveStreams` 里主动 `wake()` 唤醒对应 generator，让它立即抛「已停止」。

### 3. 测试 mock 三处缺陷（均为测试自身问题，非生产 bug）

- `window.electronAPI.on` 的 mock 每个 channel 只存一个监听器，两条流互相覆盖 → 改成数组存多监听器。
- async generator 是惰性的，`cancelActiveStreams` 前必须先用 `next()` / `collect` 启动，否则映射里还没登记。
- 单例 `aiService` 的 apiKey 为空导致 `chatStream` 直接抛「请先添加 AI 配置」→ beforeEach 里 `configure` 补上测试 key。

### 4. 切项目作废的语义陷阱

写章面板初版 effect 写成「`projectId` 变化时 `ignoreProjectStreams(projectId)`」，但此时拿到的是**新** projectId，作废的是还没流的新项目，旧项目流漏了。改为用 `prevProjectIdRef` 记录上一个 projectId，作废的是旧项目。App 层用了同样写法。

---

## 四、下一步建议

1. **先用真书写几天，验证一期取消体验。** 重点看两件事：点停止后是否真的停了（不再烧额度）、切项目后旧项目流是否不再往新项目面板吐字。这是 Spec 一期验收标准的两个核心。

2. **二期（审稿版本账本，迁移 v21）可单独立项。** 这是 Spec 的产品核心：`chapters.content_generation` + `chapter_reviews` + `chapter_revision_proposals` 三张表 + 审稿 prompt 三态改造。注意它有一个必须先定的产品规则——`normalizeChapterText` 纯文本判据（去标签合并空白后比较），否则「绑定精确正文世代」会被 TipTap 的等价 HTML 重序列化噪声吃掉。

3. **真实供应商烟测未做。** 单测和 UI 回归用的都是 mock 与 fixture，没有真正连 Claude / OpenAI 点停止验证。若要做，需要一次真实 API Key 的烟测，且如实标注「未验证」，不能拿 mock 冒充。

4. **已知残留（首版，已被第二人复核部分消化）：** 审稿/润色面板当时没有独立「停止」按钮。审稿主路径其实是 `aiService.chat()`，复核补丁已改为 `chatStream` 并在关面板时取消。

---

## 五、第二人复核与补丁（2026-09-12）

对照 Spec v0.3 与当时代码。**结论：底座能停，但不能按一期验收宣称切项目与迟到结果已经封死。** 本段之后的代码改动已合入工作区（未另开提交号，与首版同一功能分支继续改）。

### 复核时发现、报告未写的问题

1. **`ignoreProjectStreams` 不结束 `for await`。** 只丢后续 token，等到主进程 complete 还会 `yield` 作废前攒下的正文。写章面板没有项目守卫，会把旧草稿打进新项目。对话虽有 `projectIdRef` 挡 UI，但 persist 吃 generator yield，旧会话可能落一条截断 assistant。
2. **`cancel()` 不删注册表。** terminal 后门禁挡住 complete/error，`finish()` 走不到，点停止就在 Map 里留一行。
3. **审稿主路径不是流。** 正式审稿走 `chat()`，切项目/关面板停不了那次 HTTP。报告写「缺停止按钮」低估了缺口。
4. 次要：`cancelActiveStreams` 按项目杀光所有流；写章停止不等主进程回执；每个 `chatStream` 叠一个 `destroyed` 监听；`projectId` 可空；写作 UI 回归没覆盖停止。

### 本轮已改

| 项 | 改法 |
| --- | --- |
| ignore 结束循环 | `ignoreProjectStreams` 里 `wake()`；generator 抛 `AI_IGNORED_MESSAGE`；禁止 complete 后再 yield |
| 注册表泄漏 | `cancel` 在 abort 后 `delete`；ipc complete/error/catch 无论是否 terminal 都 `finish()` |
| 审稿可取消 | `handleReview` 改为 `chatStream`；关审稿/润色面板调用 `cancelActiveStreams` |
| 写章不串项目 | yield 核对 `projectIdRef`；切项目清空本面板草稿；停止 `await cancelActiveStreams` |
| 其它 | 缺 `projectId` 拒绝建流；窗口 `destroyed` 每 sender 只挂一次；Claude 取消错误统一 `AI_STREAM_CANCELLED` |

单测：`stream-registry` 6 项、`ai-stream-cancel` 5 项（含「ignore 不等 complete」）。跑这两份文件已通过。

### 刻意保留

- 切项目 **仍不 abort** 主进程（Spec 原意）。渲染端放弃接收后，旧对话可能只有用户消息、没有完整 assistant，避免截断冒充成功。
- `cancelActiveStreams(projectId)` 仍是按项目取消，不是按 `streamId`。

### 下一步（不要和二期捆在一起）

1. **先用真书写几天**，看停止是否还烧额度、切项目旧字是否还进新面板。真实供应商烟测仍未做。
2. 若误伤明显：把取消改成按 `streamId`（写章停止不要杀掉对话抽取）。
3. 写作 UI 回归补「停止按钮调用 cancel IPC」。
4. **二期**才是审稿版本账本（v21 + `normalizeChapterText` + prompt 三态）。不要在一期取消上继续堆。

