import { getCategoryLabel } from './utils';
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
