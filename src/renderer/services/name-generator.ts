// ============================================================
// 组合式起名核心逻辑（移植自 TulanCN/vibe-noveling 的 character.py）
// 「姓氏 × 名字用字」组合式生成 + 防尬名 + 稀有度 + 去重
// ============================================================

import {
  SURNAMES,
  MALE_NAMES,
  FEMALE_NAMES,
  TONE_CHARS,
  FEMALE_EXTRA,
  SHARED,
  SECT,
  LOCATION,
  ITEM,
  TECHNIQUE,
  CREATURE,
  STRANGE,
  type NameCharPool,
} from './name-data';

export type CharacterOrigin = 'modern' | 'cultivator' | 'villain' | 'civilian';
export type Tone = '写实' | '古雅' | '凌厉' | '温润';

export interface GeneratedName {
  /** 完整姓名 */
  name: string;
  /** 姓氏 */
  surname: string;
  /** 名字部分 */
  givenName: string;
  /** 定位 */
  origin: CharacterOrigin;
  /** 气质 */
  tone: Tone;
  /** 总字数 */
  length: number;
}

/** 稀有度等级（决定名字长度与逼格） */
const RARITY_LEVELS: Array<{ key: string; cn: string; threshold: number; length: [number, number] }> = [
  { key: 'common', cn: '凡品', threshold: 1.0, length: [2, 3] },
  { key: 'uncommon', cn: '良品', threshold: 0.35, length: [3, 4] },
  { key: 'rare', cn: '上品', threshold: 0.15, length: [3, 4] },
  { key: 'epic', cn: '极品', threshold: 0.075, length: [4, 5] },
  { key: 'legendary', cn: '秘宝', threshold: 0.03, length: [4, 5] },
  { key: 'mythic', cn: '灵宝', threshold: 0.012, length: [4, 5] },
  { key: 'exotic', cn: '古宝', threshold: 0.005, length: [4, 5] },
];

function rollRarity(): string {
  const r = Math.random();
  for (let i = RARITY_LEVELS.length - 1; i >= 0; i--) {
    if (r <= RARITY_LEVELS[i].threshold) return RARITY_LEVELS[i].key;
  }
  return 'common';
}

