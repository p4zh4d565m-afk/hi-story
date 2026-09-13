import type { IpcResult, PlanningIdea } from '../types';
import type { SavePlanningIdeaInput } from '../../main/db/repositories/planning.repo';
import { reservePlanningWrite } from './planning-write-epoch';

/**
 * 策划持久化（P0）：把 save IPC 抽成可测试的纯编排，在 invoke 前 reserve。
 *
 * 三种结果用判别联合表达，不用 null 混表：
 * - saved：写库成功且返回完整 PlanningIdea，携带 token（是否仍 current 由调用方判）。
 * - superseded：reserve 时发现已被更新过，不发 IPC（旧 AI 结果被拦截）。
 * - failed：IPC 失败 / reject / success 但缺 data。token 不回滚。
 */
export type PersistPlanningOutcome =
  | { kind: 'saved'; planning: PlanningIdea; token: number }
  | { kind: 'superseded' }
  | { kind: 'failed'; error: string; token: number };

type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;

export async function persistPlanning(
  invoke: Invoke,
  projectId: string,
  input: Omit<SavePlanningIdeaInput, 'projectId'>,
  options: { expectedEpoch?: number } = {},
): Promise<PersistPlanningOutcome> {
  const token = reservePlanningWrite(projectId, options.expectedEpoch);
  if (token === null) return { kind: 'superseded' };

  try {
    const res = (await invoke('db:planning:save', { projectId, ...input })) as IpcResult<PlanningIdea>;
    if (!res?.success || !res.data) {
      return { kind: 'failed', error: res?.error ?? '保存策划内容失败', token };
    }
    return { kind: 'saved', planning: res.data, token };
  } catch (err) {
    return { kind: 'failed', error: (err as Error).message, token };
  }
}
