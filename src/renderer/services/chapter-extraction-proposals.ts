import type { CreativeDecisionDraft } from '../types';

/** 章节抽取出的原子事实（与 story_facts 的输入形状一致，无 projectId/chapterId） */
export interface ChapterExtractionFact {
  factType: string;
  subject: string;
  predicate: string;
  object: string;
  description: string;
}

/**
 * 把章节抽取里 `factType === 'hook'` 的事实映射为「叙事钩子」决策提议草稿。
 *
 * A5 钩子单轨：抽取到的钩子不再直接写入 story_facts + narrative_hooks 双写，
 * 而是进入 creative_decisions 的 proposed 状态，由作者在决策面板确认后投影。
 * 非 hook 事实仍走 batchUpsert 自动落库（在调用方过滤）。
 *
 * hookType 固定 foreshadowing、intensity 固定 3（与旧写章旁路一致）。
 * description 沿用旧旁路的拼法：`subject + predicate + object：description`。
 */
export function factsToHookDrafts(facts: ChapterExtractionFact[], chapterId: string): CreativeDecisionDraft[] {
  return facts
    .filter(f => f.factType === 'hook')
    .map(f => {
      const subject = f.subject ?? '';
      const description = `${subject}${f.predicate ?? ''}${f.object ?? ''}：${f.description ?? ''}`;
      return {
        type: 'narrative_hook' as const,
        title: subject || '叙事钩子',
        rationale: `章节抽取：${chapterId}`,
        payload: {
          subject,
          hookType: 'foreshadowing' as const,
          description,
          intensity: 3,
          chapterId,
        },
      };
    });
}
