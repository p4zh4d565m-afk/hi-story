import type { CharacterKnowledge, IpcResult, StoryFact } from '../types';

type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;
type LoadStatus = 'applied' | 'stale' | 'failed';

export interface AiRuntimeContextSnapshot {
  projectId: string;
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
    load: async (projectId: string): Promise<LoadStatus> => {
      if (options.isProjectCurrent && !options.isProjectCurrent(projectId)) return 'stale';
      const requestGeneration = ++generation;
      currentProjectId = projectId;
      try {
        const [narrativeRaw, factsRaw, knowledgeRaw] = await Promise.all([
          options.invoke('db:narrativeHooks:getContext', projectId),
          options.invoke('db:storyFacts:findRecentActive', projectId, 30),
          options.invoke('db:storyFacts:findAllKnowledgeByProject', projectId),
        ]);
        if (!isCurrent(projectId, requestGeneration)) return 'stale';

        const narrative = narrativeRaw as IpcResult<string>;
        const facts = factsRaw as IpcResult<StoryFact[]>;
        const knowledge = knowledgeRaw as IpcResult<CharacterKnowledge[]>;
        if (!narrative?.success) throw new Error(narrative?.error || '钩子与债务读取失败');
        if (!facts?.success || !Array.isArray(facts.data)) throw new Error(facts?.error || '事实读取失败');
        if (!knowledge?.success || !Array.isArray(knowledge.data)) {
          throw new Error(knowledge?.error || '人物知识读取失败');
        }

        options.onApply({
          projectId,
          narrativeContext: narrative.data || '',
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
