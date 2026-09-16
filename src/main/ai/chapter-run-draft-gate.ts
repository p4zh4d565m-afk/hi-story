/**
 * 写章 start：provider.chat 返回后，是否允许把正文落成 drafted。
 * 已取消（signal abort 或 cancel_requested）则必须走 cancelled，禁止 markDrafted。
 */
export type PostChatRunStatus = 'cancelled' | 'failed' | 'drafted';

export function resolvePostChatRunStatus(input: {
  aborted: boolean;
  /** 主进程 cancel IPC 先写的库标记；abort 竞态兜底 */
  cancelRequested?: boolean;
  draft: string | null | undefined;
}): PostChatRunStatus {
  if (input.aborted || input.cancelRequested) return 'cancelled';
  if (!input.draft || input.draft.trim().length === 0) return 'failed';
  return 'drafted';
}
