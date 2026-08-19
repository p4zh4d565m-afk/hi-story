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
