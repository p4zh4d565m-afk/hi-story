import { describe, it, expect } from 'vitest';
import { factsToHookDrafts } from '../../src/renderer/services/chapter-extraction-proposals';

describe('factsToHookDrafts', () => {
  it('只把 factType === hook 的映射为钩子提议，非 hook 被过滤', () => {
    const drafts = factsToHookDrafts([
      { factType: 'hook', subject: '神秘人', predicate: '留下', object: '一封信', description: '神秘人留下一封信' },
      { factType: 'event', subject: '主角', predicate: '进入', object: '密室', description: '主角进入密室' },
    ], 'ch1');
    expect(drafts).toHaveLength(1);
    expect(drafts[0].type).toBe('narrative_hook');
  });

  it('description 沿用旧旁路拼法 subject+predicate+object：description', () => {
    const [draft] = factsToHookDrafts([
      { factType: 'hook', subject: '神秘人', predicate: '留下', object: '一封信', description: '神秘人留下一封信' },
    ], 'ch1');
    expect(draft.payload).toMatchObject({
      subject: '神秘人',
      hookType: 'foreshadowing',
      intensity: 3,
      chapterId: 'ch1',
      description: '神秘人留下一封信：神秘人留下一封信',
    });
  });

  it('rationale 记录来源章节', () => {
    const [draft] = factsToHookDrafts([
      { factType: 'hook', subject: 'X', predicate: 'Y', object: 'Z', description: 'D' },
    ], 'chapter-42');
    expect(draft.rationale).toBe('章节抽取：chapter-42');
  });

  it('无 hook 事实时返回空数组', () => {
    expect(factsToHookDrafts([
      { factType: 'event', subject: 'a', predicate: 'b', object: 'c', description: 'd' },
    ], 'ch1')).toEqual([]);
  });
});