function pickOne<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickRandom<T>(arr: T[], count: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

function dedupe<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

/** 按定位选姓氏 */
function pickSurname(origin: CharacterOrigin, totalLength: number): string {
  const useCompound = totalLength === 4 && (() => {
    if (origin === 'modern') return Math.random() < 0.85;
    if (origin === 'civilian') return Math.random() < 0.2;
    return Math.random() < 0.55;
  })();

  let surnames: string[];
  if (origin === 'cultivator') {
    surnames = [...SURNAMES.cultivatorPriority, ...SURNAMES.common];
  } else if (origin === 'villain') {
    surnames = [...SURNAMES.villainPriority, ...SURNAMES.rare, ...SURNAMES.common];
  } else {
    surnames = [...SURNAMES.common];
  }

  if (useCompound) {
    const compound = origin === 'villain'
      ? [...SURNAMES.rare, ...SURNAMES.compound]
      : SURNAMES.compound;
    return pickOne(compound);
  }
  return pickOne(dedupe(surnames));
}

/** 按定位 + 气质构建名字用字池 */
function buildCharPool(pool: NameCharPool, origin: CharacterOrigin, tone: Tone, gender: '男' | '女'): string[] {
  const chars: string[] = [...pool.chars];

  const toneMap: Record<Tone, 'refined' | 'sharp' | 'grounded' | 'warm'> = {
    '写实': 'grounded',
    '古雅': 'refined',
    '凌厉': 'sharp',
    '温润': 'warm',
  };
  const toneChars = (gender === '男' ? TONE_CHARS.male : TONE_CHARS.female)[toneMap[tone]];
  chars.push(...toneChars);

  // 女性古雅/温润补充柔和系 + 植物系
  if (gender === '女' && (tone === '古雅' || tone === '温润')) {
    chars.push(...FEMALE_EXTRA.gentle, ...FEMALE_EXTRA.flora);
  }

  return dedupe(chars);
}

/** 按定位 + 气质构建双字对池 */
function buildPairPool(pool: NameCharPool, tone: Tone): string[] {
  return pool.pairs;
}

/** 防尬名检测：过滤中二尬名 + 俗字 + 叠字 */
function isAwkward(fullName: string, givenName: string, origin: CharacterOrigin): boolean {
  if (!givenName) return true;
  // 名字全是同一个字
  if (givenName.length > 1 && new Set(givenName).size === 1) return true;
  // 相邻同字
  for (let i = 0; i < givenName.length - 1; i++) {
    if (givenName[i] === givenName[i + 1]) return true;
  }
  // 中二尬名
  const forbiddenPairs = ['玄冥', '冥幽', '绝灭', '霸天', '弑神', '狂龙', '血煞'];
  if (forbiddenPairs.some(p => fullName.includes(p))) return true;
  // 定位相关过滤
  if (origin === 'modern' && [...fullName].some(c => '冥魇煞刹弑'.includes(c))) return true;
  if (origin === 'civilian' && [...fullName].some(c => '霄渊魇刃烬'.includes(c))) return true;
  return false;
}

/** 现代定位：双字名避免太俗的搭配 */
function pickModernGivenName(chars: string[], count: number): string {
  if (count !== 2) return pickRandom(chars, count).join('');
  const firstPool = chars.filter(c => !'军国伟强福贵财寿'.includes(c));
  const secondPool = chars.filter(c => !'军国建民'.includes(c));
  return pickOne(firstPool.length ? firstPool : chars) + pickOne(secondPool.length ? secondPool : chars);
}

/** 生成名字部分 */
function generateGivenName(pool: NameCharPool, chars: string[], totalLength: number, surname: string, origin: CharacterOrigin, tone: Tone): string {
  const givenLength = totalLength - surname.length;
  if (givenLength <= 0) return '';

  if (givenLength === 1) {
    return pickOne(chars);
  }

  if (givenLength === 2) {
    const pairPool = buildPairPool(pool, tone);
    // 双字对概率高，保证有意境
    const usePairProb = origin === 'cultivator' ? 0.9 : origin === 'modern' || origin === 'civilian' ? 0.85 : 0.72;
    if (pairPool.length > 0 && Math.random() < usePairProb) {
      for (let i = 0; i < 20; i++) {
        const given = pickOne(pairPool);
        if (given.length === 2 && !isAwkward(surname + given, given, origin)) return given;
      }
    }
    // 兜底：单字组合
    for (let i = 0; i < 30; i++) {
      const given = origin === 'modern'
        ? pickModernGivenName(chars, 2)
        : dedupe(pickRandom(chars, 2)).join('');
      if (given.length === 2 && !isAwkward(surname + given, given, origin)) return given;
    }
    return origin === 'modern' ? pickModernGivenName(chars, 2) : pickRandom(chars, 2).join('');
  }

  // 3 字名
  for (let i = 0; i < 30; i++) {
    const given = dedupe(pickRandom(chars, 3)).join('');
    if (given.length === 3 && !isAwkward(surname + given, given, origin)) return given;
  }
  return pickRandom(chars, 3).join('');
}

/** 根据定位和长度决定名字总字数 */
function resolveLength(origin: CharacterOrigin): number {
  const roll = Math.random();
  if (origin === 'modern') return roll < 0.9 ? 3 : 4;
  if (origin === 'civilian') return roll < 0.8 ? 3 : 2;
  if (origin === 'villain') return roll < 0.5 ? 3 : roll < 0.9 ? 2 : 4;
  // cultivator 默认 3 字为主
  return roll < 0.7 ? 3 : roll < 0.9 ? 2 : 4;
}

/**
 * 生成角色名（组合式）
 * @param gender 性别
 * @param origin 定位（现代/修士/反派/凡人）
 * @param tone 气质（写实/古雅/凌厉/温润）
 * @param count 生成数量
 * @param fixedSurname 固定姓氏（可选，指定后名字部分自由组合）
 * @param exclude 已存在的名字集合（去重）
 */
export function generateCharacterNames(opts: {
  gender: '男' | '女';
  origin: CharacterOrigin;
  tone: Tone;
  count: number;
  fixedSurname?: string;
  exclude?: Set<string>;
}): GeneratedName[] {
  const { gender, origin, tone, count, fixedSurname, exclude } = opts;
  const blocked = new Set(exclude ?? new Set());
  const results: GeneratedName[] = [];

  const sourcePool = gender === '男' ? MALE_NAMES : FEMALE_NAMES;
  const pool = sourcePool[origin];

  const maxAttempts = Math.max(count * 20, 40);
  let attempts = 0;

  while (results.length < count && attempts < maxAttempts) {
    attempts++;

    const totalLength = resolveLength(origin);
    const surname = fixedSurname?.trim() || pickSurname(origin, totalLength);
    if (surname.length >= totalLength) continue;

    const chars = buildCharPool(pool, origin, tone, gender);
    const givenName = generateGivenName(pool, chars, totalLength, surname, origin, tone);
    const fullName = surname + givenName;

    if (!fullName || blocked.has(fullName) || isAwkward(fullName, givenName, origin)) continue;

    results.push({
      name: fullName,
      surname,
      givenName,
      origin,
      tone,
      length: fullName.length,
    });
    blocked.add(fullName);
  }

  return results;
}

// ============================================================
// 非角色类别生成（势力/地点/装备/功法/怪兽）
// ============================================================

/** 去重收集：生成 count 个不重复的名字 */
function collectUnique(count: number, builder: () => string, exclude: Set<string> = new Set()): string[] {
  const blocked = new Set(exclude);
  const results: string[] = [];
  const maxAttempts = Math.max(count * 40, 120);
  let attempts = 0;
  while (results.length < count && attempts < maxAttempts) {
    attempts++;
    const name = builder();
    if (!name || blocked.has(name) || looksAwkward(name)) continue;
    results.push(name);
    blocked.add(name);
  }
  return results;
}

/** 简单尴尬检测：重复字 + 后缀叠字 */
function looksAwkward(name: string): boolean {
  if (!name || name.length < 2) return true;
  if (new Set(name).size === 1) return true;
  const forbiddenPairs = ['宗宗', '门门', '教教', '盟盟', '城城', '谷谷', '山山', '海海', '湖湖', '洞洞', '境境', '界界'];
  return forbiddenPairs.some(p => name.includes(p));
}

/** 稀有度索引（0=凡品 … 6=古宝） */
function rarityIndex(): number {
  const r = Math.random();
  const thresholds = [0.35, 0.15, 0.075, 0.03, 0.012, 0.005];
  for (let i = thresholds.length - 1; i >= 0; i--) {
    if (r <= thresholds[i]) return i + 1;
  }
  return 0;
}

/** 生成势力名（宗门/门派） */
export function generateFactionNames(opts: {
  style: '正道' | '魔道' | '中立';
  count: number;
}): string[] {
  const { style, count } = opts;
  return collectUnique(count, () => {
    const suffix = pickOne(SECT.suffixes);
    let head: string;
    if (style === '魔道') {
      head = pickOne(SECT.demonic) + pickOne([...SECT.demonic, ...SECT.place]);
    } else if (style === '中立') {
      head = pickOne(SECT.neutral) + pickOne([...SECT.neutral, ...SHARED.nature]);
    } else {
      head = pickOne(SECT.righteous) + pickOne([...SECT.righteous, ...SHARED.celestial, ...SECT.place]);
    }
    return head + suffix;
  });
}

/** 生成地点名 */
export function generateLocationNames(opts: {
  category: '城市' | '山岳' | '水域' | '秘境' | '大陆';
  count: number;
}): string[] {
  const { category, count } = opts;
  return collectUnique(count, () => {
    const base = LOCATION[category];
    const prefix = pickOne(base.prefixes);
    const modifier = pickOne(base.modifiers);
    const root = pickOne(base.roots);
    if (category === '秘境' && Math.random() < 0.5) return modifier + root;
    if (category === '大陆' && Math.random() < 0.4) return prefix + root;
    if (category === '水域' && Math.random() < 0.3) return modifier + root;
    return prefix + modifier + root;
  });
}

/** 生成装备名（法宝/丹药/符箓/材料/典籍） */
export function generateItemNames(opts: {
  type: '法宝' | '丹药' | '符箓' | '材料' | '典籍';
  count: number;
}): string[] {
  const { type, count } = opts;
  return collectUnique(count, () => {
    const ri = rarityIndex();
    const data = ITEM[type];

    if (type === '法宝') {
      const words = [...data.weapons, ...data.accessories, ...data.defensive, ...data.tools];
      if (ri <= 1) return pickOne(words);
      if (ri <= 2) return pickOne(data.prefixes_rare) + pickOne(words);
      if (ri <= 4) return pickOne(SHARED.colors) + pickOne(data.prefixes_rare) + pickOne(words);
      return pickOne(data.prefixes_legendary) + pickOne(words);
    }
    if (type === '丹药') {
      if (ri <= 1) return pickOne(data.effects) + pickOne(data.forms);
      if (ri <= 3) return pickOne(SHARED.colors) + pickOne(data.effects) + pickOne(data.forms);
      return pickOne(['千年', '万年', '太古', '上古', '洪荒', '混沌']) + pickOne(data.effects) + pickOne(data.forms);
    }
    if (type === '符箓') {
      if (ri <= 1) return pickOne(data.effects) + pickOne(data.forms.slice(0, 7));
      if (ri <= 3) return pickOne(SHARED.colors) + pickOne(data.effects) + pickOne(data.forms.slice(0, 7));
      return pickOne(data.materials) + pickOne(data.effects) + pickOne(data.forms[0]);
    }
    if (type === '材料') {
      const mats = [...data.minerals, ...data.organic, ...data.botanical];
      if (ri <= 1) return pickOne(mats);
      if (ri <= 3) return pickOne(data.quality_prefixes) + pickOne(mats);
      return pickOne(SHARED.colors) + pickOne(data.quality_prefixes) + pickOne(mats);
    }
    // 典籍
    if (ri <= 1) return pickOne(data.subjects) + pickOne(data.forms.slice(0, 10));
    if (ri <= 3) return pickOne(data.quality_prefixes) + pickOne(data.subjects) + pickOne(data.forms.slice(0, 10));
    return pickOne(data.quality_prefixes) + pickOne(data.subjects) + pickOne(data.forms[0]);
  });
}

/** 生成功法名 */
export function generateTechniqueNames(opts: {
  count: number;
}): string[] {
  const { count } = opts;
  return collectUnique(count, () => {
    const t = TECHNIQUE.traditional;
    const category = pickOne(['attack', 'defense', 'movement', 'utility', 'formation'] as const);
    return pickOne(t.prefixes) + pickOne(t[category]);
  });
}

/** 生成怪兽名 */
export function generateCreatureNames(opts: {
  count: number;
}): string[] {
  const { count } = opts;
  return collectUnique(count, () => {
    const ri = rarityIndex();
    const category = pickOne(['兽', '鸟', '鱼', '虫', '爬虫', '草木'] as const);
    const base = CREATURE[category];
    const root = pickOne(base.roots);
    const modifier = pickOne(base.modifiers);
    // 高稀有度概率用上古神兽名
    if (ri >= 4 && Math.random() < 0.4) {
      return pickOne(SHARED.colors) + pickOne(STRANGE.ancient_beasts);
    }
    return pickOne(base.prefixes) + modifier + root;
  });
}
