import { describe, expect, it } from 'vitest';
import { computeFinalVolumes, overlayStages } from '../../../src/main/obsidian/final-volumes';
import type { VolumeOutline, ImportStageDraft } from '../../../src/renderer/types';

const vol = (title: string, chapterRange = ''): VolumeOutline => ({
  title, chapterRange, volumeGoal: '', openingState: '', mainProgression: '',
  characterProgression: '', keyEvents: [], climax: '', endingState: '', promisesOpened: [], promisesPaid: [],
});

const stage = (sourceHeading: string, volumeIndex: number | null, title: string): ImportStageDraft => ({
  sourceHeading, volumeIndex,
  stage: { title, chapterRange: '', goal: '', keyProgressions: [], characters: [], worldRefs: [], exit: '', endingHook: '' },
});

describe('computeFinalVolumes：P0-1 四种动作语义', () => {
  const db = [vol('数据库卷A', '第 1-10 章'), vol('数据库卷B', '第 11-20 章')];
  const src = [vol('来源卷X', '第 1-5 章')];

  it('keep：返回数据库已有卷（允许为空）', () => {
    expect(computeFinalVolumes('keep', db, src)).toEqual(db);
    expect(computeFinalVolumes('keep', [], src)).toEqual([]); // 数据库空 → 空，不回退来源卷
  });

  it('fill：数据库非空取数据库卷，空则取来源卷', () => {
    expect(computeFinalVolumes('fill', db, src)).toEqual(db);
    expect(computeFinalVolumes('fill', [], src)).toEqual(src);
  });

  it('replace：返回本次来源卷', () => {
    expect(computeFinalVolumes('replace', db, src)).toEqual(src);
  });

  it('clear：返回空数组（即使选中来源卷）', () => {
    expect(computeFinalVolumes('clear', db, src)).toEqual([]);
  });
});

describe('overlayStages：阶段归堆', () => {
  const base = [vol('卷A'), vol('卷B')];

  it('勾选阶段按 volumeIndex 写入对应卷 stages，整组替换不 merge', () => {
    const withOld = [vol('卷A'), { ...vol('卷B'), stages: [{ title: '旧1', chapterRange: '', goal: '', keyProgressions: [], characters: [], worldRefs: [], exit: '', endingHook: '' }, { title: '旧2', chapterRange: '', goal: '', keyProgressions: [], characters: [], worldRefs: [], exit: '', endingHook: '' }] }];
    const r = overlayStages(withOld, [stage('阶段1.md', 1, '新1')]);
    expect(r.error).toBeNull();
    expect(r.volumes[1].stages).toHaveLength(1); // 整组替换，非 3
    expect(r.volumes[1].stages![0].title).toBe('新1');
    expect(r.volumes[0].stages).toEqual([]); // 空桶保留 []
  });

  it('空桶保留已有 stages（不擦除）', () => {
    const withStages = [vol('卷A'), { ...vol('卷B'), stages: [{ title: '已有', chapterRange: '', goal: '', keyProgressions: [], characters: [], worldRefs: [], exit: '', endingHook: '' }] }];
    const r = overlayStages(withStages, [stage('阶段1.md', 0, '新')]);
    expect(r.volumes[1].stages).toHaveLength(1);
    expect(r.volumes[1].stages![0].title).toBe('已有');
  });

  it('扫描顺序阶段2早于阶段1时按阶段号排序', () => {
    const r = overlayStages(base, [stage('阶段2.md', 0, '二'), stage('阶段1.md', 0, '一')]);
    expect(r.volumes[0].stages!.map(s => s.title)).toEqual(['一', '二']);
  });

  it('未归属 / 越界 / 最终卷为空返回 error', () => {
    expect(overlayStages(base, [stage('阶段1.md', null, 'x')]).error).toContain('未指定归属卷');
    expect(overlayStages(base, [stage('阶段1.md', 5, 'x')]).error).toContain('越界');
    expect(overlayStages([], [stage('阶段1.md', 0, 'x')]).error).toContain('越界');
  });
});
