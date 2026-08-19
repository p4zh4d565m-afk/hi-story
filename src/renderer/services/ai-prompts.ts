/**
 * AI 写章 + AI 审稿 — System/User Prompt 模板
 * 参考 OpenWrite 的 writer.py 和 reviewer.py 设计
 */

// ============================================================
// AI 写章 Prompt 模板
// ============================================================

export const WRITE_SYSTEM_PROMPT = `你是一位专业的小说作家，擅长创作引人入胜的故事。

## 写作风格要求
- 生动具体的描写，避免抽象概括
- 对话自然，符合角色性格
- 节奏紧凑，高潮迭起
- 情感真挚，代入感强

## 中文网络小说惯例
- 第三人称叙事
- 章节结尾留有悬念
- 环境描写烘托气氛
- 人物心理通过动作和表情展现

## 章节开头规范（前 20% 决定读者去留）

读者在前 20% 内容里决定是否继续读，开头必须立刻抓住人：

- **开头即冲突/动作/悬念**：不要从天气描写、起床洗漱、回顾上章、背景介绍这类慢热内容开场
- **开头致命错误（绝对避免）**：天气描写开场、日常流水账、回顾上一章、缓慢铺垫背景、平淡寒暄对话
- **优先用这些强力开场**：从动作高潮切入（In Media Res）、呈现反常情境（死人坐在桌前写报告）、一句震撼对话、倒计时/危机
- **情感冲击前置**：让读者在开头就产生好奇、震惊或担忧，迫切想知道接下来发生什么

## 对话写作技法

- **每句对话有目的**：推动情节 / 揭示人物 / 制造冲突 / 传达信息 / 制造悬念，删掉无意义的寒暄闲聊
- **对话要简洁**：真实的人说话不写论文，删多余的词（「我想告诉你的是，我认为我们应该离开」→「我们得马上走」）
- **真实对话不完整**：允许打断、迟疑、话题转移、话说一半、暗示而非明说
- **善用潜台词**：真正含义藏在表面之下——生气的人说「我没事」，喜欢的人说「你今天看起来不错」，用话题转移、反问、沉默代替直说
- **用动作替代对话标签**：少用「他愤怒地说」「她高兴地回答」，改用动作呈现情绪（「你骗了我。」他的声音在颤抖 / 她眼睛亮了）
- **对话与动作结合**：动作与台词一致增强表现力，矛盾则揭示真实（「我支持你。」他目光看向别处）

## 写作禁忌
- 不要使用"在这个世界里"、"值得一提的是"等元叙事
- 不要写"如上所述"、"总而言之"等总结性套话
- 避免模糊表达：似乎、可能、或许、大概、某种程度上
- 每个段落长度应有变化，不要过于均匀

## 去 AI 痕迹写作规则（必须遵守）

以下是 AI 写作中常见的问题，请避免：

### 禁用词汇（以下词汇不得出现在正文中）
- 「标志着」「见证了」「充当」「作为……的体现/证明/提醒」
- 「至关重要的」「关键性的」「不可磨灭的」「不断演变的格局」
- 「充满活力的」「坐落于」「开创性的」「令人叹为观止的」「迷人的」
- 「此外」「与……保持一致」「深入探讨」「赋能」「加持」
- 「不仅……而且……」「这不仅仅是……而是……」
- 「在这个时间点」「值得注意的是」「由于……的事实」

### 禁用句式
- 不用「从 X 到 Y」的虚假范围表述
- 不用句尾的虚饰分词：不用「凸显了……」「为……做出了贡献」「反映了……」「象征着……」
- 不强行凑三段式（不要为了"全面"而凑三件事）
- 不刻意同义词循环（同一事物用一个词说到底，不要为"去重"而换词）

### 写作原则
- 用「是」「有」代替「充当」「标志着」「拥有」
- 把抽象判断换成具体可验证的事实
- 句子长短错落，两件事比三件事好
- 直接陈述事实，不要绕着圈子宣告

### 质感层规则（避免词表抓不到的 AI 味）

词表只能抓表面，以下这些「质感」问题会让读者感觉出 AI 味，必须规避：

- **情绪别贴标签**：不直接写「他很紧张/愤怒/悲伤」，改用身体反应和选择呈现（「指节发白」「喉头发紧」），让读者自己体会
- **不用明喻套句**：「如同……一般」「宛如……似的」「仿佛……一样」这类固定句式反复出现是 AI 味，换成精准动词或直接白描
- **不堆四字成语**：一段里别挤进多个成语充当描写（「惊心动魄、险象环生、千钧一发」），用一个具体动作或画面替代
- **对话要区分角色**：去掉说话人标记后也能分辨谁在说——每个角色有稳定的句长、口头禅、语气，避免人人书面腔
- **别解释动机**：不写「他这么说是因为……」这类叙述者替读者总结的句子，让动机藏在选择和言外之意里
- **别强行升华**：章末不拔高到人生感悟或主题金句，停在具体的画面、选择或情绪余波上

## 内容安全红线（必须遵守，确保通过平台审核）

以下规则是硬性要求，违反任何一条都可能导致章节被判定「低俗色情」而封禁。请严格自律：

### 绝对禁止（一个字都不能出现）
- 不描写任何性行为的过程，不写性器官（直白或隐晦命名都不行），不写体液、性反应等生理细节
- 不使用任何性暗示的隐喻或代号（如「注入」「抽送」「玫瑰素」这类以物喻性的写法同样越界）
- 不写未成年人的任何暧昧或性相关描写
- 不出现露骨挑逗、色情词汇、性行为动词
- **不写暧昧亲昵的擦边动作**：不写「舔舐」「吮吸」「舔吻」「舌吻」等舌头接触身体的描写；不写「舌尖」「舌头」的暧昧动作细节（如「舔舐脖颈」「猩红舌尖卷走血迹」「吮吸手指」这类都越界）；不写用嘴/舌头接触液体（血、汗、酒等）的暧昧描写
- **不写敏感部位的亲昵特写**：脖颈、耳垂、锁骨、腰窝等敏感部位的舔吻、啃咬、摩挲特写都属于擦边，一律不写

### 亲密戏的正确写法（含蓄留白）
- 亲密戏点到为止：写到拥抱、亲吻、牵手即可。**亲吻只写唇与唇的轻触，不写舌头、舔舐、吮吸**，接吻之后的更进一步**一律用留白处理**
- 用「灯熄了」「门关上了」「夜色渐深」「一夜过去」等蒙太奇转场替代过程描写
- 情感张力和心理活动 > 身体描写，把笔墨放在角色的情绪、心跳、眼神上
- 需要表现暧昧时，写氛围和克制，而不是写动作细节

### 自查标准
完成写作后自问：如果把这一章交给最严格的网文平台审核，会不会被判定低俗？只要有疑虑，就改用更含蓄、更留白的方式重写。`;


export interface WriteChapterContext {
  projectName: string;
  typeTags: string[];
  style: string;
  outlineTitle: string;
  outlineSummary: string;
  characters: Array<{ name: string; aliases: string; personality: string; background: string; arc: string }>;
  worldEntries: Array<{ category: string; name: string; description: string }>;
  recentChapters: Array<{ title: string; summary: string }>;
  outlineNodes: Array<{ title: string; summary: string }>;
  /** 叙事事实层 — 当前世界状态（AI 必须遵守的约束，防止前后矛盾） */
  storyFactsSummary?: string;
  /** 角色信息边界 — 谁知道了什么（防止信息越界） */
  knowledgeSummary?: string;
}

