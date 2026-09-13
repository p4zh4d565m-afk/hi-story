import { describe, it, expect } from 'vitest';
import { normalizeStreamProjectId } from '../../src/main/ai/stream-project-id';

describe('normalizeStreamProjectId', () => {
  it('去掉首尾空白', () => {
    expect(normalizeStreamProjectId(' p1 ')).toBe('p1');
  });

  it('空值抛出现有缺少 projectId 错误', () => {
    expect(() => normalizeStreamProjectId('')).toThrow('缺少 projectId，无法启动可取消的 AI 流');
    expect(() => normalizeStreamProjectId('   ')).toThrow('缺少 projectId，无法启动可取消的 AI 流');
    expect(() => normalizeStreamProjectId(undefined)).toThrow('缺少 projectId，无法启动可取消的 AI 流');
  });
});
