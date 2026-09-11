# Obsidian 导入 stage 落库 Spec

> 状态：**可实施**（P0 已全部回写正文，含 overlay 下标对齐与 keep+锁定时的解锁勾选）。本轮仅产出本文档，不写代码。
>
> 基线提交：`eb83f65`
>
> 前置 Spec：`2026-09-11-obsidian-parser-fields-design.md`（parser 字段增强，已收口）

## 一句话目标

把卷内阶段文件（`分卷大纲/卷N/阶段N.md`）从「导入时忽略」升级为**独立 stage 候选**，结构化导入并写入对应卷的 `VolumeOutline.stages`，不新增第四策划层、不回填章纲/总纲、不新增数据库迁移。

## 现状与证据

以下均为已读源码与真实 vault 的核实结果（真实 vault 只读，不回写）：

1. 上一轮 `src/main/obsidian/import-candidates.ts` 的 `isOutlineAuxiliary` 把「卷内阶段文件」与「分卷总览」都判为忽略，阶段文件不进候选。本轮**有意反转**：分卷总览仍忽略，阶段文件重新进候选、判 `stage` 槽位。

2. 阶段文件结构（真实项目「我有一个妹妹」，仅卷 1 有 5 个阶段文件，卷 2/3 无）：

   ```markdown
   # 阶段1：订婚与身份暴露（第1—15章）
   ## 这一阶段做什么
   …（本阶段目标，段落）
   ## 关键推进
   - 第1—3章：…（有序/无序列表，含 wiki 链接）
   ## 主要人物
   - [[../../人物/米尘|米尘]]：…
   ## 调用的世界观
   - [[../../世界观/ABO规则|ABO规则]]：…
   ## 阶段出口
   …（阶段结果与下一步）
   ## 卷末钩子          ← 可选，仅部分阶段有
   …（一句话钩子）
   ## 查看逐章细纲       ← 导航，忽略
   [[../../我有一个妹妹_大纲_卷1|…]]
   ```

3. 目录用中文数字「卷一」，真卷文件用阿拉伯「卷1」。归属需中文数字转整数：`import-parser.ts` 已有 `chineseNumberToInt`（未导出，实施时导出复用）。

4. 落库目标 `volume_outlines` 是 `planning_ideas` 表内的 TEXT JSON 列（迁移 v13），`VolumeOutline` 是 JSON 序列化对象——加 `stages` 字段**无需新迁移**，旧数据缺省 `[]` 向后兼容。

5. **现有提交路径（复审补证，实施必读）**：
   - `computeFinalVolumes` 的 keep 直接返回 `dbVolumes`；`applyPlanning` 的 keep/fill-已存在 把整列 `volume_outlines` JSON **原样保留**。
   - `touchesPlanning` 目前只看 master/volume/chapter 草稿与三层动作。只勾阶段、卷层 keep 时，按现状会**跳过** `applyPlanning`，stages 永远写不进去。
   - `identifySlots` 在空槽位之后用 `/分卷/` 判 volume。阶段文件路径含「分卷大纲」，若不**先**判 stage，会再次变成卷候选。
   - `layer-actions.ts` 仍是三层；`incoming.volumes` 只应看 volume 草稿，**不能**把 stage 候选算成「有来源分卷纲」。

## 范围

本轮包含：

- 新增 `VolumeStage` 类型 + `VolumeOutline.stages` 字段 + `stage` 槽位。
- 新增阶段文件解析（`parseStage`，一文件一阶段；原名 `parseStages` 易误解）。
- `identifySlots` / `scanImportCandidates` 让阶段文件重新进候选（槽位 stage）。
- 阶段候选按目录预填 `defaultVolumeIndex`（卷一=0，复用 `chineseNumberToInt`；阿拉伯「卷1」同样支持）。
- UI 槽位 checkbox、归属卷下拉、stage 预览。
- 提交时在 `computeFinalVolumes` **之后**按 `volumeIndex` overlay 写入对应卷的 `stages`；卷 Markdown **从不**产出 stages。
- 策划页读写 `volume_outlines` 时透传已有 `stages`（缺省 `[]`），避免保存/锁定把导入结果丢掉。
- 对应 parser/validator/UI/repo 单测与真实 DOM 回归。