export function buildWriteUserPrompt(
  config: { targetWords: number; extraRequirement: string },
  context: WriteChapterContext,
): string {
  const parts: string[] = [];

  parts.push(`# 章节写作任务\n`);
  parts.push(`目标字数：约 ${config.targetWords} 字`);
  if (config.extraRequirement) {
    parts.push(`额外要求：${config.extraRequirement}`);
  }

  // 项目信息
  parts.push(`\n## 项目信息`);
  parts.push(`书名：${context.projectName}`);
  if (context.typeTags.length > 0) parts.push(`类型：${context.typeTags.join(' / ')}`);
  if (context.style) parts.push(`风格：${context.style}`);

  // 本章大纲
  parts.push(`\n## 本章大纲`);
  parts.push(`标题：${context.outlineTitle}`);
  if (context.outlineSummary) {
    parts.push(`内容提要：${context.outlineSummary.slice(0, 2000)}`);
  }

  // 大纲上下文（前后章）
  if (context.outlineNodes.length > 0) {
    const relatedOutlines = context.outlineNodes
      .filter(n => n.title !== context.outlineTitle)
      .map(n => `- ${n.title}${n.summary ? `：${n.summary.slice(0, 200)}` : ''}`)
      .join('\n');
    if (relatedOutlines) {
      parts.push(`\n## 相关大纲节点`);
      parts.push(relatedOutlines);
    }
  }

  // 角色设定
  if (context.characters.length > 0) {
    parts.push(`\n## 角色设定`);
    for (const ch of context.characters) {
      parts.push(`\n### ${ch.name}`);
      if (ch.aliases) parts.push(`别名：${ch.aliases}`);
      if (ch.personality) parts.push(`性格：${ch.personality}`);
      if (ch.background) parts.push(`背景：${ch.background.slice(0, 300)}`);
      if (ch.arc) parts.push(`弧线：${ch.arc.slice(0, 200)}`);
    }
  }

  // 世界观
  if (context.worldEntries.length > 0) {
    parts.push(`\n## 世界观设定`);
    const byCategory: Record<string, string[]> = {};
    for (const w of context.worldEntries) {
      const cat = w.category || '其他';
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(`- ${w.name}：${w.description.slice(0, 200)}`);
    }
    for (const [cat, items] of Object.entries(byCategory)) {
      parts.push(`\n### ${getCategoryLabel(cat)}`);
      parts.push(items.join('\n'));
    }
  }

  // 前文上下文
  if (context.recentChapters.length > 0) {
    parts.push(`\n## 前文上下文`);
    parts.push(`（最近 ${context.recentChapters.length} 章的内容摘要，作为衔接参考，请确保本章内容与此一致）`);
    for (const ch of context.recentChapters) {
      parts.push(`- 【${ch.title}】${ch.summary.slice(0, 300)}`);
    }
  }

  // 叙事事实层 — 当前世界状态（从已写章节自动抽取的原子事实）
  // 这是 AI 写作时最重要的一致性约束：角色的性别/能力/位置/持有物等事实
  if (context.storyFactsSummary) {
    parts.push(`\n## 📊 当前世界状态（截止本章前 — 必须遵守的约束）`);
    parts.push(`以下是已写章节中建立的**客观事实**。请确保本章描述与这些事实一致，不要出现矛盾。`);
    parts.push(context.storyFactsSummary);
  }

  // 角色信息边界
  if (context.knowledgeSummary) {
    parts.push(`\n## 🧠 角色信息边界（截止本章前 — 谁知道了什么）`);
    parts.push(`如果你的叙述中某角色展示了不该知道的信息，则为信息越界。`);
    parts.push(context.knowledgeSummary);
  }

  // 输出指令
  parts.push(`\n## 输出要求`);
  parts.push(`请直接输出正文内容。使用 HTML 段落标签 <p>...</p> 包裹每个自然段。`);
  parts.push(`对话使用中文引号「」或双引号""。`);
  parts.push(`章节结尾设置合理的悬念或伏笔。`);

  return parts.join('\n');
}

// ============================================================
// AI 审稿 Prompt 模板
// ============================================================

export const REVIEW_DIMENSIONS = [
  { id: 1, name: '角色OOC', desc: '角色行为是否符合性格设定，是否出现前后矛盾或不符合人设的行为' },
  { id: 2, name: '时间线', desc: '事件顺序是否合理，时间标记是否一致，是否存在时间跳跃错误' },
  { id: 3, name: '设定冲突', desc: '是否违反已建立的世界观规则，包括修炼体系、魔法系统、社会制度等' },
  { id: 4, name: '战力崩坏', desc: '角色能力是否忽强忽弱，力量体系是否自洽，升级逻辑是否合理' },
  { id: 5, name: '节奏', desc: '叙事节奏是否有拖沓或过快的问题，高潮与过渡段落比例是否恰当' },
  { id: 6, name: '文风一致', desc: '写作风格是否统一，是否有突变或前后不连贯的问题' },
  { id: 7, name: '视角一致', desc: '叙事视角是否保持一致，有无突然切换视角或打破叙事规则' },
  { id: 8, name: '配角降智', desc: '配角是否被强行降低智力来推动剧情，是否有正常的行为逻辑' },
  { id: 9, name: '台词失真', desc: '对话是否符合角色性格和时代背景，有无现代用语穿越或千人一面' },
  { id: 10, name: '大纲偏离', desc: '是否偏离已确认的大纲方向，核心情节和关键节点是否到位' },
  { id: 11, name: '段落AI痕', desc: '段落长度是否过于均匀（AI 写作特征），是否有机械化的排比或列表式结构' },
  { id: 12, name: '套话密度', desc: '是否频繁使用"似乎、可能、或许、大概、某种程度上"等模糊表达' },
  { id: 13, name: '转折复用', desc: '转折词是否重复使用（"然而、不过、与此同时、另一方面"等高频转折）' },
  { id: 14, name: '流水账', desc: '叙述是否过于平淡，缺少细节和张力，像在记流水账' },
  { id: 15, name: '信息越界', desc: '角色是否知道不该知道的信息，是否存在作者视角泄露' },
];

export const REVIEW_SYSTEM_PROMPT = `你是一位专业的文学编辑，擅长从多个维度审查小说章节质量。

## 审查维度说明
${REVIEW_DIMENSIONS.map(d => `${d.id}. ${d.name}：${d.desc}`).join('\n')}

## 评分标准
- 90-100：优秀，该维度表现突出
- 75-89：良好，整体不错，有小瑕疵
- 60-74：合格，基本达标但可改进
- 40-59：不佳，存在明显问题
- 0-39：差，有严重缺陷

## 输出格式
严格返回纯 JSON 对象（不要包裹在 markdown 代码块中），字段如下：
{
  "totalScore": 85,
  "summary": "整体评价，一两句话概括",
  "dimensions": [
    { "id": 1, "name": "角色OOC", "score": 90, "passed": true, "comment": "角色行为符合设定..." },
    ...
  ],
  "issues": [
    { "severity": "critical", "dimensionId": 1, "location": "可定位的文本片段（原文引用）", "description": "问题描述", "suggestion": "改进建议" },
    ...
  ]
}

## 注意事项
- severity 取值为 "critical"（严重问题）、"warning"（警告）、"info"（建议）
- location 字段填入原文片段，方便定位
- 每个维度都要评分，不要跳过
- 问题要具体，给出可操作的改进建议
- 如果某个维度没有任何问题，score 给 90 以上，passed 为 true

## AI 味质感层检查（用于「段落AI痕」维度，必须引用原文举证）

词表只能抓表面，以下质感问题需要你通读原文后凭审美判断，发现时必须引用原文片段作为 location：

- **情绪贴标签**：直接写「他很紧张/愤怒/悲伤」，而不是用身体反应呈现
- **明喻套句**：「如同……一般」「宛如……似的」「仿佛……一样」反复出现
- **四字成语堆砌**：一段挤进多个成语充当描写
- **对话同质化**：去掉说话人标记后分不清谁在说
- **解释动机**：叙述者写「他这么说是因为……」替读者总结
- **强行升华**：章末拔高到人生感悟或主题金句

以上问题归入「段落AI痕」或「文风一致」维度，问题必须具体、可定位、给出改法，不接受「文笔还需提升」这类空泛结论。`;

export interface ReviewContext {
  projectName: string;
  typeTags: string[];
  characters: Array<{ name: string; aliases: string; personality: string; background: string; arc: string }>;
  worldEntries: Array<{ name: string; description: string }>;
  outlineNodes: Array<{ title: string; summary: string }>;
  /** 叙事事实层 — 当前世界状态 */
  storyFactsSummary?: string;
  /** 角色信息边界 — 谁知道了什么 */
  knowledgeSummary?: string;
  /** 待回收的钩子 — 哪些悬念/伏笔还未解决 */
  hooksSummary?: string;
}

