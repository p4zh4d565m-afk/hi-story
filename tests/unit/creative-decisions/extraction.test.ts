import { describe, expect, it } from 'vitest';
import {
  buildDecisionExtractionMessages,
  parseDecisionDrafts,
} from '../../../src/renderer/services/creative-decision-extraction';

describe('创作决策 AI 提取器', () => {
  it('解析纯 JSON 的事实提议', () => {
    const text = JSON.stringify([{
      type: 'story_fact',
      title: '主角抵达旧车站',
      rationale: '后续位置必须保持一致',
      payload: {
        factType: 'location', subject: '林岚', predicate: '位于', object: '旧车站',
        description: '林岚抵达旧车站', chapterId: null,
      },
    }]);

    expect(parseDecisionDrafts(text)).toEqual([{
      type: 'story_fact',
      title: '主角抵达旧车站',
      rationale: '后续位置必须保持一致',
      payload: {
        factType: 'location', subject: '林岚', predicate: '位于', object: '旧车站',
        description: '林岚抵达旧车站', chapterId: null,
      },
    }]);
  });

  it('去除唯一一层 Markdown JSON 围栏', () => {
    const fencedHook = '```json\n[{"type":"narrative_hook","title":"失踪者线索","rationale":"后续需要回收","payload":{"hookType":"foreshadowing","description":"旧车站留下带血车票","intensity":4}}]\n```';
    expect(parseDecisionDrafts(fencedHook)).toEqual([{
      type: 'narrative_hook',
      title: '失踪者线索',
      rationale: '后续需要回收',
      payload: {
        hookType: 'foreshadowing',
        description: '旧车站留下带血车票',
        intensity: 4,
      },
    }]);
  });

  it('拒绝非法类型且给出中文错误', () => {
    expect(() => parseDecisionDrafts('[{"type":"sql"}]'))
      .toThrow('不支持的决策类型');
  });

  it('缺少字段、强度越界或夹杂非法条目时整体拒绝', () => {
    expect(() => parseDecisionDrafts(JSON.stringify([{
      type: 'story_fact', title: '缺少载荷', rationale: '无载荷',
    }]))).toThrow('决策载荷无效');
    expect(() => parseDecisionDrafts(JSON.stringify([{
      type: 'narrative_hook', title: '越界强度', rationale: '测试',
      payload: { hookType: 'mystery', description: '谜团', intensity: 6 },
    }]))).toThrow('钩子强度必须是 1 到 5 的整数');
    expect(() => parseDecisionDrafts(JSON.stringify([
      {
        type: 'narrative_debt', title: '合法项', rationale: '需要兑现',
        payload: { debtType: 'payoff', description: '回收车票' },
      },
      { type: 'sql' },
    ]))).toThrow('不支持的决策类型');
  });

  it('空数组表示没有可创建的提议', () => {
    expect(parseDecisionDrafts('[]')).toEqual([]);
  });

  it('提示词限定 JSON、四种类型并禁止把猜测当事实', () => {
    const messages = buildDecisionExtractionMessages('也许站长是凶手。');

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('仅返回 JSON 数组');
    expect(messages[0].content).toContain('story_fact');
    expect(messages[0].content).toContain('character_knowledge');
    expect(messages[0].content).toContain('narrative_hook');
    expect(messages[0].content).toContain('narrative_debt');
    expect(messages[0].content).toContain('不能把猜测');
    expect(messages[1]).toEqual({ role: 'user', content: '也许站长是凶手。' });
  });
});
