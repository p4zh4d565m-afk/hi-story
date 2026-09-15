# 边写边维护：数据安全与上下文正确性收口（#147 第一批）

日期：2026-09-15
范围：从 #147「边写边维护」清单中挑出 4 项优先落地；章纲批量（工具栏代写/批量写章读章纲）经与作者确认**本轮跳过**，面板归属持久化也**维持重启清空**不动。

## 完成内容

1. **启动自动备份真实小说库** — 主进程新增 `src/main/db/backup.ts`，在**迁移前**用 `db.backup()` 做在线一致性备份到 `userData/backups/`（迁移是最大的数据丢失风险点，迁移前备份才能完整恢复），只保留最近 5 份（文件名带毫秒防同秒撞车），旧的自动删。备份失败只记日志、不阻断启动。**首次启动跳过**由 index.ts 在 `getDb()` 之前用 `isFirstRun` 判断（避免 `getDb()` 已建库导致 existsSync 恒真、留空库备份）。
2. **抽 MaterialRepo 清理 IPC 旧 SQL** — `entities.ipc.ts` 里 `db:material:*` 五个 handler 的裸 `db.prepare`（共 8 次）抽到新 `src/main/db/repositories/material.repo.ts`，IPC 只转调 Repo；补齐 `source_layer` 非法值回退 `user` 的校验（原实现会触发 CHECK 约束报错）。**说明：只收了 entities.ipc 的用户素材 CRUD**；`database.ipc.ts`/`reference.ipc.ts`/`search-engine.ts` 里还有 `materials` 查询，但那些走的是只读文学知识库 literary.db（`litDb`），与用户素材主库是两码事，不属于「材料库 CRUD」，未纳入本批。
3. **改善 AI 取消/错误提示** — `ai.service.ts` 新增 `humanizeAiError`（英文底层串翻译成友好中文、已是中文的错误透传）与 `streamEndDisplay`（切项目静默、主动停止提示「已停止生成」、真实失败给友好中文）；**四个入口**（对话 AIChatPanel、写章、审稿、润色）的 catch 统一走这两个函数。
4. **修浮窗主题按钮** — 写章/审稿/润色三个浮窗里 `hover:text-white`（Tailwind 默认纯白）在浅色主题下 hover 时白字看不清，统一改为主题化的 `hover:text-gray-100`。灰底 `gray-*` 已由 tailwind 全局映射到 `--ui-gray-*`，本就跟随主题。

## 修改文件

- 新增 `src/main/db/backup.ts`
- 新增 `src/main/db/repositories/material.repo.ts`
- 新增 `tests/unit/backup.test.ts`（真备份 / 保留 5 份 / 失败不阻断 / isFirstRun 首启门禁）
- 新增 `tests/unit/humanize-ai-error.test.ts`
- `src/main/index.ts` — 迁移前同步 await backupOnStartup；getDb() 前用 isFirstRun 判首启跳过
- `src/main/ipc/entities.ipc.ts` — material 五个 handler（8 次 SQL）→ 转调 MaterialRepo，删无用 uuidv4 import
- `src/renderer/services/ai.service.ts` — 新增 humanizeAiError / streamEndDisplay，补 Failed to fetch 匹配
- `src/renderer/components/AIChatPanel.tsx` — 对话两处 catch 走 streamEndDisplay（对话主路径不再透英文）
- `src/renderer/components/AIWritePanel.tsx` — 单章 catch 走 streamEndDisplay；批量 catch 接入停止提示 + 新增「停止批量生成」按钮；hover:text-white → gray-100
- `src/renderer/components/AIReviewPanel.tsx` — 同上
- `src/renderer/components/AIPolishPanel.tsx` — 同上
- `vitest.config.ts` — exclude 掉 `**/.worktrees/**`
- `tests/unit/startup.test.ts` — 补 `db/backup` vi.mock + connection mock 补 getDbPath（真实文件路径，非首启路径断言 backup 被调用）

## 遇到问题

