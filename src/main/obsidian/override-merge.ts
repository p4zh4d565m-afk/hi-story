import type { ImportCharacterOverride, ImportWorldOverride, ImportCharacterInput, ImportWorldInput } from '../../renderer/types';

/** 与仓储一致的 source key 归一化：NFKC + trim + lowercase。 */
export function sourceKey(name: string): string {
  return name.normalize('NFKC').trim().toLowerCase();
}

/**
 * R5 override 合并：按归一化 source key 对齐旧 override 与新 parser 草稿。
 * - 同 key 仍存在：保留作者 name/category/overwrite。
 * - 新 key：采用 parser 默认值。
 * - 消失 key：删除旧 override。
 */
export function mergeCharacterOverrides(
  oldList: ImportCharacterOverride[],
  newDrafts: ImportCharacterInput[],
): ImportCharacterOverride[] {
  const oldByKey = new Map(oldList.map(o => [sourceKey(o.sourceName), o]));
  return newDrafts.map(d => {
    const old = oldByKey.get(sourceKey(d.sourceName));
    return old
      ? { sourceName: d.sourceName, name: old.name, overwrite: old.overwrite }
      : { sourceName: d.sourceName, name: d.name, overwrite: false };
  });
}

export function mergeWorldOverrides(
  oldList: ImportWorldOverride[],
  newDrafts: ImportWorldInput[],
): ImportWorldOverride[] {
  const oldByKey = new Map(oldList.map(o => [sourceKey(o.sourceName), o]));
  return newDrafts.map(d => {
    const old = oldByKey.get(sourceKey(d.sourceName));
    return old
      ? { sourceName: d.sourceName, name: old.name, category: old.category, overwrite: old.overwrite }
      : { sourceName: d.sourceName, name: d.name, category: d.category as ImportWorldOverride['category'], overwrite: false };
  });
}
