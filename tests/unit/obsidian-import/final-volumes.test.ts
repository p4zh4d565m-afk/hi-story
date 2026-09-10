import { describe, expect, it } from 'vitest';
import { computeFinalVolumes } from '../../../src/main/obsidian/final-volumes';
import type { VolumeOutline } from '../../../src/renderer/types';

const vol = (title: string, chapterRange = ''): VolumeOutline => ({
  title, chapterRange, volumeGoal: '', openingState: '', mainProgression: '',
  characterProgression: '', keyEvents: [], climax: '', endingState: '', promisesOpened: [], promisesPaid: [],
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
