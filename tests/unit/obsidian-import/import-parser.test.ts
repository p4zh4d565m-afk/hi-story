import { describe, expect, it } from 'vitest';
import {
  parseMaster, parseVolumes, parseChapters, parseCharacter, parseWorld,
  parseCandidateDrafts, stripWikiLinks,
} from '../../../src/main/obsidian/import-parser';

describe('Obsidian 导入字段映射（真实格式）', () => {
  it('剥除 wiki 链接，取显示文本；缺省时取路径末段', () => {
    expect(stripWikiLinks('[[米尘]]')).toBe('米尘');
    expect(stripWikiLinks('[[../世界观/ABO规则|ABO规则与伪信息素]]')).toBe('ABO规则与伪信息素');
    expect(stripWikiLinks('[[../世界观/主要场景#帕莎游轮|帕莎游轮]]')).toBe('帕莎游轮');
    expect(stripWikiLinks('[[米尘]]的[[陈城|供血者]]关系')).toBe('米尘的供血者关系');
  });

  it('解析总纲：完整大纲索引型（blockquote 卖点、作品定位、三卷索引、伏笔总表）', () => {
    const src = [
      '# 《我有一个妹妹》完整大纲',
      '',
      '> 25字卖点：Beta 骗子装 Omega，骗婚三 Alpha。',
      '>',
      '> 完整设定：未来 ABO 星际时代，Beta 骗子为治病和守护妹妹伪装女性 Omega。',
      '',
      '## 一、作品定位',
      '',
      '- 类型：BL 男受 ABO · 未来星际',
      '- 结局：开放式结局',
      '- 人设定调：高智商作精',
      '',
      '## 二、三卷大纲索引',
      '',
      '1. [卷 1 陆昭线 · 骗婚骗心（第 1-50 章）](卷1.md)',
      '2. [卷 2 顾景线 · 蛇窝囚笼（第 51-100 章）](卷2.md)',
      '3. [卷 3 凌曜线 · 身世修罗场（第 101-150 章）](卷3.md)',
      '',
      '## 三、三攻反转错开',
      '',
      '- 陆昭"我早就知道"：三层递进。',
      '- 顾景"钓鱼执法"：卷 2 中段反转。',
      '',
      '## 四、伏笔总表',
      '',
      '| 伏笔 | 埋设章节 | 回收章节 | 内容 |',
      '|---|---|---|---|',
      '| 身份伪装 | 1-3 | 83、137 | 沈悦=沈屿，男性 Beta 装女性 Omega |',
      '| 血乏症 | 5、8 | 41、77 | 实验产物 |',
    ].join('\n');
    const r = parseMaster(src, '完整大纲');
    expect(r.value.premise).toContain('Beta 骗子');
    expect(r.value.ending).toBe('开放式结局');
    expect(r.value.structureModel).toBe('BL 男受 ABO · 未来星际');
    expect(r.value.phases).toHaveLength(3);
    expect(r.value.phases[0]).toMatchObject({ title: '卷 1 陆昭线 · 骗婚骗心', chapterRange: '第 1-50 章' });
    expect(r.value.subplots).toHaveLength(2);
    expect(r.value.storyPromises).toHaveLength(2);
    expect(r.value.storyPromises[0]).toContain('身份伪装');
  });

  it('解析总纲阶段小节：阶段 heading 下的小节填充 purpose/转折点/情绪/关键事件', () => {
    const src = [
      '# 测试总纲',
      '> 完整设定：一个前提。',
      '',
      '## 作品定位',
      '- 类型：BL',
      '- 结局：开放式',
      '- 人设定调：作精',
      '',
      '## 阶段 1：骗婚骗心（第 1-50 章）',
      '- 目的：建立骗局与三角张力',
      '- 转折点：性别暴露',
      '- 情绪趋势：暧昧转暗流',
      '- 关键事件：黄金三章、订婚、身份暴露',
      '',
      '## 阶段 2：蛇窝囚笼（第 51-100 章）',
      '- 目的：囚禁与反制',
      '- 转折点：第三次逃跑',
      '- 情绪趋势：窒息转反抗',
      '- 关键事件：蛇窝审讯、中点灾难',
    ].join('\n');
    const r = parseMaster(src, '测试总纲');
    expect(r.value.phases).toHaveLength(2);
    expect(r.value.phases[0]).toMatchObject({
      title: '骗婚骗心',
      chapterRange: '第 1-50 章',
      purpose: '建立骗局与三角张力',
      turningPoint: '性别暴露',
      emotionTrend: '暧昧转暗流',
    });
    expect(r.value.phases[0].keyEvents).toEqual(['黄金三章', '订婚', '身份暴露']);
  });

  it('解析分卷：卷文件（标题含章范围、核心冲突、阶段拆解、卷末钩子）', () => {
    const src = [
      '# 卷 1 陆昭线 · 骗婚骗心（第 1-50 章）',
      '',
      '## 核心冲突',
      '',
      '沈屿伪装沈悦接近陆昭，骗取治疗仪与能量石。',
      '',
      '## 阶段拆解',
      '',
      '- 第 1-15 章：黄金三章、恋爱订婚、性别暴露',
      '- 第 16-20 章：绑架、自救、逃离',
      '- 第 21-30 章：黑市任务线',
      '',
      '## 卷末钩子',
      '',
      '顾景打开蛇窝牢房："听说你想偷我的东西？"',
      '',
      '## 本卷重点人物',
      '',
      '沈屿/沈悦、沈粒、韩城、陆昭、顾景',
    ].join('\n');
    const r = parseVolumes(src);
    expect(r.value).toHaveLength(1);
    expect(r.value[0]).toMatchObject({
      title: '卷 1 陆昭线 · 骗婚骗心',
      chapterRange: '第 1-50 章',
      volumeGoal: '沈屿伪装沈悦接近陆昭，骗取治疗仪与能量石。',
      climax: '顾景打开蛇窝牢房："听说你想偷我的东西？"',
      characterProgression: '沈屿/沈悦、沈粒、韩城、陆昭、顾景',
    });
    expect(r.value[0].keyEvents).toHaveLength(3);
    expect(r.value[0].mainProgression).toContain('黄金三章');
  });

  it('解析章纲：全书表格（卷标题分段 + 表头行）', () => {
    const src = [
      '## 卷 1 陆昭线（第 1-50 章）',
      '',
      '| 章 | 标题 | 核心事件 | 剧情推进 | 爽点/悬念 | 伏笔 | 场景 | 情绪 |',
      '|---|------|---------|---------|-----------|------|------|------|',
      '| 1 | 初见 | 星海游轮顶层宴会。 | 陆昭掷刀立威。 | 爽点：飞刀镇场。；悬念：omega是谁？ | 沈悦在咬韩城前已观察他 | 星海游轮顶层 | 紧张→暧昧 |',
      '| 2 | 调戏？ | 沈悦主动撩韩城取檀香血。 | 咬血取信息素。 | 爽点：猎手姿态反转。 | 檀香血能稳定伪信息素 | 星海游轮走廊 | 暧昧→疑惑 |',
      '',
      '## 卷 2 顾景线（第 51-100 章）',
      '',
      '| 章 | 标题 | 核心事件 | 爽点/钩子 |',
      '|---|------|---------|-----------|',
      '| 51 | 蛇窝 | 沈屿醒来被关蛇窝。 | 囚禁开场。；钩子：交出什么？ |',
    ].join('\n');
    const r = parseChapters(src, null);
    expect(r.value).toHaveLength(3);
    expect(r.value[0]).toMatchObject({
      volumeIndex: 0, chapterNumber: 1, title: '初见',
      centralConflict: '星海游轮顶层宴会。', chapterGoal: '陆昭掷刀立威。',
      reveal: '沈悦在咬韩城前已观察他', emotionalBeat: '紧张→暧昧',
    });
    expect(r.value[0].payoff).toContain('飞刀镇场');
    expect(r.value[0].endingHook).toContain('omega是谁');
    expect(r.value[2]).toMatchObject({ volumeIndex: 1, chapterNumber: 51, title: '蛇窝' });
  });

  it('解析章纲可选列：表头命中视角/开场处境/关键节拍/人物变化时填充', () => {
    const src = [
      '| 章 | 标题 | 核心事件 | 视角 | 开场处境 | 关键节拍 | 人物变化 |',
      '|---|------|---------|------|---------|---------|---------|',
      '| 1 | 初见 | 宴会。 | 米尘 | 混入宴会 | 异常出现；主角拒绝；代价落下 | 从回避转应对 |',
    ].join('\n');
    const r = parseChapters(src, null);
    expect(r.value).toHaveLength(1);
    expect(r.value[0]).toMatchObject({
      pov: '米尘',
      openingSituation: '混入宴会',
      characterChange: '从回避转应对',
    });
    expect(r.value[0].keyBeats).toEqual(['异常出现', '主角拒绝', '代价落下']);
  });

  it('解析章纲可选列：表头未命中时字段留空，且「场景」列不误填开场处境', () => {
    const src = [
      '| 章 | 标题 | 核心事件 | 场景 | 情绪 |',
      '|---|------|---------|------|------|',
      '| 1 | 初见 | 宴会。 | 星海游轮 | 紧张 |',
    ].join('\n');
    const r = parseChapters(src, null);
    expect(r.value[0]).toMatchObject({
      pov: '',
      openingSituation: '',
      characterChange: '',
      keyBeats: [],
    });
  });

  it('解析人物：独立人物文件（身份与能力 / 性格层次 / 欲望与成长）', () => {
    const src = [
      '# 沈屿',
      '',
      '## 一句话定位',
      '',
      '身患绝症、以"沈悦"身份行骗的男性 Beta。',
      '',
      '## 身份与能力',
      '',
      '- 伪装身份：沈悦，女性 Omega。',
      '- 身份：国际骗子团伙成员、实验体。',
      '- 能力：骗术、伪信息素、快速应变。',
      '',
      '## 性格层次',
      '',
      '- 表面：高智商、会演、慵懒勾人。',
      '- 行动特点：嘴欠、爱作、得理不饶人。',
      '',
      '## 欲望与成长',
      '',
      '- 外在目标：治病，带家人逃离。',
      '- 成长节点：妹妹被抓后开始主动坦白。',
    ].join('\n');
    const r = parseCharacter(src, '沈屿', {});
    expect(r.value.personality).toContain('高智商');
    expect(r.value.background).toContain('骗子团伙成员');
    expect(r.value.arc).toContain('主动坦白');
  });

  it('解析世界观：场景文件（标题段落 + 列表），description 为全文', () => {
    const src = [
      '# 主要场景',
      '',
      '## 星海游轮',
      '',
      '- 第一卷开场地点。',
      '- 关键人物：[[沈屿]]、[[陆昭]]。',
    ].join('\n');
    const w = parseWorld(src, '主要场景');
    expect(w.description).toContain('星海游轮');
    expect(w.description).toContain('沈屿');
  });

  it('parseCandidateDrafts 按槽位编排五类草稿', () => {
    const content = '# 沈屿\n\n## 性格层次\n\n- 表面：高智商。\n';
    const { drafts, issues } = parseCandidateDrafts(content, {}, ['character'], '沈屿');
    expect(drafts.characters).toHaveLength(1);
    expect(drafts.characters[0].name).toBe('沈屿');
    expect(drafts.characters[0].sourceName).toBe('沈屿');
    expect(drafts.master).toBeNull();
    expect(issues).toEqual([]);
  });
});