本轮不包含：

- 新增数据库迁移（`volume_outlines` 已是 JSON，加字段无需 schema 变更）。
- 新增第四策划层（stage 不走与总纲/分卷/章纲平行的 keep/fill/replace，依附于卷层）。
- 回填章纲/总纲字段。
- 把阶段做成「勾卷文件则阶段跟着走」（每文件仍独立候选，与章纲一致）。
- Obsidian 写回、监听、双向同步。
- AI 补字段。
- 跨文件用阶段回填章纲 `openingSituation` 等。
- 把「场景」列映射到任何字段。
- 默认要求对真实 vault 目录做复制/扫描烟测（未单独授权则只用 fixture）。
- 策划页可视化编辑 stages、AI 重新生成分卷纲时合并 stages（重新生成仍整表替换，属已知限制，见 R8）。
- 本轮不把 stages 送进 AI 上下文（避免无预算地撑爆 token）。

## 功能要求

### R1 类型与槽位

`src/renderer/types/index.ts`：

- 新增 `VolumeStage`：

  ```ts
  interface VolumeStage {
    title: string;                 // 阶段标题，如「订婚与身份暴露」
    chapterRange: string;          // 如「第 1-15 章」
    goal: string;                  // 这一阶段做什么
    keyProgressions: string[];     // 关键推进（列表，剥 wiki）
    characters: string[];          // 主要人物（列表，剥 wiki；整条 list item，含冒号后说明）
    worldRefs: string[];           // 调用的世界观（列表，剥 wiki）
    exit: string;                  // 阶段出口
    endingHook: string;            // 卷末钩子（可选，缺省 ''）
  }
  ```

- `VolumeOutline` 加 `stages: VolumeStage[]`。读库 / `JSON.parse` 缺字段时视为 `[]`，不要让 UI 因 `undefined` 崩溃。
- `OBSIDIAN_IMPORT_SLOTS` 加 `'stage'`；所有 `Record<ObsidianImportSlot, …>`、`import-validator.ts` 的 `SLOTS`、`SLOT_ORDER`、`SLOT_LABELS`、`types-contract.test.ts` **必须同步**，否则 TypeScript 过不了。
- `ObsidianImportDrafts` 加 `stages: ImportStageDraft[]`（不要把 stage 塞进 `volumes`）。
- 阶段草稿（每文件一条，同 `ImportChapterDraft` 风格）：

  ```ts
  interface ImportStageDraft {
    sourceHeading: string;
    volumeIndex: number | null;    // 提交用；扫描预填来自 defaultVolumeIndex
    stage: VolumeStage;
  }
  ```

- `identifySlots` 里现有 `valid` 只含 `master/volume/chapter`。`role: stage` **本轮不开放**；stage 只由路径判定。`role: volume` 不得把阶段文件改判为卷。

### R2 阶段文件解析（`import-parser.ts`）

新增 `parseStage(content, name): ParseResult<VolumeStage>`（一文件一阶段）：

- 标题取 **level 1** heading。完整命中 `阶段\s*\d+\s*[:：]\s*标题（第 x[—\-–]y 章）` 才拆字段：
  - `title`：冒号后、去掉章范围括号后的标题（「订婚与身份暴露」）。
  - `chapterRange`：括号内统一为 `第 x-y 章`（中文破折号/en-dash 收成 ASCII `-`）。
