export function normalizeStreamProjectId(value: unknown): string {
  const pid = String(value ?? '').trim();
  if (!pid) throw new Error('缺少 projectId，无法启动可取消的 AI 流');
  return pid;
}
