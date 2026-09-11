# Obsidian 导入 parser 字段增强 Spec

> 状态：实施主体已合入 `3a9857d`；独立复审（见工作区 `parser-fields-enhancement-report.md` 第五节）发现 2 项产品偏差（P0-1 phase heading 误触发、P0-2 阶段文件名未锚定），已于 `3442373` 修复并补 P1 测试；P2 文档口径于 `c5ad577`/`a42bb78` 更新。第二次独立复审（报告第八节）确认 P0/P1 生产逻辑收口；真实 vault 烟测仅有实施方书面记录、脚本未入库、未做第二人独立复跑，故完成标准第三条不勾选。
>
> 基线提交：`ffa2cb9`
>
> 前置 Spec：`2026-09-10-obsidian-import-completion-design.md`（Obsidian 导入闭环补齐，已收口）

## 一句话目标

补齐 Obsidian 单向导入 parser 的三处**功能缺口**：章纲 `pov/openingSituation/keyBeats/characterChange`、总纲 phase 子字段（`purpose/turningPoint/emotionTrend/keyEvents`）的「可选列/小节」解析，以及卷内阶段文件与分卷总览（`分卷大纲/卷N/阶段N.md`、`小说大纲_分卷大纲.md`）被误判为「卷」的问题。规则上坚持**只认可选来源、无来源留空**，绝不猜测、绝不跨文件推导。

## 现状与证据

以下均为已读源码与真实 vault 的核实结果（真实 vault 只读，不回写）：

1. `src/main/obsidian/import-parser.ts` 的 `parseChapters`：
   - 已映射「章/标题/核心事件/剧情推进/伏笔/情绪」五列，并把「爽点/悬念」列拆出 `payoff`/`endingHook`。
   - `pov`、`openingSituation`、`keyBeats`、`characterChange` 四个字段**硬编码为空**（`pov:''`、`openingSituation:''`、`keyBeats:[]`、`characterChange:''`）。
   - 「场景」列已通过 `col('场景')` 取到 `iScene`，但**未映射到任何字段**；本轮不动它（避免把「场景」猜测成 `openingSituation`）。

2. `parseMaster`：phase 仅从「三卷大纲索引」列表项填充 `title` + `chapterRange`，`purpose/keyEvents/turningPoint/emotionTrend` 恒为空。

3. `src/main/obsidian/import-candidates.ts` 的 `identifySlots`：
   - 文件名命中 `/大纲_卷\d|分卷|卷纲|第.{1,4}卷/`，或目录段命中 `/^(第.{1,8}卷|分卷|卷纲)/`，即判 `volume`。
   - 两类误伤，导致 8.4 真实 vault 烟测里 volume 候选数 = 9 而非 3：
     - 卷目录下的阶段文件 `分卷大纲/卷一/阶段N.md`（5 个）。
     - 分卷总览 `小说大纲_分卷大纲.md`（其卷是 level 2 标题，`parseVolumes` 只认 level 1，被判 volume 只会产出 1 个空卷噪音）。
   - 真正提供卷数据的是 3 个 `我有一个妹妹_大纲_卷N.md`（level 1 标题 = 卷）。

4. 真实数据格式（真实项目「我有一个妹妹」，只读）：
   - 章纲表头：`| 章 | 标题 | 核心事件 | 剧情推进 | 爽点/悬念 | 伏笔 | 场景 | 情绪 |`（卷 2/3 简化为 `章|标题|核心事件|爽点/钩子`）。**没有** pov/开场/节拍/人物变化列。
   - 总纲 `我有一个妹妹_完整大纲.md`：phase 是「三、三卷大纲索引」下的扁平列表项（`1. [卷 1 …（第 1-50 章）](…)`），**没有** phase 子字段小节。
   - 卷内阶段 `分卷大纲/卷一/阶段1-…md`：独立文件，标题 `# 阶段1：…（第1—15章）`，含「这一阶段做什么/关键推进/主要人物/阶段出口」。

## 范围

本轮包含：

- 章纲表格的**可选列**解析：仅当表头命中对应列名时才填充，否则留空。
- 总纲 phase 的**可选小节**解析：仅当 phase 以「独立 heading + 小节列表」形式存在时才填充。
- `identifySlots` 对卷内阶段文件与分卷总览的**误判修复**（不判 volume，倾向完全忽略）。
- 对应 parser 单测、真实 vault 副本烟测（卷数 = 3）、`AGENTS.md` 与开发报告更新。

