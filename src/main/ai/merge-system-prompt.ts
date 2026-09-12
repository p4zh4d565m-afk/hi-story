import type { ChatMessage } from './provider';

/**
 * 把 ChatOptions.systemPrompt 合并进消息列表，与 Claude 现有语义一致。
 * OpenAI 兼容供应商此前忽略该字段；抽成纯函数让两端共用同一套拼接逻辑。
 *
 * - extra 为空 → 原样返回 messages（不新建数组）。
 * - extra 非空 → 把 messages 里所有 system 合并为一条（extra 前缀在前），
 *   其余非 system 消息保持原顺序。
 */
export function mergeSystemPrompt(messages: ChatMessage[], extra?: string): ChatMessage[] {
  if (!extra) return messages;
  const system = messages.filter(m => m.role === 'system');
  const rest = messages.filter(m => m.role !== 'system');
  const systemContent = system.length ? system.map(m => m.content).join('\n\n') : '';
  const merged = extra + (systemContent ? '\n\n' + systemContent : '');
  return [{ role: 'system', content: merged }, ...rest];
}
