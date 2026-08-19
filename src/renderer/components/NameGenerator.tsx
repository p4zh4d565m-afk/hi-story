import React, { useState, useEffect, useCallback, useRef } from 'react';
import { aiService } from '../services/ai.service';
import { decryptConfigs } from '../services/crypto';
import { generateCharacterNames, generateFactionNames, generateLocationNames, generateItemNames, generateTechniqueNames, generateCreatureNames } from '../services/name-generator';

// ═══════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════

type Category = 'character' | 'location' | 'faction' | 'equipment' | 'technique' | 'monster';
type Style = 'chinese' | 'western' | 'japanese';
type Gender = 'male' | 'female';
type Era = 'ancient' | 'modern';

const CATEGORIES: { key: Category; label: string; icon: string }[] = [
  { key: 'character', label: '人物', icon: '👤' },
  { key: 'location', label: '地点', icon: '📍' },
  { key: 'faction', label: '势力', icon: '⚔️' },
  { key: 'equipment', label: '装备', icon: '🗡️' },
  { key: 'technique', label: '功法', icon: '📜' },
  { key: 'monster', label: '怪兽', icon: '👹' },
];

const STYLES: { key: Style; label: string }[] = [
  { key: 'chinese', label: '中式' },
  { key: 'western', label: '西式' },
  { key: 'japanese', label: '日式' },
];

const CATEGORY_STYLES: Record<Category, Style[]> = {
  character: ['chinese', 'western', 'japanese'],
  location: ['chinese', 'western'],
  faction: ['chinese', 'western'],
  equipment: ['chinese', 'western'],
  technique: ['chinese', 'western'],
  monster: ['chinese', 'western'],
};

// ═══════════════════════════════════════════════════
// Provider 预设（与 AIChatPanel 同步）
// ═══════════════════════════════════════════════════

interface ProviderPreset {
  id: string;
  name: string;
  type: 'claude' | 'openai-compatible';
  baseUrl: string;
  defaultModel: string;
}