本轮不包含：

- Obsidian 写回、监听或双向同步。
- 数据库迁移（字段已在现有 JSON 列里，只是解析值变化）。
- 把「场景」列推导为 `openingSituation`、把「爽点/悬念」列拆成 `keyBeats`（除非列名直接命中）。
- 跨文件补充（用卷内阶段内容回填章纲/总纲字段）。
- 把卷内阶段 `stage` 落库或新增 stage 槽位（本次只修误判，不建模 stage 层级）。
- AI 补字段。

## 功能要求

### R1 章纲可选表格列

`parseChapters` 增加「可选列名 → 字段」映射，**仅当表头命中才解析**，未命中字段保持现状空值：

| 字段 | 可选列名 |
|---|---|
| `pov` | `视角`、`POV`、`pov` |
| `openingSituation` | `开场处境`、`开场` |
| `keyBeats` | `关键节拍`、`节拍`、`keyBeats` |
| `characterChange` | `人物变化`、`人物弧变化` |

约束：

- 列名匹配做 trim 后精确匹配（可接受大小写不敏感）。
- `keyBeats` 命中后按 `；`/`、` 拆分去空（复用现有爽点/悬念列的拆分法）。
- 未命中字段保持空值，**绝不猜测**；现有五列映射不回退。

### R2 总纲 phase 可选小节

phase 的 `purpose`、`turningPoint`、`emotionTrend`、`keyEvents` 仅在 phase 以「独立 heading + 小节列表」形式存在时解析，例如：

```markdown
## 阶段 1：骗婚骗心（第 1-50 章）
- 目的：建立骗局与三角张力
- 转折点：性别暴露
- 情绪趋势：暧昧转暗流
- 关键事件：黄金三章、订婚、身份暴露
```

真实「完整大纲」的 phase 是扁平列表项，命不中该结构，字段保持空；该能力为通用格式预留，不影响当前 vault。

约束：

- 结构识别失败时 `title` + `chapterRange` 仍按现有逻辑正确填充，子字段留空。
- **进入 heading 路径的门禁**：至少一条 h2 **完整命中** `阶段 N：标题（第 x-y 章）` 才切换；仅有不合规 `## 阶段 N …` 时必须回退「三卷大纲索引」，不得把索引 3 条 phase 丢掉。
- 不把「三卷大纲索引」的列表项文本猜测成 phase 子字段。

### R3 卷内阶段文件与分卷总览的误判修复

`identifySlots` 做两处排除，只让「一个文件 = 一个卷」的真卷文件判 `volume`：

1. 文件处于卷目录（**任一祖先目录段**命中 `分卷大纲` 或 `第.{1,8}卷`，不要求下一段必须是 `卷N`）且**文件名以** `阶段N` 开头时，不判 `volume`。文件名仅在中间含「阶段1」（如 `备忘-阶段1讨论.md`）不得忽略。
2. 分卷总览 `小说大纲_分卷大纲.md`（文件名命中 `分卷大纲` 但非 `大纲_卷N` 形式；其卷是 level 2 标题，`parseVolumes` 只认 level 1，会产出空卷噪音）不判 `volume`。

二者均**完全忽略**（不进入候选、不产生槽位、不落库），避免噪音。

必须同时保住：

- `我有一个妹妹_大纲_卷N.md`（根目录，文件名命中 `大纲_卷\d`）仍判 `volume`。
- 实施轮需验证真实 vault 的 volume 候选数 = 3（即 3 个 `大纲_卷N`）。

### R4 预览

`ObsidianImportPanel.tsx` 的 `Field` 已对空字段显示「无来源，将留空」，无需改动；新增解析字段自然出现在预览中，空字段不伪装成已补全。

## 测试矩阵（后续实施轮，TDD）

实施时先写失败测试，确认因预期原因失败，再实现最小修复。

### 8.1 章纲可选列