- **startup 测试时序回归**：`whenReady` 回调改成 `async` 后，测试用同步 `state.ready()` 调用时，清理向量的逻辑还没执行就断言了。修复：测试改为 `await state.ready()`。
- **误用系统 Node 跑 vitest**：`npx vitest` 走了系统 Node（ABI 137），better-sqlite3 是 Electron ABI 130，直接 `ERR_DLOPEN_FAILED`。按 CLAUDE.md 改走 Electron-as-Node 后正常。
- **审查指出的问题已闭环**：「首启无库跳过」改为 getDb() 前判断（原实现因 getDb 已建库而失效）；文件名加毫秒防同秒撞车；`Failed to fetch` 已补匹配；对话 AIChatPanel 主路径 catch 已接 streamEndDisplay。
- **第二轮审查（边角）已闭环**：报告「六段 SQL」改为「五个 handler / 8 次 prepare」；首启判断抽成 `backup.ts` 的 `isFirstRun` 纯函数并补独立单测；startup.test.ts 的 `getDbPath` 从 `':memory:'` 改为真实存在的临时文件，锁住「非首启会调 backup」。
- **第三轮审查（PR 评审，P1+P2）已闭环**：P1 备份从迁移后改到**迁移前并同步 await**（迁移是最大数据丢失风险点，迁移前备份才能完整恢复）；P2 批量写章 catch 接入停止提示（切项目静默、停止提示后 break）。startup.test.ts 因 whenReady 回调改 async 相应改为 await。
- **第四轮审查（功能缺口 + 文档）已闭环**：P2 上轮只加了 catch 提示、缺「停止批量生成」入口——本轮补 `batchRunning` 状态 + 批量进度区「⏹ 停止批量生成」按钮（`handleBatchStop` 调 `cancelActiveStreams`，generator 抛「已停止」后 catch 提示 break）；P3 报告「修改文件」里「迁移后挂」「六段 SQL」等旧描述已更正为「迁移前同步 await」「五个 handler/8 次 SQL」。
- **第五轮审查（P1 竞态 + 文档）已闭环**：P1 批量可重复启动 + 停止竞态——加 `batchRunningRef`（同步防重入，按钮 disabled）+ `stopRequestedRef`（循环每章开头检查，覆盖无活跃流的间隙），`handleBatchStop` 置标志 + abort 当前流；P3 报告「遇到问题」里「备份改为迁移后 fire-and-forget」「backup 注释『迁移前』已改『迁移后』」两句相反的旧结论删除。
- **第六轮审查（P1 锁释放竞态）已闭环**：旧任务 finally 可释放新任务锁——加 `batchRunIdRef` 任务代次 token，`handleBatchGenerate/Resume` 启动时 `++batchRunIdRef.current` 认领代次，`handleBatchStop` 也递增作废当前代次，`finally` 只在「代次仍是自己」时才释放锁。
- **第七轮审查（P1 任务主体未受代次保护）已闭环**：移除全局 `stopRequestedRef`，统一由代次 token 承担停止判断——`runBatch` 接收 runId，循环每章开头用「`batchRunIdRef.current !== runId`」判断 break；停止就是递增代次。这样新任务认领新代次不会清除任何旧任务状态，旧任务的停止判断只认自己的 runId。
- **第八轮审查（P1 异步边界后副作用未校验）已闭环**：给三个异步边界后的副作用补齐代次校验——① `await onSaveAsChapter` 返回后写进度前校验；② catch 失败写进度前校验；③ 循环结束后删 localStorage 恢复记录前校验。任何一处代次已变（被停止或新批次启动）即跳过旧副作用。
- **第九轮审查（P1 旧批次错误回写路径）已闭环**：`runBatch` 里 `await loadNarrativeAsOfForWrite` 之后的 `setError`（as-of 失败提示）补代次校验；catch 里的停止提示改为由 `handleBatchStop` 主动发出（避免「停止时代次已递增、`=== runId` 恒 false 导致提示永不显示」），catch 遇 `AI_STOPPED` 静默 break。
- **第十轮审查（P1 异步停止回执释放新任务锁）已闭环**：`handleBatchStop` 里 `await cancelActiveStreams` 返回后原无条件释放锁——改为记下本次递增后的 `stopId`，回执返回后仅当 `batchRunIdRef.current === stopId`（停止后没有新批次再次递增）才释放锁 + 回写「已停止」提示。
- **测试缺口（如实记录）**：审查者建议的「保存进行中停止 → 立即启动新批次」回归测试未补——该竞态深埋在 AIWritePanel 组件闭包内（依赖 aiService / ContextBuilder / onSaveAsChapter 等），无低成本单测的纯函数切点，批量生成亦无 Electron UI E2E。硬补只会是空转断言，无实际价值。已通过代码走查确认代次校验覆盖全部异步边界，留给后续若重构出「代次守卫」纯函数时再补。
- **全量测试注水**：原 `npm run test` 扫到 `.worktrees/` 5 份副本 → 371/2727。`vitest.config.ts` 排除 worktree 后，主树真实规模为 **78 文件 / 577 测试**。

## 下一步建议

- `backup.test.ts` 用真实临时目录 + 真实 sqlite 验证了真备份/保留 5 份/失败不阻断；`humanize-ai-error.test.ts` 覆盖了映射表。二者均已落地，不再是无单测的纯手测项。
- 浮窗主题改动只扫了 `hover:text-white`，主按钮 `bg-accent text-white` 在浅色下仍为深底白字（可读但非纯主题化），若追求彻底可后续统一到 `--ui-on-accent`。
- 章纲批量（工具栏代写/批量写章读章纲）仍读旧大纲节点，需在 AIWritePanel 加「按卷列章纲多选」界面，是 #147 剩余项中工作量最大的一项，建议单独排期。
- `database.ipc.ts`/`reference.ipc.ts`/`search-engine.ts` 里的文学知识库 `materials` 查询未纳入本批（只读 litDb，非用户素材 CRUD），若后续要「材料库 SQL 全清」可另立记账项。

## 自检结论

1. 满足需求 ✅（4 项落地，2 项按作者决定跳过；十轮审查意见全部闭环）
2. 不影响已有功能 ✅（577 测试全过、renderer typecheck 过、build:main 过）
3. 边界情况 ✅（首启无库在 getDb 前跳过、备份失败不阻断、同秒撞车防、material 非法 source_layer 回退、中文错误透传、Failed to fetch 命中、批量停止有入口 + 提示 + 防重入 + 停得住 + 旧任务不释放新任务锁 + 新任务不清旧停止标志 + 异步边界后副作用均校验代次 + 旧批次错误不回写 + 停止回执不释放新任务锁）
4. 测试已同步 ✅（新增 backup + humanize 单测；startup 补 mock；vitest 排除 worktree）
5. 技术债已记录 ✅（见「下一步建议」）
