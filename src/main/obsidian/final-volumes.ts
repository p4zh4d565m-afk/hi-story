import type { VolumeOutline } from '../../renderer/types';

/**
 * P0-1 最终卷列表：严格按动作语义计算最终卷列表。
 * - keep：数据库已有卷，允许为空（不回退来源卷）。
 * - fill：数据库非空取数据库卷，否则取来源卷。
 * - replace：本次选中来源卷。
 * - clear：空数组。
 */
export function computeFinalVolumes(
  action: 'keep' | 'fill' | 'replace' | 'clear',
  dbVolumes: VolumeOutline[],
  sourceVolumes: VolumeOutline[],
): VolumeOutline[] {
  switch (action) {
    case 'keep': return dbVolumes;
    case 'fill': return dbVolumes.length ? dbVolumes : sourceVolumes;
    case 'replace': return sourceVolumes;
    case 'clear': return [];
  }
}
