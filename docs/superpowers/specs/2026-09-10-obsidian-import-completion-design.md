# Obsidian 导入闭环补齐 Spec

> 状态：第五轮复审后待实施
>
> 基线提交：`e9b3710`
>
> 本文档是本轮修订与验收的唯一依据。实施时不得只依据 `development-report.md`；报告必须如实区分“实现完成”“自动测试通过”和“真实烟测通过”。

## 一句话目标

补齐 Obsidian 单向导入策划闭环中仍存在的运行时输入校验、最终状态计算、名称冲突、重解析竞态、预览与真实 DOM 覆盖，使界面预判、主进程校验和数据库最终结果一致，并在刷新失败时保证不会重复写库。

## 当前已确认完成

以下能力已经存在，本轮不得回退：

1. Obsidian 目录只读扫描，不监听、不修改、不回写原文件。
2. 主进程按文件路径、当前 hash 和作者选择重新解析，不信任渲染端 drafts。
3. parser 产生的 `blocking` issue 已随 rebuilt selection 保留，并在事务前阻止 commit。
4. Guard 已使用不可回退的全局 epoch 隔离 A→B→A 的旧 reparse 回执。
5. 同一候选只接受最新 reparse，不同候选允许并发。
6. 锁定层替换或清空必须显式确认解锁。
7. 总纲、分卷纲、章纲的最终依赖关系由主进程再次校验。
8. 写库使用 SQLite 短事务；人物覆盖保留 `profileOutline`，世界观覆盖保留 `parentId`。
9. `operationId` 具备进程内并发幂等和短期结果复用。
10. 当前基线自动验证为 31 个测试文件、173 项测试通过，Obsidian UI 脚本 14/14 通过；这些数字不等于本 Spec 已完成。

## 当前未关闭问题及证据

### P0-1 最终卷列表的动作语义错误

`ObsidianImportPanel.tsx` 当前把 `replace` 与 `clear` 都计算为来源卷，并在 `keep` 且数据库无卷时回退到来源卷：

```ts
if (action === 'replace' || action === 'clear') return sourceVolumes;
if (action === 'fill') return dbVolumes.length ? dbVolumes : sourceVolumes;
return dbVolumes.length ? dbVolumes : sourceVolumes;
```

这与数据库动作语义不一致。正确结果必须是：

| action | 最终卷列表 |
|---|---|
| `keep` | 数据库已有卷，允许为空 |
| `fill` | 数据库已有卷非空时取数据库卷，否则取来源卷 |
| `replace` | 本次选中来源卷 |
| `clear` | 空数组 |

章纲卷归属下拉使用的下标必须对应上述最终数组，不能指向最终不会存在的卷。

### P0-2 主进程没有完整运行时 DTO validator

TypeScript 类型和 canonical hash 不能验证来自 `ipcRenderer` 的运行时对象。现有测试同时传入空 `projectId` 和非数组 `selections`，可能先因“项目不存在”失败，不能证明 `selections` 被校验。

校验必须发生在读取项目、扫描目录和进入幂等注册表执行写入之前。每个测试一次只制造一个非法字段，并断言明确的参数错误。

### P0-3 最终实体名称冲突仍只修复一半

当前批次重复检查仍以 `sourceName` 为键，不能阻止：

- 两个不同来源人物都改成同一个最终 `name`。
- 两个不同来源世界观都改成同一个最终 `name`。
- 数据库已有 A、B，来源 A 选择覆盖并改名为 B，最终形成两个 B。
- NFKC、首尾空白或大小写不同但归一化后相同的名称。

校验对象必须是“本次实际写入后的最终数据库状态”，而不是来源名集合。`overwrite=false` 且来源已存在的跳过项不参与新写入冲突；更新项只允许占用自身原记录释放出来的名称。

### P0-4 UI 未预判主进程已有的动作不变量

当前 `blockReasons` 只覆盖 parser issue、世界观分类、卷归属和锁定解锁，没有覆盖：

