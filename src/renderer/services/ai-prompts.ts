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

## 写作禁忌
- 不要使用"在这个世界里"、"值得一提的是"等元叙事
- 不要写"如上所述"、"总而言之"等总结性套话
- 避免模糊表达：似乎、可能、或许、大概、某种程度上
- 每个段落长度应有变化，不要过于均匀`;

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
    parts.push(`（最近 ${context.recentChapters.length} 章的内容摘要，作为衔接参考）`);
    for (const ch of context.recentChapters.slice(-2)) {
      parts.push(`- 【${ch.title}】${ch.summary.slice(0, 300)}`);
    }
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
- 如果某个维度没有任何问题，score 给 90 以上，passed 为 true`;

export interface ReviewContext {
  projectName: string;
  typeTags: string[];
  characters: Array<{ name: string; aliases: string; personality: string; background: string; arc: string }>;
  worldEntries: Array<{ name: string; description: string }>;
  outlineNodes: Array<{ title: string; summary: string }>;
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
// 反 AI 痕迹检测（纯前端，零 LLM 消耗）
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
}

/**
 * 运行反 AI 痕迹检测 — 纯规则引擎，秒级完成
 */
export function runAntiAICheck(text: string): AntiAICheckResult {
  const plainText = text.replace(/<[^>]+>/g, '');
  const paragraphs = plainText.split('\n').filter(l => l.trim().length > 0);
  const totalChars = plainText.replace(/\s/g, '').length;
  const checkResults: AntiAICheckItem[] = [];

  // ── 1. 段落均匀度（AI 检测最经典的指标）──
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

  // ── 2. 套话密度 ──
  {
    const cliches = ['似乎', '可能', '或许', '大概', '某种程度上', '某种意义上', '不得不说', '不可否认'];
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

  // ── 3. 转折词复用 ──
  {
    const transitions = ['然而', '不过', '与此同时', '另一方面', '与此同时', '换言之', '总之', '综上所述'];
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

  // ── 4. 列表式结构 ──
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

  // ── 5. 总结性套话 ──
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

  // ── 6. 元叙事检测 ──
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

  // 计算总分
  const totalScore = Math.round(
    checkResults.reduce((sum, c) => sum + c.score, 0) / Math.max(1, checkResults.length),
  );

  return { totalScore, checks: checkResults };
}