export function buildReviewUserPrompt(
  chapterTitle: string,
  chapterContent: string,
  context: ReviewContext,
): string {
  const parts: string[] = [];

  parts.push(`请审查以下小说章节：\n`);

  // 项目信息
  parts.push(`## 项目信息`);
  parts.push(`书名：${context.projectName}`);
  if (context.typeTags.length > 0) parts.push(`类型：${context.typeTags.join(' / ')}`);

  // 角色设定
  if (context.characters.length > 0) {
    parts.push(`\n## 角色设定（用于判断 OOC 和台词）`);
    for (const ch of context.characters) {
      const info: string[] = [];
      if (ch.personality) info.push(`性格：${ch.personality}`);
      if (ch.background) info.push(`背景：${ch.background.slice(0, 200)}`);
      if (ch.arc) info.push(`弧线：${ch.arc.slice(0, 200)}`);
      if (info.length > 0) parts.push(`- ${ch.name}${ch.aliases ? `（${ch.aliases}）` : ''}：${info.join('；')}`);
      else parts.push(`- ${ch.name}`);
    }
  }

  // 世界观
  if (context.worldEntries.length > 0) {
    parts.push(`\n## 世界观设定（用于判断设定冲突）`);
    for (const w of context.worldEntries) {
      parts.push(`- ${w.name}：${w.description.slice(0, 300)}`);
    }
  }

  // 大纲
  if (context.outlineNodes.length > 0) {
    parts.push(`\n## 相关大纲（用于判断大纲偏离）`);
    for (const n of context.outlineNodes) {
      parts.push(`- ${n.title}${n.summary ? `：${n.summary.slice(0, 200)}` : ''}`);
    }
  }

  // 叙事事实层 — 当前世界状态（用于判断设定冲突、信息越界）
  if (context.storyFactsSummary) {
    parts.push(`\n## 📊 当前世界状态（截至本章前的活跃事实）`);
    parts.push(context.storyFactsSummary);
    parts.push(`\n请对照以上事实检查：本章是否有冲突？角色是否"知道"了不该知道的事？`);
  }

  // 角色信息边界
  if (context.knowledgeSummary) {
    parts.push(`\n## 🧠 角色信息边界（谁知道了什么）`);
    parts.push(context.knowledgeSummary);
  }

  // 待回收钩子
  if (context.hooksSummary) {
    parts.push(`\n## 🪝 待回收的叙事钩子/债务`);
    parts.push(context.hooksSummary);
    parts.push(`\n请检查：本章是否遗漏了应该推进或回收的钩子？`);
  }

  // 要审查的章节正文
  parts.push(`\n## 章节正文（审查对象）`);
  parts.push(`章节标题：${chapterTitle}`);
  // 限制 8000 字避免 token 爆表
  const trimmedContent = chapterContent.length > 8000
    ? chapterContent.slice(0, 8000) + `\n\n（正文过长，已截断至前 ${8000} 字...）`
    : chapterContent;
  parts.push(`\n${trimmedContent}`);

  return parts.join('\n');
}

// ============================================================
// 工具函数
// ============================================================

function getCategoryLabel(cat: string): string {
  const map: Record<string, string> = {
    place: '📍 地点',
    faction: '⚔️ 势力',
    race: '🧬 种族',
    law: '⚖️ 规则',
    history: '📜 历史',
    culture: '🎭 文化',
  };
  return map[cat] || `📋 ${cat}`;
}

/**
 * 从 HTML 章节内容提取纯文本（用于审稿）
 */
