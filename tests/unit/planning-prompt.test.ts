import { describe, expect, it } from 'vitest';
import { parseMasterOutline, parseStoryOptions } from '../../src/renderer/services/ai-prompts/planning';

const option = {
  title: '测试书名',
  logline: '一个完整的一句话故事。',
  targetReader: '喜欢成长故事的读者',
  corePromise: '持续成长与选择',
  protagonist: '有欲望也有短板的主角',
  centralConflict: '无法逃避的主要对抗',
  differentiator: '独有的限制条件',
  endingDirection: '完成核心选择',
};

describe('parseStoryOptions', () => {
  it('接受被代码块包裹的三个完整方案', () => {
    const result = parseStoryOptions(`\`\`\`json\n${JSON.stringify({ options: [option, option, option] })}\n\`\`\``);
    expect(result).toHaveLength(3);
  });

  it('拒绝数量或字段不完整的结果', () => {
    expect(() => parseStoryOptions(JSON.stringify({ options: [option] }))).toThrow();
    expect(() => parseStoryOptions(JSON.stringify({ options: [{ ...option, logline: '' }, option, option] }))).toThrow();
  });
});

describe('parseMasterOutline', () => {
  const phase = {
    title: '建立旧世界', purpose: '建立人物和问题', chapterRange: '1-20章',
    keyEvents: ['事件一', '事件二', '事件三'], turningPoint: '主角无法回头', emotionTrend: '平稳转紧张',
  };
  const outline = {
    premise: '核心前提', ending: '结局方向', protagonistArc: '人物变化', centralConflict: '主要对抗',
    structureModel: '五阶段结构', phases: [phase, phase, phase, phase],
    subplots: ['关系副线', '秘密副线'], storyPromises: ['兑现能力成长', '兑现核心谜团'],
  };

  it('接受包含四个阶段的完整总纲', () => {
    expect(parseMasterOutline(JSON.stringify(outline)).phases).toHaveLength(4);
  });

  it('拒绝阶段或故事承诺不足的总纲', () => {
    expect(() => parseMasterOutline(JSON.stringify({ ...outline, phases: [phase] }))).toThrow();
    expect(() => parseMasterOutline(JSON.stringify({ ...outline, storyPromises: [] }))).toThrow();
  });
});
