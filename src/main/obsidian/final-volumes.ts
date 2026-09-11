import type { VolumeOutline, VolumeStage, ImportStageDraft } from '../../renderer/types';

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

/** 从阶段草稿的 sourceHeading（文件名，形如「阶段1-…」）提取阶段号，用于稳定排序；提取不到排最后。 */
function stageOrder(d: ImportStageDraft): number {
  const m = d.sourceHeading.match(/^阶段\s*(\d+)/);
  return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
}

/**
 * 阶段 overlay：把勾选的 stage 草稿按 volumeIndex 分桶写入最终卷列表的 stages。
 * - 整组替换该卷 stages（不与旧数组 merge）；未勾选的阶段不进入。
 * - 空桶保留该卷导入前的 stages ?? []（fill/replace 也不准用来源卷空数组擦除）。
 * - 未归属 / 越界 / 最终卷为空均返回 error。
 * 深拷贝最终卷列表，不改入参引用。
 */
export function overlayStages(finalVolumes: VolumeOutline[], stageDrafts: ImportStageDraft[]): { volumes: VolumeOutline[]; error: string | null } {
  const buckets = new Map<number, ImportStageDraft[]>();
  for (const d of stageDrafts) {
    const idx = d.volumeIndex;
    if (idx === null) return { volumes: finalVolumes, error: '阶段未指定归属卷' };
    if (!Number.isInteger(idx) || idx < 0) return { volumes: finalVolumes, error: '阶段卷归属非法' };
    if (finalVolumes.length === 0 || idx >= finalVolumes.length) {
      return { volumes: finalVolumes, error: `阶段卷归属越界：卷下标 ${idx}，最终仅 ${finalVolumes.length} 卷` };
    }
    if (!buckets.has(idx)) buckets.set(idx, []);
    buckets.get(idx)!.push(d);
  }

  const volumes: VolumeOutline[] = finalVolumes.map(v => ({ ...v, stages: (v.stages ?? []) as VolumeStage[] }));
  for (const [idx, drafts] of buckets) {
    const sorted = [...drafts].sort((a, b) => stageOrder(a) - stageOrder(b) || a.sourceHeading.localeCompare(b.sourceHeading, 'zh-CN'));
    volumes[idx].stages = sorted.map(d => d.stage);
  }
  return { volumes, error: null };
}
