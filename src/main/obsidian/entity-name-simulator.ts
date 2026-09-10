import type { ImportCharacterInput, ImportWorldInput } from '../../renderer/types';

/** 与仓储一致的归一化：NFKC + trim + lowercase。 */
export function normalizeEntityName(value: unknown): string {
  return String(value ?? '').normalize('NFKC').trim().toLowerCase();
}

interface EntityRecord { name: string }
interface IncomingEntity { sourceName: string; name: string; overwrite: boolean }

/**
 * R2 最终实体名称模拟：对人物与世界观执行同一算法。
 * 模拟「本次实际写入后的最终数据库状态」，检出三类冲突：
 * 两个来源改同名、覆盖 A 改名为 B、与现有记录归一化变体重名。
 *
 * 身份用归一化名称表示（名称本就唯一）。规则：
 * - sourceName 命中现有记录且 overwrite=false → skip，不改最终状态、不参与冲突。
 * - sourceName 命中且 overwrite=true → update：先释放自身旧名，再占用最终 name。
 * - sourceName 未命中 → create：占用最终 name。
 * - 任一 update/create 的最终名称被其他身份占用，返回 error。
 */
export function simulateFinalEntityNames(kind: '人物' | '世界观', existing: EntityRecord[], incoming: IncomingEntity[]): { error?: string } {
  // 归一化名 -> 身份（用归一化名自身表示）
  const map = new Map<string, string>();
  for (const e of existing) {
    const k = normalizeEntityName(e.name);
    if (k && !map.has(k)) map.set(k, k);
  }

  for (const item of incoming) {
    const sourceKey = normalizeEntityName(item.sourceName);
    const isExisting = map.has(sourceKey);

    if (isExisting && !item.overwrite) continue; // skip，不参与最终状态

    const finalKey = normalizeEntityName(item.name);
    if (!finalKey) return { error: `${kind}导入名不能为空` };

    if (isExisting) {
      // update：先释放自身旧名，再占用最终名
      map.delete(sourceKey);
      if (map.has(finalKey)) return { error: `${kind}最终名称「${item.name}」与另一记录重名` };
      map.set(finalKey, finalKey);
    } else {
      // create
      if (map.has(finalKey)) return { error: `${kind}最终名称「${item.name}」与另一记录重名` };
      map.set(finalKey, finalKey);
    }
  }
  return {};
}

/** 从 ImportCharacterInput 数组提取模拟所需的最小字段。 */
export function characterIncoming(characters: ImportCharacterInput[]): IncomingEntity[] {
  return characters.map(c => ({ sourceName: c.sourceName, name: c.name, overwrite: c.overwrite }));
}

/** 从 ImportWorldInput 数组提取模拟所需的最小字段。 */
export function worldIncoming(worlds: ImportWorldInput[]): IncomingEntity[] {
  return worlds.map(w => ({ sourceName: w.sourceName, name: w.name, overwrite: w.overwrite }));
}