- 清空总纲却保留最终分卷纲。
- 清空或替换总纲但下游仍 `keep/fill`。
- 清空或替换分卷纲但章纲仍 `keep/fill`。
- `replace` 没有对应来源内容。
- `fill` 在目标为空且没有来源内容。
- `clear` 后章纲仍指向卷。

主进程仍是最终安全边界；UI 必须用同一语义提前禁用“确认导入”并显示具体原因。

### P0-5 reparse 期间仍可能提交旧状态

槽位或卷归属变化会异步 reparse，但面板没有把当前候选的最新 reparse 状态纳入 `canCommit`。用户可在回执返回前提交旧 slots、旧 issues 或旧卷归属。

只要任一已选候选存在“当前最新一代”reparse，提交必须禁用并显示“正在重新解析”。旧代次迟到或失败不能清除新代次的 pending 状态。

### P0-6 override 合并没有使用统一归一化

reparse 后保留 override 当前使用原始 `sourceName === sourceName`。应与仓储匹配一致，统一使用 `normalize('NFKC').trim().toLowerCase()`；仍存在的来源保留作者修改，新来源使用 parser 默认值，已消失来源必须移除。

### P0-7 预览仍不完整

章纲只展示前 20 条且只显示标题与核心冲突；分卷纲、人物、世界观及总纲也有字段不可见。用户不能在覆盖前核验实际写入内容。

允许用折叠、分页或“展开全部”控制性能，但不能静默省略。每类草稿必须能查看所有记录及所有将写入字段；空字段明确显示“无来源，将留空”，不能伪装为已补全。

### P0-8 写库成功但刷新失败没有只重试刷新闭环

当前写库成功后若 `onImported` 抛错，只显示提示。再次点击确认可能重新进入 commit。正确状态机必须区分：

- `editing`：允许编辑与首次提交。
- `committing`：冻结关闭、编辑和重复提交。
- `refreshPending`：数据库已成功，冻结所有导入输入，只允许“重试刷新”或关闭。
- `done`：刷新成功并关闭。

“重试刷新”只能再次调用 `onImported(savedSummary)`，不得再次调用 commit IPC，不得生成新 operationId。

### P0-9 真实 DOM 回归证明力不足

现有 UI 脚本主要验证默认候选、默认 frontmatter 分类和按钮点击；它没有操作分类、覆盖、卷归属、解锁及三层 action，并且只断言策划记录数量，没有断言三层 JSON 内容。

## 范围

本轮包含：

- 完整 commit 运行时 DTO 校验。
- 最终人物、世界观和卷列表计算。
- UI 与主进程动作语义对齐。
- reparse pending 提交门禁。
- override 归一化保留。
- 完整可访问预览。
- 刷新失败只重试刷新。
- 对应仓储、Guard、组件和真实 Electron DOM 回归。
- 在全部自动检查通过后执行真实 Obsidian 目录副本烟测。
- 完成后精简更新 `AGENTS.md` 和 `development-report.md`。

本轮不包含：

- Obsidian 写回、目录监听或双向同步。
- 数据库迁移。
- AI 补字段或改写导入内容。
- 跨进程崩溃后的 operationId 永久幂等；该项保留为 D2 后续增强。
- 更换 React、Electron、SQLite 或现有解析器。

## 功能要求

### R1 运行时 DTO 校验

建议创建独立纯函数 `validateObsidianCommitInput(value: unknown)`，返回判别联合：

```ts
type ValidationResult<T> =
  | { valid: true; value: T }
  | { valid: false; error: string };
```

至少逐层验证：

1. 根输入是非空普通对象。
2. `projectId` 是去除首尾空白后仍非空的字符串。
3. `operationId` 是长度 1—200 的非空字符串。
4. `selections` 是数组，数量不超过扫描上限 500。
5. 每个 selection：
   - `relativePath` 是非空字符串。
   - `hash` 是 64 位小写十六进制 SHA-256。
   - `slots` 是数组，元素只能是 `master|volume|chapter|character|world`，不得重复。
   - `defaultVolumeIndex` 只能是 `null|undefined|非负整数`。
   - `characterOverrides`、`worldOverrides` 必须是数组。