1. 表头含 `视角` 列时，`pov` 取该列值。
2. 表头含 `关键节拍` 列且单元格含 `；` 时，`keyBeats` 正确拆分去空。
3. 表头不含可选列时，`pov/openingSituation/keyBeats/characterChange` 全部为空值（空串 / `[]`）。
4. 现有「章/标题/核心事件/剧情推进/伏笔/情绪/爽点·悬念」映射不回退。
5. 仅含「场景」列时，`openingSituation` 仍为空（不误填）。

### 8.2 总纲 phase 可选小节

1. phase 为「heading + 小节列表」时，`purpose/turningPoint/emotionTrend/keyEvents` 正确填充。
2. phase 为扁平列表项时，子字段为空但 `title` + `chapterRange` 正确（单测必须显式断言 `purpose/turningPoint/emotionTrend === ''` 且 `keyEvents === []`，`toMatchObject` 只含 title/range 不够）。
3. 同一份总纲同时含「三卷大纲索引」与不合规 `## 阶段 1 草稿` 时，仍走索引：3 条 phase、章范围保留、子字段为空。

### 8.3 卷内阶段与分卷总览误判

1. `分卷大纲/卷一/阶段1-…md` 不判 `volume`、不产生候选。
2. `小说大纲_分卷大纲.md` 不判 `volume`、不产生卷候选。
3. `我有一个妹妹_大纲_卷1.md` 仍判 `volume`。
4. `分卷大纲/卷一/备忘-阶段1讨论.md` 不得当辅助文件忽略，仍进入候选。
5. `identifySlots('分卷大纲/卷一/阶段1.md', { role: 'volume' })` 仍为空槽位。
6. 直接测 `isOutlineAuxiliary`：阶段文件与分卷总览为 true；`分卷大纲/卷一大纲.md` 与 `大纲_卷N` 为 false。
7. 真实 vault 副本烟测：volume 候选数 = 3（3 个 `大纲_卷N`）。未独立复现前不得勾选完成标准对应项。

## 建议实施顺序

1. 提交本 Spec。
2. 写 8.1 失败测试 → 实现 `parseChapters` 可选列 → 通过。
3. 写 8.2 失败测试 → 实现 `parseMaster` 可选小节 → 通过。
4. 写 8.3 失败测试 → 修 `identifySlots` 排除阶段文件与分卷总览 → 通过。
5. 核对 `ObsidianImportPanel` 预览（预期无需改）。
6. 全量单元测试 + `npm run build:main` + `npx vite build` + `node tests/ui/run-obsidian-import.cjs`。
7. 用户授权后跑真实 vault 副本烟测，断言 volume = 3、原目录 hash 不变。
8. 精简更新 `AGENTS.md` 与开发报告。

每个步骤独立提交，禁止混入用户未提交的 `src/renderer/App.tsx`、`.codex/`。

## 完成标准

- [x] 章纲可选列解析有单测，未命中留空有单测。
- [x] 总纲 phase 可选小节解析有单测，扁平列表项留空有**显式空值断言**（8.2.2）。
- [x] 不合规 `## 阶段 N` 不得关掉三卷索引（8.2.3）。
- [x] 阶段文件名以 `阶段N` 开头才忽略；中间夹「阶段1」的文件仍进候选（8.3.4）。
- [x] 显式 `role: volume` 的阶段文件仍空槽位（8.3.5）；`isOutlineAuxiliary` 有直接单测（8.3.6）。
- [ ] `identifySlots` 修复后真实 vault volume 候选数 = 3（须可复现：系统 temp 副本、只扫描不写库、原目录 hash 不变）。仅实施方书面记录（37 个 md 的 12 位 hash、脚本未入库）不足以勾选，需第二人独立复跑。
- [x] 不新增数据库迁移、不落库 stage、不跨文件推导、不猜测。
- [x] 现有 8.1—8.3 回归不破（`node tests/ui/run-obsidian-import.cjs` 全部通过）。

## 报告模板

实施轮开发报告至少写明：

1. 基线与最新提交。
2. R1/R2/R3 各对应代码文件、测试名称与结果。
3. 自动测试文件数、测试数与命令退出码。
4. 真实 vault 副本烟测是否执行；volume 候选数是否 = 3；原目录 hash 是否不变。
5. 如实说明：章纲 `pov/openingSituation/keyBeats/characterChange`、总纲 phase 子字段对当前 vault **仍为空**（真实数据无对应列/小节），本轮收益是「可解析可选来源 + 修 stage 误判」。