- 标题不完整命中：`title`/`chapterRange` 留空并记 `missing_field` warning，**不从文件名猜标题**。
- `## 这一阶段做什么` → `goal`（`blocksText`，剥 wiki）。
- `## 关键推进` → `keyProgressions`（`listText`，剥 wiki）。
- `## 主要人物` → `characters`（`listText`，剥 wiki）。
- `## 调用的世界观` → `worldRefs`（`listText`，剥 wiki）。
- `## 阶段出口` → `exit`（`blocksText`，剥 wiki）。
- `## 卷末钩子`（可选）→ `endingHook`（`blocksText`），缺省 `''`。
- `## 查看逐章细纲`：**只忽略该小节本身**，不是「该 heading 之后全文丢弃」。真实样例里钩子在导航之前；若某文件顺序颠倒，不得误删钩子。
- 复用 `stripWikiLinks` / `blocksText` / `listText` / `findSection`。
- `parseVolumes` **不**解析 stages；卷文件 drafts.volumes[].stages 恒为 `[]`。

### R3 槽位与扫描（`import-candidates.ts`）

判定顺序（复审锁定，否则会打回「又变成卷」）：

1. 分卷总览仍走 `isOutlineAuxiliary` → 空槽位、扫描跳过。
2. **先于** `role`/`roles`、先于 `/分卷/` volume 规则：basename 命中 `/^阶段\s*\d+/`，且任一父目录段命中「分卷大纲」或 `/^第.{1,8}卷/` 或 `/^卷([零一二三四五六七八九十百千]+|\d+)$/` → 返回 `['stage']`。
3. 即使 frontmatter `role: volume` / `roles: [volume]`，阶段文件仍是 `['stage']`（延续 parser-fields 的确定性保护，只是从空槽位改为 stage）。
4. 然后才是现有章纲 → 总纲 → 分卷规则。

其它：

- `isOutlineAuxiliary`：**删除阶段文件分支**，只保留分卷总览（`小说大纲_分卷大纲.md` 等）。`分卷大纲/卷一大纲.md` 仍不得被 auxiliary 误伤。
- `scanImportCandidates`：阶段文件不再 `continue`；导航文件（`00 卷一导航.md`）仍跳过。
- 文件名必须锚在开头：`备忘-阶段1讨论.md` 不是 stage（与 parser-fields P0-2 同一条）。
- `SLOT_ORDER` 若用于去重/展示，补上 `stage`，放在 `volume` 之后、人物之前即可。

### R4 归属预填

阶段候选的 `defaultVolumeIndex`（写入草稿 `volumeIndex`，作者可改）：

- 从**父目录段**解析，不从文件名、不从标题章范围跨文件猜卷。
- `卷一` / `卷1` / `第3卷` / `第3卷` 均支持：中文走导出的 `chineseNumberToInt`，阿拉伯走 `parseInt`，结果 `- 1`（卷一=0）。
- 无法解析或目录不含卷号 → `null`（未归属）。
- 建议抽出 `volumeDirToIndex(segment): number | null`，与扫描/单测共用，避免 UI 与主进程各写一套。

预填仅作为默认值；作者可在 UI 下拉改归属。`chineseNumberToInt` 从 `import-parser.ts` 导出复用。

### R5 UI（`ObsidianImportPanel.tsx`）

- 槽位 checkbox 增加 `stage`（这是候选过滤器，**不是**第四策划层；三层动作控件保持总纲/分卷/章纲）。手动改槽位仍走现有 reparse；扫描默认只由路径判 stage。
- 阶段候选显示「归属卷」下拉（复用章纲 `volumeAssign` 机制，value = 最终卷数组下标），未归属时显示占位「选择卷…」。勾了 stage 就要显示，不依赖 chapter 槽位。
- 预览展示 `VolumeStage` 各字段；空字段沿用「无来源，将留空」。
- 阶段候选的选中/归属**不绑在卷文件勾选上**。
- 提交前本地拦截与主进程同一套：未归属、越界、卷层 clear、分卷纲锁定未解锁。阶段门控**不**复用 `finalChaptersWillWrite`：只要勾了 stage 候选就要检。
- **解锁勾选（复审锁定）**：现有 UI 只在卷层 `replace`/`clear` 时显示「解锁」。本轮必须：分卷纲 `locked` 且本次勾了任何 stage 候选时，**即使卷层是 keep**，也显示分卷纲的「解锁」。不改这一处，R6.6 会让作者永远提交不了。
- overlay / 拦截纯函数必须与主进程共用，导出放在 `final-volumes.ts`（见 R6），UI 预判调用同一函数，禁止面板里再写一套。

