// AI 流注册表（一期：真实取消）
// 进程内登记每个流式请求的 AbortController 与归属，供 ai:cancelStream 与窗口销毁时中止。
// 注意：API Key、完整提示词、正文不得写入本表或其日志。

export interface StreamEntry {
  controller: AbortController;
  senderId: number;
  projectId: string;
  /** 一期可空；三期写章运行记录必填 */
  runId?: string;
  /** 已标终止：之后的 Token / complete / error 一律丢弃 */
  terminal: boolean;
}

const streams = new Map<string, StreamEntry>();

/** 按 senderId 查找该窗口下的所有流（不删除，供窗口销毁前逐个 abort）。 */
function collectBySender(senderId: number): Array<{ id: string; entry: StreamEntry }> {
  const found: Array<{ id: string; entry: StreamEntry }> = [];
  for (const [id, entry] of streams) {
    if (entry.senderId === senderId) found.push({ id, entry });
  }
  return found;
}

export const streamRegistry = {
  register(id: string, entry: StreamEntry): void {
    streams.set(id, entry);
  },

  get(id: string): StreamEntry | undefined {
    return streams.get(id);
  },

  remove(id: string): void {
    streams.delete(id);
  },

  /** 标记终止（不删除，删除留给 onComplete/onError 终态或窗口销毁）。 */
  markTerminal(id: string): StreamEntry | undefined {
    const entry = streams.get(id);
    if (entry) entry.terminal = true;
    return entry;
  },

  /**
   * 取消前检查：streamId 必须存在、未终止，且 projectId 匹配。
   * 先标 terminal，再 abort，再从注册表删除，避免取消后条目永久残留。
   */
  cancel(id: string, projectId: string): boolean {
    const entry = streams.get(id);
    if (!entry || entry.terminal) return false;
    if (entry.projectId !== projectId) return false;
    entry.terminal = true;
    entry.controller.abort();
    streams.delete(id);
    return true;
  },

  /** 按 runId 取消（三期写章运行）：找到该 runId 对应流，校验 projectId 后 abort。 */
  cancelByRunId(runId: string, projectId: string): boolean {
    for (const [id, entry] of streams) {
      if (entry.runId === runId) {
        return this.cancel(id, projectId);
      }
    }
    return false;
  },

  /** 中止某窗口下所有未终止的流（窗口销毁用）。先 abort 再删，避免竞态。 */
  abortAllForSender(senderId: number): void {
    for (const { id, entry } of collectBySender(senderId)) {
      entry.terminal = true;
      entry.controller.abort();
      streams.delete(id);
    }
  },
};
