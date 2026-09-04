import type { WritingSkillSummary } from './skill-registry';

const ROUTE_HINTS: Record<string, string[]> = {
  'premise-craft': ['创意', '选题', '卖点', '简介', '一句话', '目标读者', '脑洞'],
  'story-structure-craft': ['总纲', '主线', '结构', '三幕', '中点', '结局', '开篇'],
  'outline-workflow-craft': ['大纲', '分卷', '章纲', '章节', '提纲', '雪花', '改稿'],
  'scene-craft': ['场景', '这场戏', '水章', '过场', '转折', '目标'],
  'conflict-craft': ['冲突', '悬念', '反派', '阻力', '风险', '反转', '钩子'],
  'character-craft': ['人物', '角色', '主角', '配角', '人设', '动机', '成长', '黑化'],
  'dialogue-craft': ['对白', '台词', '对话', '潜台词', '语气'],
  'theme-craft': ['主题', '立意', '说教', '象征', '价值观'],
  'setting-craft': ['世界观', '设定', '背景', '势力', '地点'],
  'description-craft': ['描写', '画面', '感官', '环境', '外貌', '文笔'],
  'pov-craft': ['视角', 'POV', '第一人称', '第三人称', '叙述者'],
};

export function routeWritingSkills(
  skills: WritingSkillSummary[],
  task: string,
  limit = 3,
): WritingSkillSummary[] {
  const query = task.trim().toLowerCase();
  if (!query) return [];

  return skills
    .map(skill => {
      const searchable = `${skill.id} ${skill.name} ${skill.description} ${skill.tags}`.toLowerCase();
      const hints = ROUTE_HINTS[skill.id] || [];
      let score = hints.reduce((total, hint) => total + (query.includes(hint.toLowerCase()) ? 5 : 0), 0);
      for (const token of query.split(/[\s，。；、！？,.!?;:：]+/).filter(token => token.length >= 2)) {
        if (searchable.includes(token)) score += 1;
      }
      return { skill, score };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.skill.id.localeCompare(b.skill.id))
    .slice(0, Math.max(1, Math.min(limit, 5)))
    .map(item => item.skill);
}