6. 人物 override 的 `sourceName`、`name` 是字符串，`overwrite` 是布尔值。
7. 世界观 override 除上述字段外，`category` 只能是六类合法枚举。
8. `layerChoices` 必须完整包含 `master|volumes|chapters`；action 只能是 `keep|fill|replace|clear`，`unlockLocked` 必须是布尔值。
9. `storyOptionDraft` 若存在，其既有字段必须为字符串，不能接受对象、数组或数字替代。
10. canonical 序列化预算与 64 MiB 上限继续保留，不能替代结构校验。

IPC 顺序固定为：

```text
运行时 DTO 校验
→ canonical hash
→ operationId 幂等注册
→ 仓储 commit
→ 项目/目录/文件/hash 校验
→ rebuilt drafts 与最终状态校验
→ SQLite 事务
```

仓储 `commit` 也必须防御直接调用的非法输入，避免单元测试或未来调用绕过 IPC。

### R2 最终实体名称模拟

人物与世界观分别执行同一算法：

1. 归一化函数固定为 NFKC、trim、lowercase。
2. 根据 `sourceName` 查找现有记录身份。
3. 来源已存在且 `overwrite=false`：操作为 skip，不修改最终状态。
4. 来源已存在且 `overwrite=true`：操作为 update，先从模拟集合移除自身旧名称，再加入最终 `name`。
5. 来源不存在：操作为 create，加入最终 `name`。
6. 任一 update/create 的最终名称为空或已被其他身份占用，整次提交失败。
7. 不同文件、同一文件及归一化变体必须进入同一个批次冲突集合。

错误信息必须指出类型和冲突名称，例如“人物最终名称「沈屿」与另一记录重名”。

### R3 最终卷策略

将最终卷计算提取为可单测的纯函数。输入为数据库卷、已选来源卷和 action，输出必须严格遵循 P0-1 表格。

补充约束：

- 来源卷按候选稳定顺序聚合。
- 卷标题与 `chapterRange` 分别独立归一化去重。
- UI 下拉的 `value` 必须是最终卷数组实际下标。
- action、候选勾选或来源卷 reparse 改变后，原卷归属若越界，必须清空并要求用户重选。
- 主进程必须拒绝 `volumeIndex >= 最终卷数量`，不能只校验其为非负整数。

### R4 reparse 生命周期

面板或 Guard 必须能识别每个候选“当前最新请求”的 pending 状态：

- 发起新一代请求时设为 pending。
- 只有同 epoch、同候选、同最新代次的成功或失败才能结束该 pending。
- 旧回执不能覆盖 drafts，也不能清除 pending。
- `invalidate()` 清除当前页面的 pending 可见状态，同时递增全局 epoch。
- 已选候选 pending 时 `canCommit=false`。
- reparse 失败保留用户当前选择与 override，显示可重试错误，不得悄悄回退到旧结果后允许提交。

### R5 override 合并

人物和世界观复用同一 source key 规则：

```ts
const sourceKey = (name: string) =>
  name.normalize('NFKC').trim().toLowerCase();
```

合并后必须满足：

- 同 key 仍存在：保留作者的 `name/category/overwrite`。
- 新 key：采用 parser 默认值。
- 消失 key：删除旧 override。
- 同一次新 drafts 出现重复 source key：阻塞，不任意选择其中一条。

### R6 UI 动作预判

UI 以准备阶段目标状态和当前选中来源模拟三层最终状态。所有主进程确定性动作错误都应在按钮旁显示，且按钮禁用。

UI 预判不能替代主进程校验。必须有契约测试保证四种 action 的界面结果与仓储结果一致。

### R7 完整预览

预览至少覆盖：

- 总纲：全部 `MasterOutline` 字段及数组项。
- 分卷纲：每卷全部 `VolumeOutline` 字段及数组项。
- 章纲：每章全部 `ChapterOutline` 字段、章号、卷归属及来源标题。
- 人物：最终名称、别名、外貌、性格、背景、人物弧及覆盖状态。
- 世界观：最终名称、分类、描述及覆盖状态。