const PROVIDERS: ProviderPreset[] = [
  { id: 'claude', name: 'claude', type: 'claude', baseUrl: 'https://api.anthropic.com', defaultModel: 'claude-sonnet-4-6' },
  { id: 'openai', name: 'openai', type: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o' },
  { id: 'deepseek', name: 'deepseek', type: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat' },
  { id: 'doubao', name: 'doubao', type: 'openai-compatible', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', defaultModel: 'doubao-seed-evolving' },
  { id: 'volcengine', name: 'volcengine', type: 'openai-compatible', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', defaultModel: 'doubao-seed-evolving' },
  { id: 'qwen', name: 'qwen', type: 'openai-compatible', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultModel: 'qwen-plus' },
  { id: 'zhipu', name: 'zhipu', type: 'openai-compatible', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', defaultModel: 'glm-4-flash' },
  { id: 'moonshot', name: 'moonshot', type: 'openai-compatible', baseUrl: 'https://api.moonshot.cn/v1', defaultModel: 'moonshot-v1-8k' },
];

// ═══════════════════════════════════════════════════
// 内置离线名字库（AI 不可用时的兜底）
// ═══════════════════════════════════════════════════

const BUILTIN_NAMES: Record<string, string[]> = {
  // ── 人物：中式 ──
  'character_chinese_female': [
    '柳如烟', '林清婉', '沈落雁', '叶知秋', '苏慕雪',
    '慕容嫣然', '上官婉儿', '楚云裳', '萧若兰', '凌霜华',
    '云锦绣', '凤清歌', '洛晴雪', '花无眠', '白露凝',
    '兰若溪', '蝶衣', '月浅吟', '梅疏影', '水清遥',
    '秦羽霓', '顾盼兮', '温采薇', '姜雪凝', '谢道韫',
    '唐琬', '赵飞燕', '卓文君', '卫子夫', '班昭',
  ],
  'character_chinese_male': [
    '楚天阔', '萧剑寒', '叶凌云', '慕容飞雪', '顾长歌',
    '风清扬', '花无缺', '铁中棠', '云中鹤', '石破天',
    '令狐逸', '柳长空', '沈墨白', '宁远山', '江逐浪',
    '龙战野', '燕归巢', '任平生', '独孤信', '向天歌',
    '苏星河', '段天涯', '萧一舟', '东方朔', '韩江雪',
    '卫青阳', '霍去病', '李广陵', '苏武兴', '班超远',
  ],
  // ── 人物：西式 ──
  'character_western_female': [
    '艾琳诺', '瑟薇娅', '伊莎贝拉', '奥莉薇娅', '维多利亚',
    '克莱尔', '菲奥娜', '雅典娜', '海伦', '达芙妮',
    '索菲亚', '露娜', '艾瑞丝', '卡珊德拉', '奥萝拉',
    '莉迪亚', '塞勒涅', '莫妮卡', '凯瑟琳', '罗莎琳',
  ],
  'character_western_male': [
    '克里斯托弗', '亚历山大', '威廉姆斯', '尼古拉斯', '塞巴斯蒂安',
    '唐纳德', '埃德蒙', '罗兰', '亚瑟', '雷奥纳德',
    '奥古斯都', '凯撒', '菲尼克斯', '加雷斯', '索尔',
    '雷金纳德', '阿尔弗雷德', '西奥多', '阿基米德', '尤利西斯',
  ],
  // ── 人物：日式 ──
  'character_japanese_female': [
    '樱庭雪', '神代花音', '清水铃音', '朝仓千代', '星野花子',
    '月岛薰', '白鸟舞', '橘真由美', '森山绫', '佐藤樱',
    '高桥枫', '铃木春', '渡边琴', '田中葵', '伊藤梅',
    '山本菊', '中村兰', '山口百合', '松本奈奈', '井上菜月',
  ],
  'character_japanese_male': [
    '龙之介', '信长', '秀吉', '半藏', '武藏',
    '谦信', '幸村', '小次郎', '十兵卫', '左近',
    '高桥莲', '佐藤翔', '铃木隼', '田中俊', '渡边晃',
    '伊藤诚', '山本飒', '中村葵', '山口悠', '松本大辉',
  ],
  // ── 地点 ──
  'location_chinese_ancient': [
    '飞花客栈', '龙泉山庄', '太初天宫', '碧落洞府', '烟雨楼',
    '青云峰', '紫霞仙谷', '断魂崖', '听涛阁', '绝情谷',
    '桃花源', '蓬莱仙岛', '昆仑虚', '蜀山剑阁', '幽兰谷',
    '星月湖', '落霞峰', '离火殿', '玄武城', '龙渊阁',
    '藏剑山庄', '碧水寒潭', '万花谷', '天机府', '雷音寺',
  ],
  'location_chinese_modern': [
    '凌云大厦', '星海广场', '风华街', '锦绣科技园', '翠微路',
    '梧桐巷', '天汇城', '碧波新城', '云栖小镇', '龙腾大道',
    '晨曦花园', '翡翠湾', '未来科技城', '明珠港', '清风雅苑',
  ],
  'location_western_ancient': [
    '诺森宫殿', '幻海湿地', '幽暗密林', '寂静丘陵', '焰流峡谷',
    '银月堡', '霜语平原', '暮光之桥', '亡灵古道', '深岩遗迹',
    '灰烬王座', '寒霜峰', '黑曜石塔', '风暴角', '宁静谷',
    '星辰海港', '翡翠之梦', '遗忘之塔', '血色要塞', '龙啸荒原',
  ],
  'location_western_modern': [
    '诺瓦科技城', '星海商业中心', '暮光广场', '翡翠湾新区', '钢铁港',
    '自由之塔', '天际大道', '星光穹顶', '潮汐大桥', '极光度假村',
    '暗夜中心', '灯火码头', '水晶穹顶站', '未来中枢', '碧波湾',
  ],
  // ── 势力 ──
  'faction_chinese': [
    '天机阁', '凌云宗', '青云门', '紫霄宫', '万剑山庄',
    '药王谷', '天魔教', '血影楼', '六扇门', '锦衣卫',
    '御剑堂', '星辰殿', '百草堂', '神兵阁', '灵霄派',
    '玄冰宫', '苍狼帮', '飞鹰堡', '碧落门', '雷霆府',
    '清风会', '烈火堂', '镇天楼', '苍龙阁', '幻月仙宗',
  ],
  'faction_western': [
    '黎明圣殿', '暗影议会', '钢铁十字军', '虚空守望者', '银翼骑士团',
    '血月之誓', '晨星联盟', '暗刃行会', '灰袍修士会', '狮鹫骑士团',
    '寒霜军团', '火焰秘社', '星辉之塔', '黑铁兄弟会', '紫罗兰学院',
    '风暴之锤', '亡者之握', '晨曦守卫', '暗潮商会', '圣剑修会',
  ],
  // ── 装备 ──
  'equipment_chinese': [
    '诛仙剑', '龙泉剑', '天机伞', '寒冰刃', '紫金葫芦',
    '太乙拂尘', '生死簿', '万妖幡', '九龙神火罩', '青莲剑',
    '碎星刀', '太极图', '打神鞭', '捆仙索', '雷音钟',
    '噬魂刺', '冰心环', '凤翅镏金镋', '烈焰枪', '幽冥镜',
    '乾坤圈', '紫电剑', '赤霄剑', '断水刀', '陨星戟',
  ],
  'equipment_western': [
    '龙息之刃', '永恒之剑', '噬魂者', '霜语法杖', '黎明之光',
    '暗影壁垒', '血月弯刀', '圣光十字', '亡语长弓', '混沌王冠',
    '冰晶权杖', '风暴号角', '深红之爪', '星辰碎甲', '深渊之眼',
    '烈焰长戟', '寒霜巨剑', '虚空之握', '雷霆之锤', '暮光斗篷',
  ],
  // ── 功法 ──
  'technique_chinese': [
    '九天玄雷诀', '太虚步', '九转金丹功', '万剑归宗', '太极生灭法',
    '逍遥游', '降龙十八掌', '六脉神剑', '乾坤大挪移', '独孤九剑',
    '无相神功', '易筋经', '洗髓经', '凌波微步', '小无相功',
    '北冥真经', '长生造化功', '星辰变', '焚天诀', '大衍星辰术',
    '天罡北斗阵', '紫霞神功', '混元一气诀', '朱雀焚天功', '冰心诀',
  ],
  'technique_western': [
    '星火术', '寒冰风暴', '暗影帷幕', '神圣新星', '时光逆流',
    '元素召唤', '亡灵复生', '火焰风暴', '冰霜之环', '虚空之门',
    '灵魂锁链', '雷霆之怒', '生命之泉', '混沌漩涡', '圣光之盾',
    '暗影步', '龙息术', '心灵震爆', '维度裂隙', '重塑术',
  ],
  // ── 怪兽 ──
  'monster_chinese': [
    '苍冥麒麟', '九霄云鹤', '玄霜冰凤', '紫电雷蛟', '碧落青鸾',
    '焚天焱龙', '寒渊雪蟒', '月影灵狐', '天罡巨猿', '太虚金鹏',
    '幽冥血蝠', '星辰玄龟', '裂风银狼', '赤焰朱雀', '沧溟鲸鲲',
    '幻幽蝶影', '炼狱魔螳', '雷音神虎', '冰晶仙鹿', '万毒花蛛',
  ],
  'monster_western': [
    '混沌死灵', '血色骑士', '暗影君主', '深渊吞噬者', '虚空行者',
    '噬魂魔', '霜语巨龙', '烈狱守卫', '冥河摆渡者', '梦魇骑士',
    '暗夜猎手', '亡语女妖', '灰烬之王', '灵魂收割者', '末日使者',
    '黑曜石魔像', '血月狼人', '冰霜巨魔', '幽魂领主', '深渊九头蛇',
  ],
};

// ═══════════════════════════════════════════════════
// 辅助函数
// ═══════════════════════════════════════════════════

/** 获取内置名字库的 key */
function getBuiltinKey(category: Category, style: Style, gender: Gender, era: Era): string {
  if (category === 'character') {
    return `character_${style}_${gender}`;
  }
  if (category === 'location') {
    return `location_${style}_${era}`;
  }
  return `${category}_${style}`;
}

/** 从内置库随机抽取 15 个名字（尽量不重复） */
function pickRandom(names: string[], count: number = 15): string[] {
  const shuffled = [...names].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

/** 过滤姓氏 */
function filterBySurname(names: string[], surname: string): string[] {
  const s = surname.trim();
  if (!s) return names;
  return names.filter(n => n.startsWith(s));
}

/** 从内置库获取名字，应用筛选条件 */
function getBuiltinNames(
  category: Category,
  style: Style,
  gender: Gender,
  surname: string,
  era: Era,
): string[] {
  // 中式人物走「组合式生成」，固定姓氏时永远能组合出名字
  if (category === 'character' && style === 'chinese') {
    const g = gender === 'male' ? '男' as const : '女' as const;
    const results = generateCharacterNames({
      gender: g,
      origin: 'cultivator', // 默认古风修仙定位
      tone: g === '男' ? '古雅' : '温润',
      count: 15,
      fixedSurname: surname.trim() || undefined,
    });
    return results.map(r => r.name);
  }

  // 中式其他类别走组合式生成
  if (style === 'chinese') {
    switch (category) {
      case 'faction':
        return generateFactionNames({ style: '正道', count: 15 });
      case 'location':
        return generateLocationNames({ category: era === 'ancient' ? '山岳' : '城市', count: 15 });
      case 'equipment':
        return generateItemNames({ type: '法宝', count: 15 });
      case 'technique':
        return generateTechniqueNames({ count: 15 });
      case 'monster':
        return generateCreatureNames({ count: 15 });
      default:
        break;
    }
  }

  const key = getBuiltinKey(category, style, gender, era);
  const pool = BUILTIN_NAMES[key] || [];
  const hasSurname = surname.trim().length > 0;

  if (style === 'chinese' && hasSurname) {
    // 按姓氏过滤
    const filtered = filterBySurname(pool, surname);
    // 内置库是有限的，如果该姓氏匹配不到足够名字，
    // 保留匹配到的少量名字 + 混入随机名字补充到 15 个（标记来源）
    if (filtered.length >= 5) {
      return pickRandom(filtered, 15);
    }
    // 姓氏匹配太少：保留匹配到的，用随机名字补足
    const remaining = pool.filter(n => !n.startsWith(surname.trim()));
    return [...filtered, ...pickRandom(remaining, 15 - filtered.length)];
  }

  return pickRandom(pool);
}

// ═══════════════════════════════════════════════════
// AI Prompt 构建
// ═══════════════════════════════════════════════════

function buildPrompt(
  category: Category,
  style: Style,
  gender: Gender,
  surname: string,
  era: Era,
): string {
  const styleName = style === 'chinese' ? '中式' : style === 'western' ? '西式' : '日式';

  let prompt = `你是一位精通全球命名文化的创意助手，专为小说创作提供名字灵感。\n\n`;
  prompt += `请为小说创作凭空创造 15 个${styleName}${CATEGORIES.find(c => c.key === category)?.label}名字。\n\n`;

  prompt += `━━━ 核心要求 ━━━\n`;
  prompt += `- 必须凭空创作，全部原创，不可抄袭任何已有作品中的名字\n`;
  prompt += `- 不要使用任何知名作品（小说、游戏、影视）中已有的角色名、地点名\n`;
  prompt += `- 名字要有意境和美感，读起来朗朗上口\n`;

  switch (category) {
    case 'character':
      prompt += `\n人物名字要求：\n`;
      if (style === 'chinese') {
        prompt += `- ${gender === 'male' ? '男性' : '女性'}中文名字\n`;
        prompt += `- 每个名字 2-3 个汉字\n`;
        prompt += `- 风格：古风武侠/修仙飘逸/现代文艺均可\n`;
        prompt += `- 名字要有诗意或意境\n`;
        if (surname.trim()) {
          prompt += `- 🔴 姓氏必须固定为「${surname.trim()}」，名字部分（1-2 字）自由发挥\n`;
        } else {
          prompt += `- 姓氏多样，不要全部用同一个姓\n`;
        }
        if (gender === 'female') {
          prompt += `- 偏柔美/婉约/清雅风格，也可有飒爽英气型\n`;
        } else {
          prompt += `- 偏阳刚/儒雅/豪迈风格，也可有温润如玉型\n`;
        }
      } else if (style === 'western') {
        prompt += `- ${gender === 'male' ? '男性' : '女性'}西式名字（音译中文）\n`;
        prompt += `- 每个名字 2-5 个汉字，如"克里斯托弗"、"艾琳诺"\n`;
        prompt += `- 风格：史诗奇幻/骑士/贵族/平民均可\n`;
      } else {
        prompt += `- ${gender === 'male' ? '男性' : '女性'}日式名字（中文汉字表示）\n`;
        prompt += `- 每个名字 2-4 个汉字\n`;
        prompt += `- 风格：和风/武士/神社/都市均可\n`;
      }
      break;

    case 'location':
      prompt += `\n地点名字要求：\n`;
      if (style === 'chinese') {
        prompt += `- ${era === 'ancient' ? '古代' : '现代'}中式地点\n`;
        if (era === 'ancient') {
          prompt += `- 风格：武侠江湖（客栈、山庄、谷、崖）、修仙仙侠（天宫、洞府、秘境、仙山）\n`;
          prompt += `- 名字 2-5 个汉字\n`;
        } else {
          prompt += `- 风格：现代都市（街道、社区、城市地标）、科幻未来\n`;
          prompt += `- 名字 2-5 个汉字\n`;
        }
      } else {
        prompt += `- ${era === 'ancient' ? '古代' : '现代'}西式地点\n`;
        if (era === 'ancient') {
          prompt += `- 风格：中世纪奇幻（城堡、森林、沼泽、宫殿、小径、遗迹）\n`;
        } else {
          prompt += `- 风格：现代都市、科幻未来\n`;
        }
        prompt += `- 音译中文，2-6 个汉字\n`;
      }
      break;

    case 'faction':
      prompt += `\n势力名字要求：\n`;
      if (style === 'chinese') {
        prompt += `- 风格：武林门派、修仙宗门、江湖帮派、朝廷机构、商会\n`;
        prompt += `- 名字 2-5 个汉字\n`;
      } else {
        prompt += `- 风格：骑士团、魔法公会、佣兵团、盗贼行会、帝国军团、商会联盟\n`;
        prompt += `- 音译中文，2-6 个汉字\n`;
      }
      break;

    case 'equipment':
      prompt += `\n装备名字要求：\n`;
      if (style === 'chinese') {
        prompt += `- 风格：仙侠法宝、武侠兵器、神兵利器、暗器\n`;
        prompt += `- 名字 2-5 个汉字\n`;
      } else {
        prompt += `- 风格：魔法武器、圣器、传说级装备、盔甲、饰品\n`;
        prompt += `- 音译中文，2-6 个汉字\n`;
      }
      break;

    case 'technique':
      prompt += `\n功法名字要求：\n`;
      if (style === 'chinese') {
        prompt += `- 风格：修仙功法、武功心法、招式名称、内功秘籍\n`;
        prompt += `- 名字 2-6 个汉字，要有韵味\n`;
      } else {
        prompt += `- 风格：魔法咒语、战技、禁术、元素魔法\n`;
        prompt += `- 音译中文，2-6 个汉字\n`;
      }
      break;

    case 'monster':
      prompt += `\n怪兽名字要求：\n`;
      if (style === 'chinese') {
        prompt += `- 风格：东方神兽/仙兽/妖兽 — 仙气飘飘、威严神秘、东方玄幻气息\n`;
        prompt += `- 名字 2-5 个汉字\n`;
        prompt += `- 不要使用已有的知名神兽名（如白泽、饕餮、麒麟、凤凰等）\n`;
      } else {
        prompt += `- 风格：西方暗黑奇幻 — 死灵、混沌、血族、暗影、深渊系\n`;
        prompt += `- 名字要有黑暗/神秘/恐怖氛围\n`;
        prompt += `- 音译中文或意译，2-6 个汉字\n`;
      }
      break;
  }

  prompt += `\n━━━ 输出格式 ━━━\n`;
  prompt += `严格返回 JSON 字符串数组，格式：["名字1", "名字2", ...]\n`;
  prompt += `只返回 JSON 数组，不要任何解释、不要 markdown 代码块。`;

  return prompt;
}

// ═══════════════════════════════════════════════════
// 解析 AI 返回
// ═══════════════════════════════════════════════════

function parseNameArray(raw: string): string[] {
  let jsonStr = raw.trim();
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();
  const arrayStart = jsonStr.indexOf('[');
  const arrayEnd = jsonStr.lastIndexOf(']');
  if (arrayStart === -1 || arrayEnd === -1 || arrayEnd <= arrayStart) return [];
  jsonStr = jsonStr.slice(arrayStart, arrayEnd + 1);
  try {
    const parsed = JSON.parse(jsonStr);
    if (Array.isArray(parsed)) return parsed.filter((n): n is string => typeof n === 'string' && n.trim().length > 0);
  } catch {
    try {
      const fixed = jsonStr.replace(/,\s*]/g, ']');
      const parsed = JSON.parse(fixed);
      if (Array.isArray(parsed)) return parsed.filter((n): n is string => typeof n === 'string' && n.trim().length > 0);
    } catch { /* fall through */ }
  }
  const lines = jsonStr
    .replace(/[\[\]"]/g, '')
    .split(/[,\n]/)
    .map(l => l.replace(/^\d+[\.\)、\s]+/, '').trim())
    .filter(l => l.length > 0 && l.length < 20);
  return lines.slice(0, 15);
}

// ═══════════════════════════════════════════════════
// 组件
// ═══════════════════════════════════════════════════

interface NameGeneratorProps {
  open: boolean;
  onClose: () => void;
}

const NameGenerator: React.FC<NameGeneratorProps> = ({ open, onClose }) => {
  const [category, setCategory] = useState<Category>('character');
  const [style, setStyle] = useState<Style>('chinese');
  const [gender, setGender] = useState<Gender>('male');
  const [surname, setSurname] = useState('');
  const [era, setEra] = useState<Era>('ancient');
  const [names, setNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [aiAvailable, setAiAvailable] = useState(false);
  const [source, setSource] = useState<'builtin' | 'ai'>('builtin'); // 当前名字来源
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── 初始化：加载 AI 配置（解密 API Key，与 AIChatPanel 共享）──
  useEffect(() => {
    async function init() {
      try {
        const raw = localStorage.getItem('hi-story-ai-configs');
        if (!raw) { console.log('[起名助手] 无 AI 配置'); return; }
        const configs = JSON.parse(raw);
        if (configs.length === 0) { console.log('[起名助手] AI 配置为空数组'); return; }
        // 解密所有配置的 API Key
        const decrypted = await decryptConfigs(configs);
        if (decrypted.length === 0) { console.log('[起名助手] 解密后无配置'); return; }
        // 取第一个可用的配置
        const cfg = decrypted[0];
        const providerId = cfg.providerId || cfg.name; // 兼容两种字段
        const provider = PROVIDERS.find(p => p.id === providerId || p.name === providerId);
        const baseUrl = provider?.baseUrl || '';
        const model = cfg.model || provider?.defaultModel || '';
        console.log('[起名助手] AI 配置成功:', { name: cfg.name || providerId, model, baseUrl: baseUrl.slice(0, 40) + '...' });
        aiService.configure(cfg.name || providerId, cfg.apiKey, model, baseUrl);
        setAiAvailable(true);
      } catch (err) {
        console.warn('[起名助手] AI 配置加载失败:', (err as Error).message);
        // aiAvailable 保持 false，使用离线库
      }
    }
    init();
  }, []);

  // ── 竞态防护：每次新请求递增 generationId，旧请求结果作废 ──
  const generationRef = useRef(0);

  // ── 生成名字（在线 AI + 离线兜底）──
  const generateNames = useCallback(async (
    cat: Category,
    sty: Style,
    gen: Gender,
    sur: string,
    er: Era,
  ) => {
    const genId = ++generationRef.current; // 递增请求 ID
    setLoading(true);
    let aiNames: string[] = [];

    // ── 先试在线 AI ──
    if (aiAvailable) {
      try {
        const systemPrompt = buildPrompt(cat, sty, gen, sur, er);
        const rawResponse = await aiService.chat(
          [{ role: 'user', content: '请开始生成。' }],
          { maxTokens: 500, temperature: 0.9, systemPrompt },
        );
        // 竞态检查：如果已有更新的请求，忽略此结果
        if (generationRef.current !== genId) {
          console.log('[起名助手] 丢弃过期 AI 响应（请求#' + genId + '，当前#' + generationRef.current + '）');
          return;
        }
        aiNames = parseNameArray(rawResponse);
        if (aiNames.length > 0) {
          console.log('[起名助手] AI 生成成功:', aiNames.length, '个名字');
        }
      } catch (err) {
        // 竞态检查：如果已有更新请求，不处理错误
        if (generationRef.current !== genId) return;
        console.warn('[起名助手] AI 调用失败，使用内置库:', (err as Error).message);
      }
    }

    // 再次竞态检查（AI 路径外）
    if (generationRef.current !== genId) return;

    // ── 决定最终来源 ──
    if (aiNames.length >= 5) {
      setNames(aiNames.slice(0, 15));
      setSource('ai');
    } else {
      // 离线兜底：使用内置名字库
      const builtin = getBuiltinNames(cat, sty, gen, sur, er);
      // 如果有 AI 结果但很少，和内置库混合
      const mixed = [...new Set([...aiNames, ...builtin])];
      setNames(mixed.slice(0, 15));
      setSource('builtin');
    }

    setLoading(false);
  }, [aiAvailable]);

  // ── 筛选条件变化时自动生成（300ms 防抖）──
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      generateNames(category, style, gender, surname, era);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [category, style, gender, surname, era, generateNames]);

  // ── 复制到剪贴板 ──
  const handleCopy = useCallback(async (name: string, index: number) => {
    try {
      await navigator.clipboard.writeText(name);
    } catch {
      // fallback
      const ta = document.createElement('textarea');
      ta.value = name;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 1500);
  }, []);

  // ── 手动换一批 ──
  const handleRefresh = useCallback(() => {
    generateNames(category, style, gender, surname, era);
  }, [category, style, gender, surname, era, generateNames]);

  // ── 类别切换时重置风格 ──
  const handleCategoryChange = useCallback((cat: Category) => {
    setCategory(cat);
    const styles = CATEGORY_STYLES[cat];
    if (!styles.includes(style)) setStyle(styles[0]);
    setCopiedIndex(null);
  }, [style]);

  if (!open) return null;

  const availableStyles = CATEGORY_STYLES[category];
  const showGender = category === 'character';
  const showSurname = category === 'character' && style === 'chinese';
  const showEra = category === 'location';

  return (
    <div className="h-full flex flex-col bg-float-900 text-gray-200">
      {/* ── 标题栏 ── */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-float-700 shrink-0">
        <span className="text-xs text-gray-400">
          🎨 起名助手
          {names.length > 0 && (
            <span className="text-gray-600 ml-1">
              ({source === 'ai' ? '🤖 AI' : '📦 内置库'} · {names.length} 候选)
            </span>
          )}
        </span>
        <button onClick={onClose} className="text-gray-500 hover:text-white text-xs">✕</button>
      </div>

      {/* ── 类别 Tab ── */}
      <div className="flex flex-wrap gap-0.5 px-2 py-1.5 border-b border-float-700 shrink-0">
        {CATEGORIES.map(c => (
          <button
            key={c.key}
            onClick={() => handleCategoryChange(c.key)}
            className={`px-2 py-1 rounded text-[11px] transition-colors ${
              category === c.key
                ? 'bg-accent/20 text-accent border border-accent/50'
                : 'text-gray-500 hover:text-gray-300 hover:bg-float-800'
            }`}
          >
            {c.icon} {c.label}
          </button>
        ))}
      </div>

      {/* ── 筛选条件 ── */}
      <div className="px-3 py-2 border-b border-float-700 flex flex-wrap items-center gap-x-4 gap-y-1.5 shrink-0">
        <div className="flex items-center gap-1 text-[11px]">
          <span className="text-gray-500 mr-1">风格</span>
          {availableStyles.map(s => (
            <button
              key={s}
              onClick={() => setStyle(s)}
              className={`px-1.5 py-0.5 rounded transition-colors ${
                style === s ? 'bg-accent/20 text-accent' : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {STYLES.find(x => x.key === s)?.label}
            </button>
          ))}
        </div>

        {showGender && (
          <div className="flex items-center gap-1 text-[11px]">
            <span className="text-gray-500 mr-1">性别</span>
            {(['male', 'female'] as const).map(g => (
              <button
                key={g}
                onClick={() => setGender(g)}
                className={`px-1.5 py-0.5 rounded transition-colors ${
                  gender === g ? 'bg-accent/20 text-accent' : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                {g === 'male' ? '男' : '女'}
              </button>
            ))}
          </div>
        )}

        {showEra && (
          <div className="flex items-center gap-1 text-[11px]">
            <span className="text-gray-500 mr-1">时代</span>
            {(['ancient', 'modern'] as const).map(e => (
              <button
                key={e}
                onClick={() => setEra(e)}
                className={`px-1.5 py-0.5 rounded transition-colors ${
                  era === e ? 'bg-accent/20 text-accent' : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                {e === 'ancient' ? '古代' : '现代'}
              </button>
            ))}
          </div>
        )}

        {showSurname && (
          <div className="flex items-center gap-1 text-[11px]">
            <span className="text-gray-500">姓氏</span>
            <input
              type="text"
              value={surname}
              onChange={e => setSurname(e.target.value)}
              placeholder="可选..."
              className="w-16 px-1.5 py-0.5 bg-float-700 border border-float-600 rounded text-white text-[11px]
                         focus:outline-none focus:border-accent placeholder-gray-600"
            />
          </div>
        )}
      </div>

      {/* ── 操作栏 ── */}
      <div className="px-3 py-1.5 border-b border-float-700 flex items-center justify-between shrink-0">
        <span className="text-[10px] text-gray-600">
          {loading ? '🔄 生成中...' : `${names.length} 个候选`}
        </span>
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="px-2 py-0.5 text-[10px] bg-float-700 hover:bg-float-600 text-gray-300 rounded transition-colors
                     disabled:opacity-40 disabled:cursor-not-allowed"
        >
          🔄 换一批
        </button>
      </div>

      {/* ── 候选名列表 ── */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {loading && names.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-600 text-xs">
            <div className="text-center">
              <p className="text-lg mb-1 animate-pulse">🎨</p>
              <p>正在生成名字...</p>
            </div>
          </div>
        ) : names.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-600 text-xs text-center">
            <div>
              <p className="text-lg mb-1">📦</p>
              <p>名字库已就绪</p>
              <p className="text-gray-700 mt-0.5">选择筛选条件后自动展示</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            {names.map((name, idx) => (
              <button
                key={idx}
                onClick={() => handleCopy(name, idx)}
                className={`px-2 py-1.5 rounded text-xs text-center transition-all cursor-pointer border
                  ${copiedIndex === idx
                    ? 'bg-green-900/40 border-green-600 text-green-300'
                    : 'bg-float-800 border-float-700 hover:border-accent/40 hover:bg-float-700 text-gray-300'
                  }`}
                title="点击复制到剪贴板"
              >
                {copiedIndex === idx ? `✓ ${name}` : name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── 底部提示 ── */}
      <div className="px-3 py-1.5 border-t border-float-700 text-[9px] text-gray-600 text-center shrink-0">
        💡 点击任意名字即可复制到剪贴板
      </div>
    </div>
  );
};

export default NameGenerator;
