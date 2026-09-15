# 叙事时间「时间快照」失败阻断 —— 手测报告（2026-09-15）

> **定位：执行报告（已完成）。** 对应指南 `docs/guides/2026-09-14-narrative-time-failclosed-guide.md`。
> 本轮在真实 App 中完成叙事时间模型的 fail-closed 三条行为验证，**三条全部通过，达到预期**。

## 完成内容

- 在真实 App 里跑完「时间快照加载失败」三条 fail-closed 手测，三条全部通过：
  1. **写章**：as-of 加载失败 → 停 + 报错「叙事时间截面加载失败，已停止生成」，预览框空。✅
  2. **审稿**：as-of 加载失败 → 报错「…加载失败，请重试…」，审稿不跑、按钮恢复。✅
  3. **对话**：as-of 加载失败 → 对话能发、不报错，但 AI 失忆（说不出哨兵事实）。✅（哨兵对照验证）
- 经复审发现并修复原「对话失忆」判据无效的问题，升级为「哨兵事实对照法」并补做验证。
- 还原全部测试临时状态：删除哨兵事实、删除 mock、重新编译 main。

## 修改文件

- `docs/guides/2026-09-14-narrative-time-failclosed-guide.md` — 第 3 步升级为「哨兵事实对照法」；执行回执最终定为「三条全部通过」，含复测注意事项（旧 dist 缺 handler、须重启 app、对话历史污染）。
- `docs/reports/2026-09-15-narrative-time-failclosed-manual-test.md` — 本报告（由 `2026-09-14` 版本重命名而来）。
- `src/main/ipc/narrative-time.ipc.ts` — mock 行已移除（当前源码为干净态，无失败注入）。
- `dist/main/main/ipc/narrative-time.ipc.js` — 经 `tsc -p tsconfig.main.json` 重新编译，`模拟失败` 0 匹配。
- 真实 DB（`hi-story.db`）— 测试哨兵事实已删除，`story_facts` 归 0；备份留存 `hi-story.db.bak-2026-09-15-manual-test`。

## 遇到问题

- **「对话失忆」判据无效（复审发现，本轮核心）**：测试项目事实库为空，AI 无论成败都看不到任何 story_facts，导致「失忆」与「正常」数据层面无法区分。修复：插入哨兵事实，把判断从「AI 是否提到剧情」的模糊输出变成「AI 能否答出哨兵词」的二元判据。
- **对话历史污染**：AI 对话历史跨章节共享且当前不可删除，A 段答过的「玄霜铁令」留在历史里，B 段被模型照抄，第一次 B 段「说出」作废。修复：换用历史里不存在的新哨兵词「赤阳火种」，B 段最终答出编造的「檀木匣子」而非「赤阳火种」，失忆实锤。
- **未重启 app 导致 mock 不生效**：编译 dist 只改磁盘文件，运行中的 Electron 进程内存里仍是旧代码。修复：确认完全退出 app 后重新启动。
- **旧 `dist/main` 缺叙事时间 IPC handler，第一轮手测误判「通过」**：渲染端 catch 吞掉 invoke 异常，显示同名「加载失败」，并非 mock 生效。修复：重新编译 main 后复测。
- **环境坑（阻塞启动）**：D 盘根目录被混入独立 Node 24（`D:\node.exe`、`D:\npm` 等），PATH 以 `D:\` 开头导致 `npm`/`node` 解析错乱，`npm run dev` 报「Unable to find Electron app at D:\rebuild」。绕过：不跑 `npm run dev`，直接 `.\node_modules\.bin\electron.cmd .` 启动。

## 下一步建议

- 任务 #144 已收口。继续按既定顺序推进：
  - #145 renderer 全量类型检查门槛 — **已完成**（`tsconfig.renderer.json` + `typecheck:renderer`，合入前见分支 `codex/renderer-typecheck`）。
  - 下一步：AI 对话隔离与清理（新建/切换/删除会话；是否按章隔离需设计拍板）。
  - #146 新章无 ID 的 before_target 正式语义（替换 `AIWritePanel.loadNarrativeAsOfForWrite` 的临时 chat 等价）。
  - #147 其余 P2 技术债（先拆清单，只处理数据安全/上下文正确性/后续开发阻断项）。
- 顺带发现的产品体验问题（非本轮范围，建议另立项）：AI 对话历史跨章节共享且当前**不可删除**，用户换章节后旧对话仍堆积、无法清空。这对「对话按章隔离」或「误答纠正」都构成困扰。
- 长期：清理 D 盘根目录混入的 Node 安装，或把正确的 Node 目录排到 PATH 前面。