章纲数量较大时可分页，每页数量固定并显示总数；用户必须能访问最后一条，禁止固定 `slice(0, 20)` 后只给摘要。

### R8 提交与刷新状态机

commit 成功即视为数据库写入完成。此后：

- 保存 `ObsidianImportSummary`。
- 进入 `refreshPending`，不再允许修改输入或调用 commit。
- 自动调用一次 `onImported(summary)`。
- 刷新失败显示“导入已写入，界面刷新失败”，提供“重试刷新”。
- 重试只调用 `onImported(summary)`。
- 刷新成功后调用 `onClose()`。
- 提交和刷新进行中关闭按钮禁用；刷新失败稳定状态允许用户关闭，但再次打开必须重新 prepare。

## 测试矩阵

所有修复遵循 TDD：先写只针对一个缺陷的失败测试，确认它因预期原因失败，再实现最小修复。

### 8.1 运行时 DTO 与仓储测试

必须至少新增以下独立场景：

1. 合法 `projectId` + `selections=undefined`，明确报 selections 参数错误。
2. `projectId` 缺失，其余字段合法，明确报 projectId 参数错误。
3. 非法 operationId、hash、slots、defaultVolumeIndex、override 和 layer action 分别失败。
4. 两个不同来源人物改成同一最终名称，事务零写入。
5. 两个不同来源世界观改成同一最终名称，事务零写入。
6. 已有 A、B，覆盖 A 并改名为 B，失败且 A、B 均不变。
7. `overwrite=false` 的已有来源为 skip，不因未写入的编辑名产生假冲突。
8. NFKC、空白和大小写变体冲突。
9. `keep/fill/replace/clear` 四种最终卷列表。
10. `volumeIndex` 等于或大于最终卷数时失败。
11. `keep` 且数据库无卷时，来源卷不能被章纲引用。
12. `clear` 时，即使选择了来源卷，最终卷列表仍为空。
13. rebuilt parser blocking issue 导致整次事务零写入。
14. 卷标题重复与 chapterRange 重复分别失败。

每个失败测试除了 `success=false`，还必须断言错误类型或关键文本，并断言数据库没有部分写入。

### 8.2 Guard 与组件纯逻辑测试

必须覆盖：

1. A→B→A 旧 reparse 被全局 epoch 拒绝。
2. 同候选旧请求晚回不能清除新请求 pending。
3. 不同候选并发互不覆盖。
4. 已选候选 pending 时提交禁用。
5. reparse 失败保留编辑并阻止提交。
6. sourceName 的 NFKC 变体仍保留 override。
7. 已消失 sourceName 被移除，新 sourceName 使用默认值。
8. layer action 或候选变化使 volumeIndex 越界时自动清空。
9. UI 上下游无效组合显示原因并禁用按钮。
10. commit 成功、刷新失败、点击重试时 commit IPC 调用总数始终为 1，`onImported` 调用为 2。

### 8.3 真实 Electron DOM 回归

不得用直接调用 `prepare/commit` 代替核心交互。测试辅助 IPC 只允许准备 fixture 和读取最终数据库快照。

至少通过真实 DOM 完成并断言：

1. 打开面板并扫描出五类候选。
2. 取消一个候选，确认该候选不进入提交。
3. 点击槽位触发 reparse，pending 期间按钮禁用。
4. 通过下拉框选择世界观分类。
5. 编辑人物最终名称并点击人物覆盖。
6. 编辑世界观最终名称并点击世界观覆盖。
7. 通过下拉框选择未分配章纲的卷归属。
8. 把总纲、分卷纲、章纲 action 分别设置为本场景要求的 `fill/replace/clear`，不能只依赖默认 `keep`。
9. 锁定层在未勾选解锁时不能提交，勾选后可以提交。
10. 上下游非法组合在 DOM 中显示原因且按钮禁用。
11. 提交期间关闭按钮、候选、输入框和 action 控件均禁用。
12. 刷新失败后点击“重试刷新”，证明没有第二次 commit。
13. 成功后读取 SQLite 快照并断言：
    - 总纲 JSON 的关键字段值正确。
    - 分卷纲 JSON 的卷数、标题、章范围和关键事件正确。
    - 章纲 JSON 的章数、章号、卷归属、标题和核心冲突正确。
    - 人物覆盖保留原 id 与 `profileOutline`。
    - 世界观覆盖保留原 id 与 `parentId`，分类为 DOM 选择值。

