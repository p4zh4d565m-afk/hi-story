import { describe, expect, it } from 'vitest';
import { parseStoryOptions } from '../../src/renderer/services/ai-prompts/planning';

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