### R6 提交归堆（`obsidian-import.repo.ts` + `final-volumes.ts`）

**原则（复审锁定）：卷 Markdown 从不拥有 stages。stages 只来自勾选的 stage 候选。**

在 `final-volumes.ts` 导出纯函数 `overlayVolumeStages`（UI 预判与 `validateFinalState` / `applyPlanning` 共用，禁止两套规则）：

```ts
overlayVolumeStages(input: {
  finalVolumes: VolumeOutline[];       // computeFinalVolumes 的结果（已按动作得到卷字段）
  existingVolumes: VolumeOutline[];    // 数据库当前卷，按下标对齐
  selectedStages: ImportStageDraft[];  // 仅勾选的 stage 草稿
}): { ok: true; volumes: VolumeOutline[] } | { ok: false; error: string }
```

算法：

1. 照旧 `computeFinalVolumes(action, dbVolumes, sourceVolumes)` 得到最终卷列表（sourceVolumes 仍只来自 volume 槽位草稿）。
2. `incoming.volumes` / `layer-actions` **仍只看 volume 草稿长度**。只勾阶段不算「有来源分卷纲」。
3. 只勾阶段、卷层 keep，也必须 `touchesPlanning === true`，走 `applyPlanning`。
4. 对第 1 步的列表调用 `overlayVolumeStages`（深拷贝后再改，不要改 `existingVolumes` 引用）：
   - 勾选的 stage 草稿按 `volumeIndex` 分桶。
   - `volumeIndex === null` → `{ ok: false, error }`，要求作者指定卷。
   - `finalVolumes.length === 0` 且 `selectedStages.length > 0` → 拦截（无卷可挂）。
   - `volumeIndex >= finalVolumes.length` → 拦截（同章纲越界）。
   - 某卷桶非空：该卷 `stages = 按阶段序号排序后的该桶`（**整组替换**，不与旧数组 merge；未勾选的阶段文件不进入该数组）。
   - 某卷桶为空：该卷 `stages = existingVolumes[i]?.stages ?? []`。
     - **「导入前」按下标取数据库卷，不是 `finalVolumes[i].stages`。** replace/fill 后 `finalVolumes[i]` 来自卷 Markdown，上面的 `stages` 恒为 `[]`；读错来源会把「未勾阶段则保留」擦掉。
     - 最终卷数少于数据库：被丢掉的下标随卷一起消失（stages 跟着走），这是 replace/clear 的正常结果。
     - 最终卷数多于数据库：新下标没有 `existingVolumes[i]`，桶空则 `stages = []`。
5. 卷层 `clear`：最终卷为空；若仍勾选任何阶段候选 → 拦截「清空分卷纲时不能同时导入阶段」。
6. 分卷纲已锁定且未 `unlockLocked`：只要 `selectedStages.length > 0`，拦截「分卷纲已锁定，导入阶段需确认解锁」（与第 4 步是否真的改了某卷无关：勾了就要解锁）。只改 stages、卷层 keep 且已解锁时，`volume_status` 保持原状态（已锁定仍锁定），不要仅仅因为补了 stages 就把状态打成 `generated`。
7. 不新增第四层动作；stage 随卷层存在性走，但 **stages 字段的写入覆盖独立于卷字段 keep/fill/replace**。

排序键：heading 或文件名开头的 `阶段N` 数字；同号再按 `relativePath`。不要依赖文件系统遍历顺序。

`applyPlanning` 的 keep 不能再「整列 JSON 原样 return」就结束：有 stage overlay 时必须把 `overlayVolumeStages` 的 `volumes` `JSON.stringify` 写回。fill 已存在时同理——卷字段保持 `computeFinalVolumes` 的结果，只覆盖被点名的 `stages`。

### R7 预览（含在 R5 内）

`ObsidianImportPanel` 对 stage 字段完整可查看；空字段明确「无来源，将留空」。