脚本输出应按场景计数，不再把只读诊断当作 DOM 交互通过项。

### 8.4 真实目录副本烟测

仅在 8.1—8.3 全部通过后执行，并需用户授权使用真实目录：

1. 将作者 Obsidian 项目复制到临时目录。
2. 记录原目录全部文件 hash。
3. 应用只指向临时副本。
4. 完成扫描、候选取消、分类、卷归属、覆盖、解锁和三层导入。
5. 校验 SQLite 最终 JSON 与界面预览一致。
6. 再次计算原目录 hash，必须完全不变。
7. 删除临时副本，不删除或修改原目录。

烟测失败不能以“自动测试全绿”替代。

## 建议实施顺序

1. 恢复并提交本 Spec，避免继续依据旧副本实施。
2. 提取运行时 DTO validator，补 8.1 第 1—3 项。
3. 修最终实体名称模拟，补 8.1 第 4—8 项。
4. 提取最终卷策略并修边界，补 8.1 第 9—12 项。
5. 修 reparse pending 与 override 归一化，补 8.2 第 1—8 项。
6. 补 UI 动作预判与完整预览。
7. 实现提交/刷新状态机，补 8.2 第 9—10 项。
8. 重写 8.3 真实 DOM 回归并断言三层 JSON 内容。
9. 运行全量单元测试、主进程构建、Vite 构建和三套真实 UI 回归。
10. 获得授权后执行 8.4 真实目录副本烟测。
11. 精简更新 `AGENTS.md` 与 `development-report.md`，报告不得隐藏未执行项。

每个步骤独立提交，禁止把用户当前未提交的 `src/renderer/App.tsx` 或 `.codex/` 文件混入。

## 完成标准

只有同时满足以下条件，报告才能写“Obsidian 导入闭环完成”：

- [ ] P0-1 至 P0-9 全部关闭。
- [ ] 运行时 DTO 每个非法维度均有单变量测试。
- [ ] 最终名称、最终卷和最终三层状态均按数据库实际结果计算。
- [ ] 所有 reparse pending、迟到、失败和项目切换路径有测试。
- [ ] UI 可查看所有将写入字段。
- [ ] 刷新重试路径证明 commit 只调用一次。
- [ ] 8.3 的交互均由真实 DOM 操作完成，并断言三层 JSON 内容。
- [ ] `npm run test` 通过。
- [ ] `npm run build:main` 通过。
- [ ] `npx vite build` 通过。
- [ ] `node tests/ui/run-obsidian-import.cjs` 全部通过。
- [ ] `node tests/ui/run-writing-workspace.cjs` 10/10 通过。
- [ ] `node tests/ui/run-creative-decision-ledger.cjs` 16/16 通过。
- [ ] 用户授权后的真实目录副本烟测通过，且原目录 hash 不变。
- [ ] `AGENTS.md` 与开发报告已按事实更新。

若尚未获得真实目录授权，报告只能写“自动验收完成，待真实目录副本烟测”，不能写“全部完成”。

## 报告模板

下一轮开发报告至少逐项写明：

1. 基线与最新提交。
2. P0-1 至 P0-9 每项对应代码文件、测试名称和结果。
3. 自动测试的文件数、测试数及命令退出码。
4. DOM 测试实际操作了哪些控件，不能只写“真实面板已挂载”。
5. 三层数据库 JSON 的关键断言。
6. 真实目录烟测是否执行；未授权或未执行必须明确写出。
7. 仍未完成和明确后续项，不得用“全绿”概括未覆盖需求。
