/**
 * 策划写库代数（P0 写仲裁）：per-project 内存 epoch，无 DB revision。
 *
 * 用途：同一个项目里，作者可以在 AI 长任务运行时继续编辑并保存；旧任务完成后
 * 若仍把启动时的 idea/requirements/下游纲写回数据库，会覆盖较新的成功保存。
 *
 * 规则：
 * - 用户成功 save / persist / 导入后 epoch +1（通过 reserve）。
 * - AI 长任务启动时 capture 当前 epoch；写库前 reserve(expectedEpoch) 比较，
 *   不一致返回 null（超时过期），不得发 save IPC。
 * - 失败不回滚 token，否则会让已过期 AI 结果复活。
 */

const epochs = new Map<string, number>();

export function capturePlanningWriteEpoch(projectId: string): number {
  return epochs.get(projectId) ?? 0;
}

/**
 * 在同一同步调用里完成「比较 + 递增」。expectedEpoch 未传时无条件 reserve（普通保存）。
 * 返回 null 表示已被更新过（过期），调用方不得继续写库。
 */
export function reservePlanningWrite(projectId: string, expectedEpoch?: number): number | null {
  const current = capturePlanningWriteEpoch(projectId);
  if (expectedEpoch !== undefined && current !== expectedEpoch) return null;
  const token = current + 1;
  epochs.set(projectId, token);
  return token;
}

export function isPlanningWriteCurrent(projectId: string, token: number): boolean {
  return capturePlanningWriteEpoch(projectId) === token;
}