### R8 策划页保真（最低限度，否则落库对用户等于没发生）

- `PlanningWorkspace` 读入 / 保存 / 锁定分卷纲时必须保留每卷 `stages`（`{ ...volume }` 扩展即可；`updateVolume` 仍只改字符串字段时 spread 已能保真）。
- 读库缺 `stages` 视为 `[]`，渲染前不要读 `.length` 撞 undefined。
- **本轮可不做** stages 的可视化编辑。建议最低只读：每卷标题下列出 `阶段N 标题（章范围）`，否则作者无法确认导入成功。
- **已知限制（写进完成说明，不要假装做了）**：点「重新生成」分卷纲仍整表替换，`parseVolumeOutlines` 产出的对象无 stages，导入结果会被清掉。本轮不改 AI 生成协议；若做只读展示，在重新生成按钮旁加一句提示即可。

## 测试矩阵（实施轮 TDD）

实施时先写失败测试，确认因预期原因失败，再实现最小修复。

### 8.1 阶段解析

1. 各小节正确映射（goal/keyProgressions/characters/worldRefs/exit）。
2. `卷末钩子` 可选：无该节时 `endingHook === ''`。
3. wiki 链接剥除正确。
4. `查看逐章细纲` 导航段忽略，不混入任何字段；该节之前的 `卷末钩子` 仍在。
5. 标题不完整命中（例如只有 `## 阶段 1`）→ title/chapterRange 空，不从文件名猜。
6. 真实样例 h1：`# 阶段1：订婚与身份暴露（第1—15章）` 能拆出 title + chapterRange。

### 8.2 槽位与扫描

1. `分卷大纲/卷一/阶段1.md` → 槽位 `['stage']`（非 volume、非忽略）。
2. `我有一个妹妹_大纲_卷1.md` 仍判 volume。
3. `小说大纲_分卷大纲.md` 仍忽略（不进候选）。
4. 路径含「分卷」不得再判 volume（这是上一轮误判的回归点）。
5. `role: volume` 的阶段文件仍为 `['stage']`。
6. `备忘-阶段1讨论.md` 不是 stage；`isOutlineAuxiliary('分卷大纲/卷一/阶段1.md') === false`。
7. 旧断言「阶段文件不进候选 / 空槽位」必须**反转**，不要留着绿测掩护回归。

### 8.3 归属预填

1. 目录「卷一」→ `defaultVolumeIndex = 0`。
2. 目录「卷二」→ `1`；「第3卷」→ `2`；「卷1」（阿拉伯）→ `0`。
3. 目录无卷号 → `null`。

### 8.4 提交归堆

1. 阶段候选按 `volumeIndex` 写入对应卷 `stages`。
2. 卷层 `keep` 且未勾阶段 → 已有 `stages` 不动。
3. 卷层 `keep` 且勾了阶段 → 对应卷 `stages` 更新；`touchesPlanning` 为真；`volume_status` 若原 locked 且已解锁，保持 locked。
4. 卷层 `clear` + 阶段候选 → 拦截。
5. 未归属阶段 → 拦截；越界 → 拦截；最终 0 卷 + 勾阶段 → 拦截。
6. 卷层 `fill`/`replace` 且未勾阶段 → **已有 stages 保留**（断言读的是 `existingVolumes[i].stages`，不是来源卷空数组）。
7. 只勾 2/5 个阶段 → 该卷 `stages.length === 2`（整组替换，不是与旧 5 条 merge 成 7）。
8. 扫描顺序阶段2早于阶段1 → 写入仍按阶段号 1、2 排。
9. 分卷纲 locked、未解锁、勾阶段 → 拦截。
10. `overlayVolumeStages`：replace 后来源卷 `stages: []`、数据库卷 0 已有 5 条、未勾阶段 → 结果卷 0 仍是那 5 条。
11. 直接测纯函数，不要只测 repo。

### 8.5 类型 / validator

1. `stage` 槽位合法通过 DTO。
2. selections 携带 stage 草稿正确校验。
3. `OBSIDIAN_IMPORT_SLOTS` 契约测试更新为含 `stage`。

