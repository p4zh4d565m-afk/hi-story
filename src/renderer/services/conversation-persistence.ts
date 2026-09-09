import type {
  ConversationMessage,
  ConversationSnapshot,
  ConversationThread,
  IpcResult,
  LegacyConversationData,
  LegacyMigrationResult,
} from '../types';

type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;
type LoadStatus = 'applied' | 'stale' | 'failed';

interface LegacyStorage {
  getItem(key: string): string | null;
  removeItem?(key: string): void;
}

interface ConversationLoaderOptions {
  invoke: Invoke;
  storage: LegacyStorage;
  onApply: (projectId: string, snapshot: ConversationSnapshot) => void;
  onError?: (projectId: string, error: unknown) => void;
  onLoadingChange?: (projectId: string, loading: boolean) => void;
  isProjectCurrent?: (projectId: string) => boolean;
}

export function createConversationLoader(options: ConversationLoaderOptions) {
  let generation = 0;
  let currentProjectId: string | null = null;

  const isCurrent = (projectId: string, requestGeneration: number) => (
    generation === requestGeneration
    && currentProjectId === projectId
    && (options.isProjectCurrent?.(projectId) ?? true)
  );

  return {
    invalidate(): void {
      generation += 1;
      currentProjectId = null;
    },
    async load(projectId: string): Promise<LoadStatus> {
      if (options.isProjectCurrent && !options.isProjectCurrent(projectId)) return 'stale';
      const requestGeneration = ++generation;
      currentProjectId = projectId;
      options.onLoadingChange?.(projectId, true);
      try {
        const raw = options.storage.getItem(`hi-story-threads-${projectId}`);
        const legacy = raw === null ? null : parseLegacyConversationData(raw);
        const migration = await options.invoke(
          'db:conversation:migrateLegacy', projectId, legacy,
        ) as IpcResult<LegacyMigrationResult>;
        if (!isCurrent(projectId, requestGeneration)) return 'stale';
        if (!migration?.success) throw new Error(migration?.error || '旧会话迁移失败');

        const response = await options.invoke(
          'db:conversation:findByProject', projectId,
        ) as IpcResult<ConversationSnapshot>;
        if (!isCurrent(projectId, requestGeneration)) return 'stale';
        if (!response?.success || !response.data) throw new Error(response?.error || '会话读取失败');
        let snapshot = response.data;
        if (snapshot.threads.length === 0) {
          const created = await options.invoke('db:conversation:createThread', {
            projectId,
            title: '默认对话',
            category: 'general',
          }) as IpcResult<ConversationThread>;
          if (!isCurrent(projectId, requestGeneration)) return 'stale';
          if (!created?.success || !created.data) throw new Error(created?.error || '默认会话创建失败');
          snapshot = { threads: [created.data], messages: { [created.data.id]: [] } };
        }
        options.onApply(projectId, snapshot);
        return 'applied';
      } catch (error) {
        if (!isCurrent(projectId, requestGeneration)) return 'stale';
        options.onError?.(projectId, error);
        return 'failed';
      } finally {
        if (isCurrent(projectId, requestGeneration)) options.onLoadingChange?.(projectId, false);
      }
    },
  };
}

export function parseLegacyConversationData(raw: string): LegacyConversationData {
  const parsed = JSON.parse(raw) as LegacyConversationData;
  if (!parsed || !Array.isArray(parsed.threads) || !parsed.messages || typeof parsed.messages !== 'object') {
    throw new Error('旧会话数据格式无效');
  }
  return parsed;
}

interface PersistAssistantStreamOptions {
  stream: AsyncGenerator<string>;
  onProgress: (text: string) => void;
  persist: (content: string) => Promise<ConversationMessage>;
}

export async function consumeAndPersistAssistantStream(
  options: PersistAssistantStreamOptions,
): Promise<ConversationMessage> {
  let fullText = '';
  for await (const text of options.stream) {
    fullText = text;
    options.onProgress(text);
  }
  if (!fullText.trim()) throw new Error('AI 未返回可保存内容');
  return options.persist(fullText);
}

interface PersistedConversationTurnOptions {
  persistUser: () => Promise<ConversationMessage>;
  createStream: (userMessage: ConversationMessage) => AsyncGenerator<string>;
  onUserPersisted: (message: ConversationMessage) => void;
  onProgress: (text: string) => void;
  persistAssistant: (content: string) => Promise<ConversationMessage>;
}

export async function runPersistedConversationTurn(
  options: PersistedConversationTurnOptions,
): Promise<{ userMessage: ConversationMessage; assistantMessage: ConversationMessage }> {
  const userMessage = await options.persistUser();
  options.onUserPersisted(userMessage);
  const assistantMessage = await consumeAndPersistAssistantStream({
    stream: options.createStream(userMessage),
    onProgress: options.onProgress,
    persist: options.persistAssistant,
  });
  return { userMessage, assistantMessage };
}
