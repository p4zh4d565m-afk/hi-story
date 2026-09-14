import type { CharacterKnowledge, IpcResult, StoryFact } from '../types';

type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;
type LoadStatus = 'applied' | 'stale' | 'failed';

export type AiRuntimeLoadOptions = {
  /** 默认 chat */
  taskType?: 'write' | 'review' | 'chat' | 'planning';
  targetChapterId?: string | null;
  hasActiveChapter?: boolean;
};

export interface AiRuntimeContextSnapshot {
  projectId: string;
  /** as-of 折叠后的有界文本（含事实/钩/债/知识摘要） */
  narrativeAsOfText: string;
  narrativeAsOfMode: string;
  /** 兼容旧字段：与 narrativeAsOfText 相同 */
  narrativeContext: string;
  storyFacts: StoryFact[];
  characterKnowledge: CharacterKnowledge[];
}

interface AiRuntimeContextLoaderOptions {
  invoke: Invoke;
  onApply: (snapshot: AiRuntimeContextSnapshot) => void;
  onError?: (projectId: string, error: unknown) => void;
  isProjectCurrent?: (projectId: string) => boolean;
}

export function createAiRuntimeContextLoader(options: AiRuntimeContextLoaderOptions) {
  let generation = 0;
  let currentProjectId: string | null = null;

  const isCurrent = (projectId: string, requestGeneration: number) => (
    generation === requestGeneration
    && currentProjectId === projectId
    && (options.isProjectCurrent?.(projectId) ?? true)
  );

  return {
    invalidate: () => {
      generation += 1;
      currentProjectId = null;
    },
    load: async (projectId: string, loadOpts?: AiRuntimeLoadOptions): Promise<LoadStatus> => {
      if (options.isProjectCurrent && !options.isProjectCurrent(projectId)) return 'stale';
      const requestGeneration = ++generation;
      currentProjectId = projectId;
      const taskType = loadOpts?.taskType ?? 'chat';
      const targetChapterId = loadOpts?.targetChapterId ?? null;
      const hasActiveChapter = loadOpts?.hasActiveChapter ?? !!targetChapterId;
      try {
        const [asOfRaw, factsRaw, knowledgeRaw] = await Promise.all([
          options.invoke('db:narrative:buildAsOfContext', {
            projectId,
            taskType,
            targetChapterId,
            hasActiveChapter,
          }),
          options.invoke('db:storyFacts:findRecentActive', projectId, 30),
          options.invoke('db:storyFacts:findAllKnowledgeByProject', projectId),
        ]);
        if (!isCurrent(projectId, requestGeneration)) return 'stale';

        const asOf = asOfRaw as IpcResult<{ mode: string; textBlock: string; historyWarningCount: number }>;
        const facts = factsRaw as IpcResult<StoryFact[]>;
        const knowledge = knowledgeRaw as IpcResult<CharacterKnowledge[]>;
        if (!asOf?.success || !asOf.data) throw new Error(asOf?.error || '叙事截面读取失败');
        if (!facts?.success || !Array.isArray(facts.data)) throw new Error(facts?.error || '事实读取失败');
        if (!knowledge?.success || !Array.isArray(knowledge.data)) {
          throw new Error(knowledge?.error || '人物知识读取失败');
        }

        options.onApply({
          projectId,
          narrativeAsOfText: asOf.data.textBlock,
          narrativeAsOfMode: asOf.data.mode,
          narrativeContext: asOf.data.textBlock,
          storyFacts: facts.data,
          characterKnowledge: knowledge.data,
        });
        return 'applied';
      } catch (error) {
        if (!isCurrent(projectId, requestGeneration)) return 'stale';
        options.onError?.(projectId, error);
        return 'failed';
      }
    },
  };
}