### 8.6 预览

1. stage 字段可见；空字段留空。
2. 阶段 checkbox 与卷文件勾选互不绑定。
3. 分卷纲 locked + 卷层 keep + 勾了 stage → 「解锁」勾选可见；未解锁时提交按钮保持禁用。

### 8.7 回归

1. 现有 parser 字段增强 8.1—8.3 不破。
2. `node tests/ui/run-obsidian-import.cjs` 全部通过；按需加「勾阶段 + keep 分卷」的 DOM 断言（最终 JSON 含 stages 标题）。
3. 策划页保存分卷纲不得把已有 stages 序列化丢掉（可用纯函数/组件测，不必上 AI）。

### 8.8 真实目录（可选，默认跳过）

未单独授权复制/扫描真实 vault 则**不做**。用 fixture 覆盖 5 个阶段文件格式即可。若授权：只扫副本、记录 hash、断言卷 2/3 的 `stages` 为空数组；脚本不入库。

## 建议实施顺序

1. 提交本 Spec（含独立复审回写）。
2. 写 8.1 失败测试 → `parseStage` → 通过。
3. 写 8.2/8.3 失败测试 → `identifySlots`/`isOutlineAuxiliary`/归属预填 → 通过。
4. 写 8.5 失败测试 → 类型 + validator + SLOT 同步 → 通过。
5. UI 槽位 checkbox + 归属下拉 + 预览（8.6）。
6. 写 8.4 失败测试 → `overlayVolumeStages` + 提交归堆（含 keep 写库、fill/replace 按下标保留、锁定拦截）→ 通过。解锁勾选在 keep+锁定+勾阶段时可见（8.6.3）。
7. R8 保真：读库缺省 `[]`、保存透传；可选只读列表。
8. 全量单测 + `npm run build:main` + `npx vite build` + `node tests/ui/run-obsidian-import.cjs`。
9. 更新 `AGENTS.md` 与开发报告。

每个步骤独立提交，禁止混入未提交的 `App.tsx`、`.codex/`、三份报告。

## 完成标准

- [ ] `parseStage` 各小节映射 + 可选 `卷末钩子` + 只忽略导航小节 + 不完整标题不猜文件名，有单测。
- [ ] `identifySlots` **先于** `/分卷/` 与 `role:volume` 判 stage；真卷仍 volume；分卷总览仍忽略；文件名锚在开头。
- [ ] 归属预填：卷一/卷1=0、卷N=N-1、对不上=null。
- [ ] 提交 overlay：写入对应卷 `stages`；keep 且只勾阶段也能写库；fill/replace 未勾阶段按 `existingVolumes[i]` 保留；clear/未归属/越界/无卷/锁定未解锁均拦截；部分勾选整组替换不 merge；keep+锁定时解锁勾选可见。
- [ ] 无迁移、无第四策划层、不回填章纲/总纲；`incoming.volumes` 仍只看卷文件。
- [ ] 策划页保存/锁定透传 `stages`；重新生成会丢掉 stages 须在报告里写明已知限制。
- [ ] 现有回归不破（`node tests/ui/run-obsidian-import.cjs` 全部通过）。
- [ ] 真实 vault 烟测默认不勾选；未经授权不得复制/扫描原目录。

## 报告模板

实施轮开发报告至少写明：

1. 基线与最新提交。
2. R1—R8 各对应代码文件、测试名称与结果。
3. 自动测试文件数、测试数与命令退出码。
4. 是否新增迁移（应写「否」）；是否新增第四策划层（应写「否」）。
5. 如实说明：stage 依附于卷层存在性，但 stages 字段 overlay 独立于卷 Markdown；keep 路径如何写进 JSON；仅卷 1 有阶段文件时卷 2/3 的 stages 为空数组。
6. 若未做真实目录扫描，写「未授权，未执行」，不要用口头烟测勾完成标准。

---

## 独立复审（2026-09-11）

