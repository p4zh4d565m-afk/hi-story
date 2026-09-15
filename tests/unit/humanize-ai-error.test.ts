import { describe, it, expect } from 'vitest';
import {
  humanizeAiError,
  streamEndDisplay,
  AI_STOPPED_MESSAGE,
  AI_IGNORED_MESSAGE,
} from '../../src/renderer/services/ai.service';

describe('humanizeAiError — 把底层英文串翻译成友好中文', () => {
  it('空串给通用提示', () => {
    expect(humanizeAiError('')).toBe('AI 请求失败，请稍后重试');
  });

  it('已是中文的错误透传，不吞掉业务信息', () => {
    expect(humanizeAiError('AI 返回格式解析失败：xxx')).toBe('AI 返回格式解析失败：xxx');
  });

  it('401 映射到 API Key 无效', () => {
    expect(humanizeAiError('401 Unauthorized')).toContain('API Key 无效');
    expect(humanizeAiError('invalid api key')).toContain('API Key 无效');
  });

  it('403 映射到拒绝访问', () => {
    expect(humanizeAiError('403 Forbidden')).toContain('API 拒绝访问');
  });

  it('429 映射到频率过高', () => {
    expect(humanizeAiError('429 Too Many Requests')).toContain('请求过于频繁');
  });

  it('超时映射到请求超时', () => {
    expect(humanizeAiError('ETIMEDOUT')).toContain('请求超时');
    expect(humanizeAiError('Request timed out')).toContain('请求超时');
  });

  it('网络错误：fetch failed 与 Failed to fetch 都能命中', () => {
    expect(humanizeAiError('fetch failed')).toContain('网络连接失败');
    expect(humanizeAiError('Failed to fetch')).toContain('网络连接失败');
    expect(humanizeAiError('ECONNREFUSED')).toContain('网络连接失败');
  });

  it('额度/余额不足映射到充值提示', () => {
    expect(humanizeAiError('insufficient_quota')).toContain('额度或余额不足');
  });

  it('abort 映射到请求已中止', () => {
    expect(humanizeAiError('The operation was aborted')).toContain('请求已中止');
  });

  it('未知英文串落通用提示，不透传原始串', () => {
    expect(humanizeAiError('some random vendor error')).toBe('AI 请求失败，请稍后重试');
  });
});

describe('streamEndDisplay — 流异常结束的展示决策', () => {
  it('切项目静默返回 null', () => {
    expect(streamEndDisplay(AI_IGNORED_MESSAGE, 'AI 写作失败：')).toBeNull();
  });

  it('主动停止提示已停止', () => {
    expect(streamEndDisplay(AI_STOPPED_MESSAGE, 'AI 写作失败：')).toBe('已停止生成，不会保存');
  });

  it('真实失败带前缀与友好中文', () => {
    expect(streamEndDisplay('Failed to fetch', '润色失败：')).toBe('润色失败：网络连接失败，请检查网络或 API 地址');
  });
});
