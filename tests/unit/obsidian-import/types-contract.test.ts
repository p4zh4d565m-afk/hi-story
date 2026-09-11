import { describe, expect, it } from 'vitest';
import { OBSIDIAN_IMPORT_SLOTS } from '../../../src/renderer/types';
import type {
  ImportChapterDraft,
  ObsidianCommitInput,
  ObsidianImportCandidate,
  ObsidianImportIssue,
  ObsidianImportReparseInput,
} from '../../../src/renderer/types';

describe('Obsidian 导入类型契约', () => {
  it('导出稳定槽位并要求候选携带可编辑草稿', () => {
    expect(OBSIDIAN_IMPORT_SLOTS).toEqual(['master', 'volume', 'chapter', 'stage', 'character', 'world']);
    const candidate = {
      relativePath: '大纲/第一卷.md', hash: 'abc', name: '第一卷', kind: 'outline', slots: ['volume'],
      drafts: { master: null, volumes: [], chapters: [], stages: [], characters: [], worlds: [] }, issues: [],
    } satisfies ObsidianImportCandidate;
    expect(candidate.drafts.volumes).toEqual([]);
  });

  it('层级选择属于整次提交而不是单个文件', () => {
    const input = {
      projectId: 'p1', operationId: 'op1', selections: [],
      layerChoices: {
        master: { action: 'keep', unlockLocked: false },
        volumes: { action: 'fill', unlockLocked: false },
        chapters: { action: 'keep', unlockLocked: false },
      },
    } satisfies ObsidianCommitInput;
    expect(input.layerChoices.volumes.action).toBe('fill');
  });

  it('预览草稿允许待作者修正，阻塞项不能伪装成普通警告', () => {
    const draft = { sourceHeading: '序章', chapterNumber: null, volumeIndex: null, title: '雨夜', pov: '', chapterGoal: '', openingSituation: '', centralConflict: '', keyBeats: [], reveal: '', characterChange: '', emotionalBeat: '', payoff: '', endingHook: '' } satisfies ImportChapterDraft;
    const issue = { code: 'missing_assignment', severity: 'blocking', message: '请选择卷和章节号' } satisfies ObsidianImportIssue;
    const reparse = { projectId: 'p1', relativePath: '大纲/序章.md', hash: 'abc', slots: ['chapter'], defaultVolumeIndex: 0 } satisfies ObsidianImportReparseInput;
    expect(draft.chapterNumber).toBeNull();
    expect(issue.severity).toBe('blocking');
    expect(reparse.defaultVolumeIndex).toBe(0);
  });

  it('上游替换可以显式清空下游', () => {
    const input = {
      projectId: 'p1', operationId: 'op-clear', selections: [],
      layerChoices: {
        master: { action: 'replace', unlockLocked: true },
        volumes: { action: 'clear', unlockLocked: true },
        chapters: { action: 'clear', unlockLocked: true },
      },
    } satisfies ObsidianCommitInput;
    expect(input.layerChoices.chapters.action).toBe('clear');
  });
});