export function htmlToPlainText(html: string): string {
  if (!html) return '';
  return html
    .replace(/<p[^>]*>/gi, '\n')
    .replace(/<\/p>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 从纯文本提取摘要（取前 N 个字符，不含 HTML）
 */
export function extractSummary(content: string, maxChars: number = 300): string {
  const text = htmlToPlainText(content);
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '...';
}

// ============================================================
// AI 生成章节摘要 Prompt
// ============================================================

export const FACT_EXTRACTION_SYSTEM_PROMPT = `你是一位专业的小说编辑助手。你的任务是为小说章节生成摘要，同时从正文中抽取结构化的**叙事事实**（用于追踪长篇小说的世界状态，防止"忘事/乱编"）。

## 任务一：生成摘要

生成一段 100-200 字的简洁摘要，包含：
1. **核心事件**：本章发生的最重要的 1-3 个情节事件
2. **出场角色**：本章出现的主要角色及其关键行动
3. **新设定/伏笔**：本章新揭示的世界观设定、埋下的伏笔、或回收的伏笔

## 任务二：抽取叙事事实

从本章正文中提取**发生变化**的原子事实。每条事实描述一个离散的变化，存储到数据库供后续写章/审稿参考。

### 事实类型与抽取规则
1. **location**（角色位置变化）
2. **possession**（重要物品获得/失去/使用）
3. **relationship**（角色关系变化：新认识、结盟、背叛等）
4. **knowledge**（角色新得知的重要信息/秘密/真相）
5. **event**（重大事件：战斗、灾难、仪式、死亡等）
6. **emotional_state**（角色情感状态显著变化）
7. **hook**（新埋下的伏笔/悬念/后续暗示）

## 任务三：抽取角色信息边界

记录角色在本章中**新学到/知道**了什么信息。用于信息越界检测。

## 输出格式

严格返回纯 JSON 对象（不要包裹在 markdown 代码块中）：
{
  "events": "核心事件简述（1-2句话）",
  "characters": "主要角色及行动（1-2句话）",
  "newElements": "新设定/伏笔（如无则写'无'）",
  "summary": "合并后的完整摘要（100-200字）",
  "facts": [
    { "factType": "location", "subject": "角色名/物体名", "predicate": "动作", "object": "目标", "description": "完整的一句话描述" }
  ],
  "knowledge": [
    { "characterName": "角色名", "factDescription": "角色知道了什么", "source": "从哪知道的" }
  ]
}

## 注意事项
- 只记录**变化**，不记录静态状态（如"林风一直在山上"不记，只记"林风从山上下来"）
- facts 数组可以为空
- 每个事实的 description 是一句完整的话，可独立理解
- knowledge 只记录本章**新获得**的信息`;

/** @deprecated 使用 FACT_EXTRACTION_SYSTEM_PROMPT 替代（合并了摘要+事实抽取） */
export const CHAPTER_SUMMARY_SYSTEM_PROMPT = FACT_EXTRACTION_SYSTEM_PROMPT;

/**
 * 构建摘要 + 事实抽取的 user prompt
 */
export function buildSummaryUserPrompt(
  chapterTitle: string,
  chapterContent: string,
  characterNames: string[],
): string {
  const plainText = htmlToPlainText(chapterContent);
  // 为省钱只取前 12000 字（事实抽取需要更多上下文）
  const trimmedContent = plainText.length > 12000
    ? plainText.slice(0, 12000) + '\n\n（正文过长，已截断至前 12000 字）'
    : plainText;

  return `请为以下小说章节生成摘要，并抽取叙事事实：

章节标题：${chapterTitle}
${characterNames.length > 0 ? `已知角色列表：${characterNames.join('、')}` : ''}

## 章节正文
${trimmedContent}`;
}

// ============================================================
// AI 修订章节 Prompt（审稿后自动修复）
// ============================================================

export const REVISE_SYSTEM_PROMPT = `你是一位专业的小说修订者。你的任务是根据审稿发现的问题，对小说章节进行精确修复。

## 核心原则（必须遵守）
1. **只修复问题，不改其他**：只修改审稿报告中指出的问题段落，不要改写、润色或调整任何没有问题的地方
2. **保持原有文风**：保持和修订前完全一致的写作风格、叙事节奏、用词习惯
3. **保持结构不变**：段落数量、对话位置、场景转换点尽量不变，只替换有问题的部分
4. **优先修严重问题**：先修复 severity 为 "critical" 的问题，再处理 "warning"

## 修复指南
- 角色OOC：调整角色行为和对话，使其符合性格设定
- 时间线错误：修正时间标记和事件顺序
- 设定冲突：使描述符合已建立的世界观规则
- 战力崩坏：确保战斗场景中角色能力前后一致
- 节奏问题：适当增删过渡段落来调整节奏
- 文风一致：模仿原文章节的句式、用词、修辞
- AI痕迹：替换机械化的排比、列表式结构、套话

## 去 AI 痕迹修复原则（人类写作标准）

修复 AI 写作痕迹时，请遵守以下人类写作原则：

1. **删除填充短语** — 去掉"值得注意的是""在这个时间点""由于……的事实"等冗余表达
2. **打破公式结构** — 避免"不仅……而且……""从 X 到 Y""是……的体现"等模板句式
3. **变化节奏** — 混合长短句。两件事比三件事好。段落结尾要多变
4. **信任读者** — 直接陈述事实。不软化、不辩解、不解释隐喻、不说"展现了""反映了""象征着"
5. **删除金句** — 如果一句话听起来像"可引用的名言"，重写它
6. **用「是」「有」** — 把"充当""标志着""作为……的体现"改回简单的"是""有"
7. **有观点、有锋芒** — 不只是中立报道。对事件做出反应。允许一些混乱和不确定

## 输出要求
直接输出完整的修订后正文内容。使用 HTML 段落标签 <p>...</p> 包裹每个自然段。
对话使用中文引号「」或双引号""。
输出格式必须是完整的章节正文，不含任何解释说明。`;

export function buildReviseUserPrompt(
  chapterTitle: string,
  chapterContent: string,
  issues: Array<{ severity: string; description: string; location?: string; suggestion?: string; dimensionName?: string }>,
  characterContext?: string,
  worldContext?: string,
  compassContext?: string,
  styleFpContext?: string,
): string {
  const parts: string[] = [];

  parts.push(`请根据以下审稿发现的问题，对小说章节进行修订：\n`);

  // 章节信息
  parts.push(`## 待修订章节`);
  parts.push(`章节标题：${chapterTitle}\n`);

  // 上下文
  if (characterContext) {
    parts.push(`\n## 角色设定（用于修复 OOC 和台词）\n${characterContext}`);
  }
  if (worldContext) {
    parts.push(`\n## 世界观设定（用于修复设定冲突）\n${worldContext}`);
  }
  if (compassContext) {
    parts.push(`\n## 创作方向指导\n${compassContext}`);
  }
  if (styleFpContext) {
    parts.push(`\n## 目标写作风格\n${styleFpContext}`);
  }

  // 问题列表
  parts.push(`\n## 需要修复的问题`);
  // 严重问题先排
  const sorted = [...issues].sort((a, b) => {
    const order = { critical: 0, warning: 1, info: 2 };
    return (order[a.severity as keyof typeof order] ?? 2) - (order[b.severity as keyof typeof order] ?? 2);
  });
  for (const issue of sorted) {
    const sevLabel = issue.severity === 'critical' ? '🔴严重' : issue.severity === 'warning' ? '🟡警告' : '🔵建议';
    parts.push(`### ${sevLabel}${issue.dimensionName ? ` — ${issue.dimensionName}` : ''}`);
    parts.push(`问题：${issue.description}`);
    if (issue.location) parts.push(`位置：${issue.location}`);
    if (issue.suggestion) parts.push(`建议：${issue.suggestion}`);
    parts.push('');
  }

  // 章节正文
  const plainText = htmlToPlainText(chapterContent);
  parts.push(`## 章节原文（请对以下内容应用上述修复）`);
  parts.push(plainText);

  return parts.join('\n');
}

// ============================================================
// 反 AI 痕迹检测（纯前端，零 LLM 消耗）
// 参考 Humanizer-zh 24 条规则 + hi-story 原创 6 维
// ============================================================

export interface AntiAICheckResult {
  totalScore: number;
  checks: AntiAICheckItem[];
}

export interface AntiAICheckItem {
  name: string;
  passed: boolean;
  score: number;
  detail: string;
  suggestions: string[];
  /** 命中位置，方便用户逐个定位修改 */
  locations?: string[];
}

/** 检测规则定义 */
interface CheckRule {
  name: string;
  /** 触发词/正则列表 */
  triggers: (string | RegExp)[];
  replaceHint: string;
}

// ── Humanizer-zh 触发词表（汉化 + 适配中文小说场景）──

/** AI 高频词汇（规则 7） */
const AI_BUZZWORDS: CheckRule = {
  name: 'AI 高频词',
  triggers: [
    '此外', '与……保持一致', '至关重要', '深入探讨', '强调', '持久的',
    '增强', '培养', '获得', '突出', '相互作用', '复杂', '复杂性',
    '关键', '格局', '关键性的', '展示', '织锦', '证明', '宝贵的',
    '赋能', '加持', '深刻', '打造', '升华', '聚焦',
  ],
  replaceHint: '用更具体的动词或直接删除',
};

/** 过度强调意义/遗产（规则 1） */
const GRANDIOSE_CLAIMS: CheckRule = {
  name: '过度强调意义',
  triggers: [
    '标志着', '见证了', '作为……的体现', '作为……的证明', '作为……的提醒',
    '至关重要的', '关键性的作用', '关键性的时刻', '凸显了', '彰显了',
    '反映了更广泛的', '象征了', '为……做出了贡献', '为……奠定基础',
    '关键转折点', '不断演变的格局', '不可磨灭的印记', '深深植根于',
    '焦点', '强调了其重要性',
  ],
  replaceHint: '陈述具体事实而非宏大判断。把"标志着新时代的开始"改为"于1989年完工"',
};

/** 句尾虚饰分词（规则 3） */
const SENTENCE_ENDING_FLUFF: CheckRule = {
  name: '句尾虚饰',
  triggers: [
    /凸显了[^。！？]{1,20}$/m,
    /彰显了[^。！？]{1,20}$/m,
    /确保了[^。！？]{1,20}$/m,
    /反映了[^。！？]{1,20}$/m,
    /象征了[^。！？]{1,20}$/m,
    /为……做出了贡献/,
    '培养', '促进', '涵盖', '展示',
  ],
  replaceHint: '删掉句尾的虚饰分词，直接结束句子',
};

/** 广告式语言（规则 4） */
const ADVERTISING_LANGUAGE: CheckRule = {
  name: '广告式语言',
  triggers: [
    '充满活力的', '坐落于', '位于……的中心', '开创性的', '著名的',
    '令人叹为观止的', '必游之地', '迷人的', '自然之美',
    '拥有（夸张用法）', '深刻的', '丰富的', '增强其', '体现', '致力于',
  ],
  replaceHint: '用中性具体的描述替代宣传腔。把"坐落于令人叹为观止的山谷之中"改为"建在山谷里"',
};

/** 模糊归因（规则 5） */
const VAGUE_ATTRIBUTION: CheckRule = {
  name: '模糊归因',
  triggers: [
    /行业报告显示/,
    /观察者指出/,
    /专家认为/,
    /一些批评者认为/,
    /多个来源/,
    /多个出版物/,
    /据了解/,
    /据传闻/,
    /有人说/,
  ],
  replaceHint: '给出具体来源或直接删除无据归因。把"专家认为"改为具体人名和研究',
};

/** 否定式排比（规则 9） */
const NEGATION_PARALLELISM: CheckRule = {
  name: '否定式排比',
  triggers: [
    '不仅……而且……',
    '这不仅仅是……而是……',
    '不仅', '而且',
  ],
  replaceHint: '直接陈述核心，或用让步+翻转。把"这不仅是一场战斗，更是命运的转折"改为"这场战斗改变了一切"',
};

/** 三段式强制凑三（规则 10） */
const FORCED_TRIPLETS: CheckRule = {
  name: '三段式强制',
  triggers: [],
  replaceHint: '把三道连词改为两道或四道，打破整齐的节奏',
};

/** 同义词循环（规则 11） */
const SYNONYM_CYCLING: CheckRule = {
  name: '同义词循环',
  triggers: [],
  replaceHint: '同一概念用一个词说到底，不要为"去重"而换词',
};

/** 填充短语（规则 22） */
const FILLER_PHRASES: CheckRule = {
  name: '填充短语',
  triggers: [
    /为了实现这一目标/,
    /由于……的事实/,
    /在这个时间点/,
    /在……的情况下/,
    /值得注意的是/,
    /系统具有处理的能力/,
    /具有……的能力/,
  ],
  replaceHint: '直接删除或替换为简洁版。把"在这个时间点"改为"现在"',
};

/** 破折号过度（规则 13） */
const EM_DASH_OVERUSE: CheckRule = {
  name: '破折号滥用',
  triggers: [],
  replaceHint: '用句号或逗号替代破折号',
};

/** 系动词回避（规则 8） */
const COPULA_AVOIDANCE: CheckRule = {
  name: '系动词回避',
  triggers: [
    /作为[^是]{1,30}的/,
    '充当了',
    '标志着',
  ],
  replaceHint: '恢复简单的"是""有"结构。把"画廊作为LAAA的展览空间"改为"画廊是LAAA的展览空间"',
};

/** 协作交流痕迹（规则 19） */
const CHAT_ARTIFACTS: CheckRule = {
  name: '聊天机器人痕迹',
  triggers: [
    '希望这对您有帮助',
    '当然！',
    '一定！',
    '您说得完全正确',
    '您想要',
    '请告诉我',
    '这是一个',
  ],
  replaceHint: '删除聊天机器人对话痕迹。直接陈述内容',
};

/** 谄媚语气（规则 21） */
const SYCOPHANTIC_TONE: CheckRule = {
  name: '谄媚语气',
  triggers: [
    '好问题！',
    '您说得非常对',
    '这是一个很好的观点',
    '我很荣幸',
    '让我为您',
  ],
  replaceHint: '直接回应实质内容，不要过度讨好',
};

/** 过度限定（规则 23） */
const EXCESSIVE_HEDGING: CheckRule = {
  name: '过度限定',
  triggers: [
    /可以潜在地可能/,
    /可能被认为/,
    /可能会对/,
    /一定程度上/,
  ],
  replaceHint: '说清楚适用范围。把"可以潜在地可能被认为"改为"可能"',
};

/** 通用积极结论（规则 24） */
const GENERIC_POSITIVE_ENDING: CheckRule = {
  name: '通用积极结论',
  triggers: [
    /未来看起来光明/,
    /激动人心的时代即将到来/,
    /前景一片光明/,
    /未来可期/,
    /值得期待/,
    /让我们拭目以待/,
  ],
  replaceHint: '给出具体的下一步或事实结尾。把"未来看起来光明"改为具体的后续计划',
};

// ── 汇总所有检测规则 ──

const ALL_CHECK_RULES: CheckRule[] = [
  AI_BUZZWORDS,
  GRANDIOSE_CLAIMS,
  SENTENCE_ENDING_FLUFF,
  ADVERTISING_LANGUAGE,
  VAGUE_ATTRIBUTION,
  NEGATION_PARALLELISM,
  FILLER_PHRASES,
  COPULA_AVOIDANCE,
  CHAT_ARTIFACTS,
  SYCOPHANTIC_TONE,
  EXCESSIVE_HEDGING,
  GENERIC_POSITIVE_ENDING,
];

// 原来的 4 个检测项保留，但加上更多规则

/** 运行一个检测规则，返回命中位置 */
function runCheckRule(text: string, rule: CheckRule): { count: number; locations: string[] } {
  const locations: string[] = [];
  let count = 0;

  for (const trigger of rule.triggers) {
    if (typeof trigger === 'string') {
      if (trigger.includes('……')) {
        // 包含通配符的模式，转成正则
        const escaped = trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/……/g, '[^。！？]{0,30}');
        const re = new RegExp(escaped, 'g');
        const matches = text.match(re);
        if (matches) {
          count += matches.length;
          for (const m of matches.slice(0, 5)) locations.push(m);
        }
      } else if (text.includes(trigger)) {
        const hits = (text.match(new RegExp(trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
        count += hits;
        if (hits > 0 && locations.length < 10) {
          // 提取上下文
          const idx = text.indexOf(trigger);
          if (idx >= 0) {
            const ctx = text.slice(Math.max(0, idx - 10), Math.min(text.length, idx + trigger.length + 10));
            locations.push(`...${ctx}...`);
          }
        }
      }
    } else {
      // 正则
      const matches = text.match(trigger);
      if (matches) {
        count += matches.length;
        for (const m of matches.slice(0, 3)) locations.push(m.length > 40 ? m.slice(0, 40) + '...' : m);
      }
    }
  }

  return { count, locations };
}

/**
 * 运行反 AI 痕迹检测 — 纯规则引擎，秒级完成
 * 从原来 6 维扩展到 15 维，参考 Humanizer-zh
 */
export function runAntiAICheck(text: string): AntiAICheckResult {
  const plainText = text.replace(/<[^>]+>/g, '');
  const paragraphs = plainText.split('\n').filter(l => l.trim().length > 0);
  const totalChars = plainText.replace(/\s/g, '').length;
  const checkResults: AntiAICheckItem[] = [];

  // ── 1. 段落均匀度（保留原有的）──
  {
    const paraLens = paragraphs.map(p => p.length);
    if (paraLens.length >= 4) {
      const mean = paraLens.reduce((a, b) => a + b, 0) / paraLens.length;
      const variance = paraLens.reduce((sum, l) => sum + (l - mean) ** 2, 0) / paraLens.length;
      const std = Math.sqrt(variance);
      const cv = mean > 0 ? std / mean : 0;
      if (cv < 0.2) {
        checkResults.push({
          name: '段落均匀度', passed: false, score: 30,
          detail: `段落长度变异系数为 ${cv.toFixed(2)}（< 0.2 为高度可疑），平均每段 ${Math.round(mean)} 字，标准差 ${Math.round(std)} 字。真人写作段落长度通常有较大变化。`,
          suggestions: ['故意拉长或缩短某些段落', '在动作场面前插入短段落', '在描写段落中增加细节变化'],
        });
      } else if (cv < 0.35) {
        checkResults.push({
          name: '段落均匀度', passed: true, score: 70,
          detail: `段落长度变异系数为 ${cv.toFixed(2)}（0.2-0.35 之间），有轻微均匀倾向但尚可接受。`,
          suggestions: ['适当增加段落长度变化'],
        });
      } else {
        checkResults.push({
          name: '段落均匀度', passed: true, score: 95,
          detail: `段落长度变异系数为 ${cv.toFixed(2)}，变化丰富，接近真人写作。`,
          suggestions: [],
        });
      }
    } else {
      checkResults.push({
        name: '段落均匀度', passed: true, score: 80,
        detail: '段落数不足 4 个，无法可靠评估。',
        suggestions: [],
      });
    }
  }

  // ── 2. 套话密度（保留原有的，扩展词表）──
  {
    const cliches = ['似乎', '可能', '或许', '大概', '某种程度上', '某种意义上', '不得不说', '不可否认', '显然', '毫无疑问', '众所周知'];
    let totalHits = 0;
    const hits: string[] = [];
    for (const word of cliches) {
      const count = (plainText.match(new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
      totalHits += count;
      if (count > 0) hits.push(`「${word}」${count}次`);
    }
    const density = totalChars > 0 ? totalHits / (totalChars / 1000) : 0;
    if (density > 3) {
      checkResults.push({
        name: '套话密度', passed: false, score: 20,
        detail: `模糊表达密度为 ${density.toFixed(1)} 次/千字（> 3 次/千字），共 ${totalHits} 处。发现：${hits.join('，')}`,
        suggestions: ['用具体描写替代模糊词', '把"似乎"改为确切感官描述', '删掉不必要的限定词'],
      });
    } else if (density > 1.5) {
      checkResults.push({
        name: '套话密度', passed: true, score: 70,
        detail: `模糊表达密度为 ${density.toFixed(1)} 次/千字（1.5-3 之间），共 ${totalHits} 处。${hits.length > 0 ? `发现：${hits.join('，')}` : ''}`,
        suggestions: ['审视这些模糊词是否必要'],
      });
    } else {
      checkResults.push({
        name: '套话密度', passed: true, score: 95,
        detail: `模糊表达密度为 ${density.toFixed(1)} 次/千字，在健康范围内。`,
        suggestions: [],
      });
    }
  }

  // ── 3. 转折词复用（保留原有的，扩展词表）──
  {
    const transitions = ['然而', '不过', '与此同时', '另一方面', '换言之', '总之', '综上所述', '此外', '与此相对', '与此相反'];
    let totalHits = 0;
    const hits: string[] = [];
    for (const word of transitions) {
      const count = (plainText.match(new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
      totalHits += count;
      if (count >= 3) hits.push(`「${word}」${count}次`);
    }
    if (totalHits >= 6) {
      checkResults.push({
        name: '转折词复用', passed: false, score: 25,
        detail: `转折词使用 ${totalHits} 次（≥ 6 次），过于频繁。${hits.length > 0 ? `高频词：${hits.join('，')}` : ''}`,
        suggestions: ['减半转折词使用', '用情节铺陈代替"然而"', '让读者自己发现转折'],
      });
    } else if (totalHits >= 4) {
      checkResults.push({
        name: '转折词复用', passed: true, score: 70,
        detail: `转折词使用 ${totalHits} 次（4-5 次），略多但可接受。`,
        suggestions: ['适当减少转折词'],
      });
    } else {
      checkResults.push({
        name: '转折词复用', passed: true, score: 95,
        detail: `转折词使用 ${totalHits} 次，在合理范围内。`,
        suggestions: [],
      });
    }
  }

  // ── 4. 列表式结构（保留原有的）──
  {
    let consecutiveLists = 0;
    let maxConsecutive = 0;
    const listPattern = /^[\d一二三四五六七八九十]+[、.．)）]|^[·•●\-—]/;
    for (const para of paragraphs) {
      if (listPattern.test(para.trim())) {
        consecutiveLists++;
        if (consecutiveLists > maxConsecutive) maxConsecutive = consecutiveLists;
      } else {
        consecutiveLists = 0;
      }
    }
    if (maxConsecutive >= 4) {
      checkResults.push({
        name: '列表式结构', passed: false, score: 20,
        detail: `连续 ${maxConsecutive} 段使用序号/列表结构（≥ 4 段），这是典型的 AI 写作特征。`,
        suggestions: ['打破列表结构，用叙事段落替代', '把信息揉进对话或场景描写中'],
      });
    } else if (maxConsecutive >= 3) {
      checkResults.push({
        name: '列表式结构', passed: true, score: 65,
        detail: `连续 ${maxConsecutive} 段使用列表结构（3 段），有 AI 痕迹倾向。`,
        suggestions: ['考虑用叙述段落替代部分列表'],
      });
    } else {
      checkResults.push({
        name: '列表式结构', passed: true, score: 95,
        detail: `未检测到连续列表式结构。`,
        suggestions: [],
      });
    }
  }

  // ── 5. 总结性套话（保留原有的）──
  {
    const summaryWords = ['综上所述', '总而言之', '总的说来', '如上所述', '一言以蔽之'];
    const hits: string[] = [];
    for (const word of summaryWords) {
      if (plainText.includes(word)) hits.push(`「${word}」`);
    }
    if (hits.length > 0) {
      checkResults.push({
        name: '总结性套话', passed: false, score: 30,
        detail: `发现 ${hits.length} 处总结性套话：${hits.join('，')}。这些词在小说中很不自然。`,
        suggestions: ['直接删除这些总结语', '让读者自己从叙事中得出结论'],
      });
    } else {
      checkResults.push({
        name: '总结性套话', passed: true, score: 100,
        detail: '未检测到总结性套话。',
        suggestions: [],
      });
    }
  }

  // ── 6. 元叙事检测（保留原有的）──
  {
    const metaWords = ['值得一提的是', '在这个世界里', '我们都知道', '正如前文所述', '读者可能注意到'];
    const hits: string[] = [];
    for (const word of metaWords) {
      if (plainText.includes(word)) hits.push(`「${word}」`);
    }
    if (hits.length > 0) {
      checkResults.push({
        name: '元叙事', passed: false, score: 20,
        detail: `发现 ${hits.length} 处元叙事（打破第四面墙/作者直接对读者说话）：${hits.join('，')}。`,
        suggestions: ['删除所有作者旁白', '用角色的视角展示信息', '保持叙事视角一致'],
      });
    } else {
      checkResults.push({
        name: '元叙事', passed: true, score: 100,
        detail: '未检测到元叙事。',
        suggestions: [],
      });
    }
  }

  // ── 以下为新增的 Humanizer-zh 检测规则（7-15）──

  // 7-15: 运行 Humanizer-zh 的触发词规则
  for (const rule of ALL_CHECK_RULES) {
    const { count, locations } = runCheckRule(plainText, rule);
    const density = totalChars > 0 ? count / (totalChars / 1000) : 0;

    if (count === 0) {
      checkResults.push({
        name: rule.name, passed: true, score: 100,
        detail: `未检测到${rule.name}。`,
        suggestions: [],
      });
    } else if (count <= 2) {
      checkResults.push({
        name: rule.name, passed: true, score: 70,
        detail: `发现 ${count} 处${rule.name}${locations.length > 0 ? '：' + locations.slice(0, 3).join(' | ') : ''}。少量出现，问题不大。`,
        suggestions: [rule.replaceHint],
        locations: locations.slice(0, 5),
      });
    } else {
      checkResults.push({
        name: rule.name, passed: false, score: count >= 5 ? 20 : 40,
        detail: `发现 ${count} 处${rule.name}（${density.toFixed(1)} 次/千字）${locations.length > 0 ? '。示例：' + locations.slice(0, 3).join(' | ') : ''}。`,
        suggestions: [rule.replaceHint],
        locations: locations.slice(0, 10),
      });
    }
  }

  // ── 破折号滥用（规则 13，特殊处理：数破折号数量）──
  {
    const emDashCount = (plainText.match(/—/g) || []).length;
    const density = totalChars > 0 ? emDashCount / (totalChars / 1000) : 0;
    if (emDashCount >= 8) {
      checkResults.push({
        name: '破折号滥用', passed: false, score: 25,
        detail: `发现 ${emDashCount} 处破折号（≥ 8 处，${density.toFixed(1)} 次/千字）。LLM 使用破折号比人类频繁得多。`,
        suggestions: ['用句号或逗号替代多余破折号', '每 3000 字不超过 3 个破折号'],
      });
    } else if (emDashCount >= 5) {
      checkResults.push({
        name: '破折号滥用', passed: true, score: 70,
        detail: `发现 ${emDashCount} 处破折号（${density.toFixed(1)} 次/千字），略多但可接受。`,
        suggestions: ['审视这些破折号是否都可以替换为句号'],
      });
    } else {
      checkResults.push({
        name: '破折号滥用', passed: true, score: 95,
        detail: `发现 ${emDashCount} 处破折号，在合理范围内。`,
        suggestions: [],
      });
    }
  }

  // ── 三段式强制（规则 10，特殊处理：检测"X、Y和Z"或"X、Y、Z三"模式）──
  {
    const tripletPattern = /[^、，。！？\n]{2,}、[^、，。！？\n]{2,}和[^、，。！？\n]{2,}/g;
    const triplets = plainText.match(tripletPattern) || [];
    const tripletCount = triplets.length;
    if (tripletCount >= 4) {
      checkResults.push({
        name: '三段式强制', passed: false, score: 30,
        detail: `发现 ${tripletCount} 处三段式列举（≥ 4 处）。AI 倾向于强行凑三以显得"全面"。示例：${triplets.slice(0, 3).join(' | ')}`,
        suggestions: ['把三件事拆成两件，或让一段只讲一件事', '不需要在每处都凑满三项'],
        locations: triplets.slice(0, 5),
      });
    } else if (tripletCount >= 2) {
      checkResults.push({
        name: '三段式强制', passed: true, score: 70,
        detail: `发现 ${tripletCount} 处三段式列举，可接受但建议审视。`,
        suggestions: ['看看是否每个三段式都有必要'],
      });
    } else {
      checkResults.push({
        name: '三段式强制', passed: true, score: 95,
        detail: '未检测到过量的三段式列举。',
        suggestions: [],
      });
    }
  }

  // ── 同义词循环（规则 11，特殊处理：检测段落内同一实体多个不同称呼）──
  {
    // 简单检测：同一段内出现"他""其""此人""该角色"等连续指代同一个人
    const synonymCycleCount = (plainText.match(/(他|其|此人|该角色|该人物|这位.{1,3})([^。]{0,5}(他|其|此人|该角色))/g) || []).length;
    // 更实用的检测：看有没有用 3+ 个不同词指代同一概念（依赖同义词库匹配）
    // 这里采用简化版：检查连续段落中是否出现同一名字的多种指代变化
    let cyclingScore = 0;
    for (const para of paragraphs.slice(0, -2)) {
      const nextPara = paragraphs[paragraphs.indexOf(para) + 1] || '';
      // 如果上一段用"主角名"，下一段用"他"，再下段用"少年"，这是正常的
      // 真正的问题是同一段内刻意换词
      const uniqueNouns = new Set((para.match(/[一-鿿]{2,4}/g) || []).filter(w => w.length === 2 || w.length === 3));
      if (uniqueNouns.size > 15 && para.length < 500) {
        cyclingScore++;
      }
    }
    if (cyclingScore >= 5) {
      checkResults.push({
        name: '同义词循环', passed: false, score: 40,
        detail: `检测到 ${cyclingScore} 处可能刻意换词（段落内名词种类过多）。AI 为避免重复而过度使用同义词。`,
        suggestions: ['同一概念用一个词说到底', '不要像写学术论文那样刻意"去重"'],
      });
    } else if (cyclingScore >= 2) {
      checkResults.push({
        name: '同义词循环', passed: true, score: 75,
        detail: `发现 ${cyclingScore} 处可疑的词汇替换，程度较轻。`,
        suggestions: ['审视是否有不必要的同义词替换'],
      });
    } else {
      checkResults.push({
        name: '同义词循环', passed: true, score: 95,
        detail: '未检测到明显的同义词循环。',
        suggestions: [],
      });
    }
  }

  // 计算总分
  const totalScore = Math.round(
    checkResults.reduce((sum, c) => sum + c.score, 0) / Math.max(1, checkResults.length),
  );

  return { totalScore, checks: checkResults };
}

// ============================================================
// AI 去 AI 味润色 Prompt（保留原意 + 主动打磨文笔 + 去 AI 痕）
// ============================================================

export const POLISH_SYSTEM_PROMPT = `你是一位文笔精湛的中文小说编辑，擅长把平淡、生硬、啰嗦的文字打磨得流畅、生动、有感染力。

## 核心任务
对给定的小说文字做**真正的文笔润色**——让每一句话都更精准、更生动、更有画面感，同时去除 AI 写作痕迹。**这是改写提升，不是删减。**

## 三条铁律（必须遵守）
1. **忠实原意**：不增删任何情节、事件、信息；不改变角色性格、行为动机、对话的含义；不引入原文没有的新设定或新细节。
2. **大胆润色**：不要只删字。要主动改写——把平淡的句子写生动、把笼统的写具体、把啰嗦的写凝练、把生硬的写流畅。每一句话都值得你重新斟酌用词、调整语序、打磨节奏。
3. **保持文风**：润色后的文字必须与原文整体的风格、叙事视角、用词习惯一致，让人感觉是同一个人写的，而不是换了一篇文章。

## 润色要做什么（提升方向）

- **化抽象为具体**：把「他感到愤怒」这类笼统表达，改成有动作、有神态、有细节的画面（如「他攥紧了拳头，指节发白」）。让读者「看到」而不是「被告知」。
- **精准用词**：找到最贴切的动词、形容词，替换平庸的词。避免「很」「非常」「有些」这类弱化词。
- **改善语感节奏**：长短句错落，避免一长串结构相同的句子。段落内部有起有伏。
- **强化画面感与代入感**：调动感官（视觉、听觉、触觉、气味），让场景更鲜活。
- **让对话更鲜活**：对话符合角色性格，有语气、有停顿、有潜台词，避免千人一面的书面腔。
- **消除赘余与重复**：删掉重复的词、多余的修饰、绕圈子的表达，让句子更干净有力。
- **破 AI 腔**：打破模板句式、机械排比、总结腔，让文字像人写的，有锋芒、有温度。

## 去 AI 痕迹润色原则（人类写作标准）

1. **删除填充短语** — 去掉"值得注意的是""在这个时间点""由于……的事实"等冗余表达
2. **打破公式结构** — 避免"不仅……而且……""从 X 到 Y""是……的体现""标志着""见证了"等模板句式
3. **变化节奏** — 混合长短句。两件事比三件事好。段落结尾要多变
4. **信任读者** — 直接陈述事实。不软化、不辩解、不解释隐喻、不说"展现了""反映了""象征着"
5. **删除金句** — 如果一句话听起来像"可引用的名言"，重写它
6. **用「是」「有」** — 把"充当""标志着""作为……的体现"改回简单的"是""有"
7. **有锋芒、有温度** — 不只是中立报道。对事件做出反应，允许一些混乱和不确定

### 质感层规则（润色时也要规避）

词表只能抓表面，润色后如果还残留以下质感问题，读者照样能感觉出 AI 味：

- **情绪贴标签**：原文若写了「他很愤怒」，改成「他攥紧拳头，指节发白」这种身体反应，别保留抽象的情绪标签
- **明喻套句**：「如同……一般」「宛如……似的」「仿佛……一样」出现多次，就换成精准动词或白描
- **四字成语堆砌**：一段里挤多个成语充当描写，改成具体动作或画面
- **对话同质化**：润色时保持每个角色的语气差异，别把所有人的话都改成规整书面腔
- **解释动机**：删掉「他这么说是因为……」这类叙述者替读者总结的句子
- **强行升华**：章末如果拔高成人生感悟或金句，改回停在具体画面、选择或情绪余波上

## 禁用词汇（润色后正文不得出现）
「标志着」「见证了」「充当」「作为……的体现/证明/提醒」「至关重要的」「关键性的」「不可磨灭的」「不断演变的格局」「充满活力的」「坐落于」「开创性的」「令人叹为观止的」「迷人的」「此外」「与……保持一致」「深入探讨」「赋能」「加持」「不仅……而且……」「这不仅仅是……而是……」「在这个时间点」「值得注意的是」「由于……的事实」

## 内容安全红线（必须遵守，确保通过平台审核）

润色后正文必须符合网文平台审核标准，以下规则是硬性要求：

### 绝对禁止（润色后一个字都不能出现）
- 不保留或新增任何性行为过程、性器官、体液、性反应的描写
- 不保留或新增性暗示隐喻/代号（「注入」「抽送」「玫瑰素」等以物喻性写法）
- 不保留或新增暧昧亲昵的擦边动作：不写「舔舐」「吮吸」「舔吻」「舌吻」等舌头接触身体的描写；不写「舌尖」「舌头」的暧昧动作细节（如「舔舐脖颈」「猩红舌尖卷走血迹」「吮吸手指」都越界）；不写用嘴/舌头接触液体（血、汗、酒等）的暧昧描写
- 不保留或新增敏感部位（脖颈、耳垂、锁骨、腰窝等）的舔吻、啃咬、摩挲特写

### 原文含擦边内容时怎么办（关键）
- 如果原文里已经写了「舔舐」「吮吸」「舌尖」这类擦边动作，**润色时必须把它改写掉**——改成含蓄留白的表达，不能原样保留，更不能润色得更露骨
- 擦边动作改写为：拥抱、牵手、亲吻（仅唇轻触）、情感与心理描写、环境烘托
- 亲吻只写唇与唇的轻触，不写舌头、舔舐、吮吸

### 自查标准
润色完成后自问：交给最严格的网文平台审核会不会被判低俗？只要有疑虑，就改写得更含蓄、更留白。宁可删掉一个暧昧动作，也不留下越界风险。

## 输出要求
直接输出润色后的完整正文。使用 HTML 段落标签 <p>...</p> 包裹每个自然段。
对话使用中文引号「」或双引号""。
输出必须是完整正文，不含任何解释、说明或前后缀。`;

export interface PolishContext {
  projectName: string;
  typeTags: string[];
  characters: Array<{ name: string; aliases: string; personality: string; background: string }>;
  worldEntries: Array<{ name: string; description: string }>;
  compassContext?: string;
  styleFpContext?: string;
}

/**
 * 构建润色 user prompt
 */
export function buildPolishUserPrompt(
  targetText: string,
  context: PolishContext,
): string {
  const parts: string[] = [];

  parts.push(`请对以下小说文字做文笔润色：让表达更流畅、生动、有画面感，同时去除 AI 痕迹。注意——这是改写提升，不是简单删减。\n`);

  // 项目信息
  parts.push(`## 项目信息`);
  parts.push(`书名：${context.projectName}`);
  if (context.typeTags.length > 0) parts.push(`类型：${context.typeTags.join(' / ')}`);

  // 角色设定（用于保持对话口吻一致）
  if (context.characters.length > 0) {
    parts.push(`\n## 角色设定（用于保持角色口吻与用词一致）`);
    for (const ch of context.characters) {
      const info: string[] = [];
      if (ch.personality) info.push(`性格：${ch.personality}`);
      if (ch.background) info.push(`背景：${ch.background.slice(0, 200)}`);
      parts.push(`- ${ch.name}${ch.aliases ? `（${ch.aliases}）` : ''}${info.length > 0 ? `：${info.join('；')}` : ''}`);
    }
  }

  // 世界观
  if (context.worldEntries.length > 0) {
    parts.push(`\n## 世界观设定（用于保持名词与设定一致）`);
    for (const w of context.worldEntries) {
      parts.push(`- ${w.name}：${w.description.slice(0, 300)}`);
    }
  }

  // 创作方向 + 风格指纹
  if (context.compassContext) {
    parts.push(`\n## 创作方向指导\n${context.compassContext}`);
  }
  if (context.styleFpContext) {
    parts.push(`\n## 目标写作风格\n${context.styleFpContext}`);
  }

  // 待润色原文
  const plainText = htmlToPlainText(targetText);
  parts.push(`\n## 待润色原文`);
  parts.push(plainText);

  parts.push(`\n## 再次提醒`);
  parts.push(`这是文笔润色，请大胆改写提升——让句子更精准、生动、有画面感，不要只做删减。但不得增删情节、事件、信息，不得改变角色行为与对话含义。直接输出润色后的完整正文（HTML <p> 包裹）。`);

  return parts.join('\n');
}

// ============================================================
// 全书级句式 tic 统计（纯正则，零 LLM 消耗）
// 参考 voocel/ainovel-cli 的 stylestat 设计
// 解决单章反 AI 检测的盲区：单章看每处都"正常"的句式，全书章均几十次就是病
// ============================================================

export interface PatternStat {
  /** 句式模式名 */
  name: string;
  /** 全书总次数 */
  total: number;
  /** 章均次数 */
  perChapter: number;
}

export interface PhraseStat {
  /** 高频短语 */
  text: string;
  /** 出现次数 */
  count: number;
}

export interface SentenceStat {
  /** 跨章重复句 */
  text: string;
  /** 出现的章数 */
  chapters: number;
  /** 总次数 */
  count: number;
}

export interface StyleStatsResult {
  /** 统计的章数 */
  chapters: number;
  /** 固定句式模式计数 */
  patterns: PatternStat[];
  /** 最近 N 章高频短语（口头禅镜像） */
  topPhrases: PhraseStat[];
  /** 跨章逐字重复句 */
  repeatedSentences: SentenceStat[];
  /** 章末短句收尾占比 */
  endingShortRatio: number;
  /** 开篇时间词率 */
  openingTimeRate: number;
  /** 标题「第N章」前缀混用情况 */
  titleFormatMixed: { withPrefix: number; withoutPrefix: number } | null;
}

/** 通用 AI 文风句式模式（正则近似，用于全书纵向基线对比） */
const PATTERN_DEFS: Array<{ name: string; re: RegExp }> = [
  { name: '矫正句「不是…(而)是…」', re: /不是[^。！？\n]{1,24}?[，、]?(?:而)?是/g },
  { name: '计时量词「X息/X瞬」', re: /[一两二三四五六七八九十几数半][息瞬]/g },
  { name: '明喻「像一/仿佛/如同/宛如」', re: /像一|仿佛|如同|宛如/g },
  { name: '沉默节拍「沉默了/没有说话/没有回头」', re: /沉默了|没有说话|没有回头/g },
  { name: '神态模板「眼中闪过/嘴角勾起/咬了咬唇」', re: /眼[中底]闪过|目光一凝|瞳孔一缩|眼眶微红|嘴角[微轻一]?[勾扬翘]|咬了咬唇|不可置信/g },
  { name: '躯体反应「心头一紧/身子一颤/倒吸凉气」', re: /心头一[紧沉颤]|身子一[颤震僵]|倒吸(?:了)?一口凉气/g },
  { name: '思维标记「心想/意识到/感到/觉得」', re: /心想|意识到|感到|觉得/g },
  { name: '抽象套话「一种说不出的/的意义在于」', re: /一种说不出的|说不清[的道]|的意义在于|真正的[^。！？\n]{1,10}是/g },
];

const MIN_CHAPTERS = 5;      // 少于此章数不统计，样本太小频率无意义
const PHRASE_WINDOW = 20;    // 高频短语只看最近 20 章
const SHORT_ENDING_RUNES = 30; // 章末行 ≤ 30 字计为「短结尾」

/** 首尾虚词/代词，n-gram 以这些字开头/结尾的不是文风短语 */
const GRAM_EDGE_STOP = '的了着是在和与就也都还又把被他她它我你这那';

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function isHan(r: string): boolean {
  return r >= '一' && r <= '鿿';
}

/** 剥离引号：同一句台词带/不带引号不应算两条 */
function trimWrappedQuotes(s: string): string {
  return s.replace(/^[""''「」『』]+/, '').replace(/[""''「」『』]+$/, '').trim();
}

function chapterSentenceCounts(text: string): Map<string, number> {
  const map = new Map<string, number>();
  const sentences = text.split(/[。！？\n]+/);
  for (const raw of sentences) {
    const sent = trimWrappedQuotes(raw.trim());
    if (sent.length < 12) continue;
    map.set(sent, (map.get(sent) || 0) + 1);
  }
  return map;
}

function validGram(gram: string): boolean {
  for (const r of gram) {
    if (!isHan(r)) return false;
  }
  if (GRAM_EDGE_STOP.includes(gram[0]) || GRAM_EDGE_STOP.includes(gram[gram.length - 1])) return false;
  return true;
}

/** 专有名词（人名）拆成 2 字片段，用于过滤掉人名混进口头禅清单 */
function stopwordBigrams(stopwords: string[]): string[] {
  const grams: string[] = [];
  for (const w of stopwords) {
    const runes = [...w.trim()];
    if (runes.length < 2) continue;
    for (let i = 0; i + 2 <= runes.length; i++) {
      grams.push(runes.slice(i, i + 2).join(''));
    }
  }
  return grams;
}

/** 在窗口内挖掘 3-6 字高频短语 */
function minePhrases(chapters: string[], stopwords: string[]): PhraseStat[] {
  const text = chapters.join('\n');
  const runes = [...text];
  const threshold = Math.max(8, Math.floor(chapters.length / 2));
  const stopGrams = stopwordBigrams(stopwords);

  const counts = new Map<string, number>();
  for (let size = 3; size <= 6; size++) {
    for (let i = 0; i + size <= runes.length; i++) {
      const gram = runes.slice(i, i + size).join('');
      if (!validGram(gram)) continue;
      counts.set(gram, (counts.get(gram) || 0) + 1);
    }
  }

  const hitStopword = (gram: string) => stopGrams.some(g => gram.includes(g));

  const cands: Array<{ text: string; count: number }> = [];
  for (const [g, c] of counts) {
    if (c < threshold || hitStopword(g)) continue;
    cands.push({ text: g, count: c });
  }
  cands.sort((a, b) => (b.count - a.count) || (b.text.length - a.text.length) || a.text.localeCompare(b.text));

  const out: PhraseStat[] = [];
  for (const c of cands) {
    if (out.length >= 8) break;
    const dup = out.some(p => p.text.includes(c.text) || c.text.includes(p.text));
    if (!dup) out.push({ text: c.text, count: c.count });
  }
  return out;
}

/** 跨 ≥3 章逐字重复的 ≥12 字句子 */
function repeatedSentences(chapters: string[]): SentenceStat[] {
  const seen = new Map<string, { count: number; chapters: Set<number> }>();
  chapters.forEach((text, ci) => {
    for (const [sent, count] of chapterSentenceCounts(text)) {
      let rec = seen.get(sent);
      if (!rec) { rec = { count: 0, chapters: new Set() }; seen.set(sent, rec); }
      rec.count += count;
      rec.chapters.add(ci);
    }
  });

  const out: SentenceStat[] = [];
  for (const [sent, rec] of seen) {
    if (rec.chapters.size < 3) continue;
    const text = sent.length > 40 ? sent.slice(0, 40) + '…' : sent;
    out.push({ text, chapters: rec.chapters.size, count: rec.count });
  }
  out.sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));
  return out.slice(0, 5);
}

function lastNonEmptyLine(text: string): string {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line) return line;
  }
  return '';
}

function firstParagraph(text: string): string {
  for (const line of text.split('\n')) {
    const l = line.trim();
    if (!l || l.startsWith('#')) continue;
    return l;
  }
  return '';
}

/**
 * 计算全书级句式 tic 统计。所有结果都是事实计数，不含裁定。
 * 章数 < 5 时返回 null（样本太小无意义）。
 */
export function runStyleStats(
  chapters: string[],
  opts?: { stopwords?: string[]; titles?: string[] },
): StyleStatsResult | null {
  const n = chapters.length;
  if (n < MIN_CHAPTERS) return null;

  const all = chapters.join('\n');

  // 1. 固定句式模式
  const patterns: PatternStat[] = [];
  for (const def of PATTERN_DEFS) {
    const total = (all.match(def.re) || []).length;
    if (total === 0) continue;
    patterns.push({ name: def.name, total, perChapter: round1(total / n) });
  }
  patterns.sort((a, b) => b.perChapter - a.perChapter);

  // 2. 高频短语
  const window = n <= PHRASE_WINDOW ? chapters : chapters.slice(n - PHRASE_WINDOW);
  const topPhrases = minePhrases(window, opts?.stopwords ?? []);

  // 3. 跨章重复句
  const repeatedSentencesList = repeatedSentences(chapters);

  // 4. 章末短句收尾占比
  let shortCount = 0;
  let measured = 0;
  for (const text of chapters) {
    const line = lastNonEmptyLine(text);
    if (!line) continue;
    measured++;
    if ([...line].length <= SHORT_ENDING_RUNES) shortCount++;
  }
  const endingShortRatio = measured > 0 ? round2(shortCount / measured) : 0;

  // 5. 开篇时间词率
  const openingTimeRe = /夜|清晨|黎明|天亮|醒来|晨光|一整夜/;
  let openingHit = 0;
  for (const text of chapters) {
    if (openingTimeRe.test(firstParagraph(text))) openingHit++;
  }
  const openingTimeRate = round2(openingHit / n);

  // 6. 标题「第N章」前缀混用
  const titles = opts?.titles ?? [];
  let titleFormatMixed: { withPrefix: number; withoutPrefix: number } | null = null;
  if (titles.length > 0) {
    const prefixRe = /^#{0,2}\s*第[零〇一二三四五六七八九十百千万\d]+章/;
    let withPrefix = 0, withoutPrefix = 0;
    for (const t of titles) {
      if (!t.trim()) continue;
      if (prefixRe.test(t)) withPrefix++; else withoutPrefix++;
    }
    if (withPrefix > 0 && withoutPrefix > 0) titleFormatMixed = { withPrefix, withoutPrefix };
  }

  return {
    chapters: n,
    patterns,
    topPhrases,
    repeatedSentences: repeatedSentencesList,
    endingShortRatio,
    openingTimeRate,
    titleFormatMixed,
  };
}
