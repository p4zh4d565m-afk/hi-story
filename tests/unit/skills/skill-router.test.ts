import { describe, expect, it } from 'vitest';
import { routeWritingSkills } from '../../../src/main/skills/skill-router';
import type { WritingSkillSummary } from '../../../src/main/skills/skill-registry';

const skills: WritingSkillSummary[] = [
  { id: 'premise-craft', name: 'premise-craft', description: '选题与卖点', tags: 'premise' },
  { id: 'story-structure-craft', name: 'story-structure-craft', description: '主线结构', tags: 'structure' },
  { id: 'outline-workflow-craft', name: 'outline-workflow-craft', description: '大纲流程', tags: 'outline' },
  { id: 'character-craft', name: 'character-craft', description: '人物塑造', tags: 'character' },
  { id: 'pacing-emotion-craft', name: 'pacing-emotion-craft', description: '节奏与情绪', tags: 'pacing' },
];

describe('routeWritingSkills', () => {
  it('为全书大纲任务优先选择结构与大纲方法', () => {
    const result = routeWritingSkills(skills, '帮我生成全书总纲和分卷大纲');
    expect(result.map(item => item.id)).toEqual([
      'outline-workflow-craft',
      'story-structure-craft',
    ]);
  });

  it('限制返回数量并拒绝空任务', () => {
    expect(routeWritingSkills(skills, '设计主角人物和动机', 1)).toHaveLength(1);
    expect(routeWritingSkills(skills, '   ')).toEqual([]);
  });

  it('把连续章节的爽感疲劳路由到节奏与情绪', () => {
    const result = routeWritingSkills(skills, '连续十章都在打架，爽感疲劳，帮我调整节奏', 1);
    expect(result[0]?.id).toBe('pacing-emotion-craft');
  });
});
