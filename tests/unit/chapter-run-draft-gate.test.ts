import { describe, it, expect } from 'vitest';
import { resolvePostChatRunStatus } from '../../src/main/ai/chapter-run-draft-gate';

describe('resolvePostChatRunStatus — chat 返回后落草稿门禁', () => {
  it('已 abort → cancelled（即使有正文也不落 drafted）', () => {
    expect(resolvePostChatRunStatus({ aborted: true, draft: '很长的正文' })).toBe('cancelled');
  });

  it('cancel_requested → cancelled（abort 竞态兜底）', () => {
    expect(resolvePostChatRunStatus({
      aborted: false,
      cancelRequested: true,
      draft: '正文',
    })).toBe('cancelled');
  });

  it('未 abort + 空草稿 → failed', () => {
    expect(resolvePostChatRunStatus({ aborted: false, draft: '' })).toBe('failed');
    expect(resolvePostChatRunStatus({ aborted: false, draft: '   ' })).toBe('failed');
    expect(resolvePostChatRunStatus({ aborted: false, draft: null })).toBe('failed');
  });

  it('未 abort + 非空草稿 → drafted', () => {
    expect(resolvePostChatRunStatus({ aborted: false, draft: '正文' })).toBe('drafted');
  });
});