审查对象：本文初稿。对照仓库现状（`identifySlots` / `isOutlineAuxiliary` / `computeFinalVolumes` / `applyPlanning` / `layer-actions` / `PlanningWorkspace.updateVolume`）与已拍板方向（独立候选、目录预填 `volumeIndex`、嵌套 JSON、无第四层、不跨文件回填）。

**结论（第二次补锁后）：可以按正文实施，不必再开设计讨论。** 一句话目标和「不包含」清单与既定决策一致。测试必须覆盖下列回归；未列入完成标准的项不要做。

### 已对齐（保持）

- 独立 stage 候选，不绑卷文件勾选。
- 目录预填归属，作者可改。
- 写入现有 `volume_outlines` JSON，不迁 v20，不建 stages 表。
- 不第四策划层、不回填章纲/总纲、不写回 Obsidian。

### P0（不改则实施必错；已回写正文）

1. **`identifySlots` 必须先判 stage。** 初稿只写「返回 `['stage']`」，没写要压在 `/分卷/` 和 `role:volume` 之前。`分卷大纲/卷一/阶段1.md` 命中现有 volume 规则，会打回上一轮误判。
2. **文件名仍用 `/^阶段\s*\d+/`，锚在 basename 开头。** 初稿 `^阶段\d+` 丢掉可选空白，也没写 role 保护。
3. **stages overlay，不是「随 fill/replace 写来源卷.stages」。** 卷文件 `parseVolumes` 没有 stages。fill/replace 未勾阶段时若用来源空数组覆盖，会擦掉已导入阶段。keep 在现有 `applyPlanning` 里整列不写库；只勾阶段时 `touchesPlanning` 为假。必须改提交路径。
4. **部分勾选 = 整组替换该卷 stages，禁止与旧数组 merge。** 初稿「更新」二字会实施成 append。
5. **锁定分卷纲时改 stages 必须解锁。** 初稿未提 lock。stages 在卷 JSON 内，静默写入等于绕过锁定。
6. **无最终卷仍勾阶段要拦截。** 与章纲同一条，初稿只写了越界。
7. **「导入前」= `existingVolumes[i]?.stages ?? []`，按下标对齐。** 读 `finalVolumes[i].stages` 会在 replace/fill 时擦掉已有阶段。纯函数 `overlayVolumeStages` 与 UI 共用。
8. **keep + 分卷纲 locked + 勾阶段时必须显示解锁勾选。** 现有解锁框只挂在 replace/clear 上，不改 UI 则 R6.6 永远无法满足。

### P1（建议本轮做完，否则功能不可见或不对称）

1. 阿拉伯目录「卷1」与中文「卷一」都要能预填（真实卷文件是「卷1」，目录是「卷一」）。
2. `查看逐章细纲` 只忽略该小节，不要「及之后全文丢弃」。
3. 阶段排序按 `阶段N` 数字，不按扫描顺序。
4. 策划页保存透传 `stages`；至少只读列出标题，否则导入成功作者看不见。
5. 所有 `ObsidianImportSlot` 穷举处同步加 `stage`（validator `SLOTS`、`SLOT_LABELS`、契约测试），否则编译或运行期非法槽位。
6. 标题正则与总纲 phase 一样要完整命中，禁止短标题 `## 阶段 1` 当成功解析。

### P2（可另立，不要混进本轮）

- 策划页编辑 stages、AI 重新生成时保留 stages。
- stages 进 AI 上下文（要单独 token 预算）。
- 真实 vault 复制烟测（需授权；默认 fixture）。
- `role: stage` frontmatter。
- 用阶段文件回填章纲/总纲或映射「场景」列。

### 不采纳的替代

- 独立 `stages` 表 + 迁移 v20：卷无稳定行 id，FK 只能挂 `volumeIndex`，重排即挂错。
- 第四策划层 keep/fill/replace：与「阶段是卷的子结构」冲突，UI 会再出现一套锁定。
- 「勾卷则阶段跟着走」：真卷在根目录 `*_大纲_卷N.md`，阶段在 `分卷大纲/卷一/`，会打穿一候选一路径。
