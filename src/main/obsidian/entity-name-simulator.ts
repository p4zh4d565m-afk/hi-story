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
 * 身份用归一化名称表示（名称本就唯一）。两阶段算法（顺序无关）：
 * 1. 先识别全部 skip/update/create，并一次性释放所有 update 的旧身份。
 * 2. 再对全部 update/create 的最终名称统一占位和查重。
 * 交换改名（A→B、B→A）与链式改名（A→B、B→C）都应判定为合法，不因输入顺序误报。
 */
export function simulateFinalEntityNames(kind: '人物' | '世界观', existing: EntityRecord[], incoming: IncomingEntity[]): { error?: string } {
  // 归一化名 -> 身份（用归一化名自身表示）
  const map = new Map<string, string>();
  for (const e of existing) {
    const k = normalizeEntityName(e.name);
    if (k && !map.has(k)) map.set(k, k);
  }

  // 阶段 0：空名校验（对所有 update/create 提前做，避免半途报错顺序敏感）
  const ops: Array<{ kind: 'skip' | 'update' | 'create'; sourceKey: string; finalKey: string }> = [];
  for (const item of incoming) {
    const sourceKey = normalizeEntityName(item.sourceName);
    const isExisting = map.has(sourceKey);
    if (isExisting && !item.overwrite) {
      ops.push({ kind: 'skip', sourceKey, finalKey: sourceKey });
      continue;
    }
    const finalKey = normalizeEntityName(item.name);
    if (!finalKey) return { error: `${kind}导入名不能为空` };
    ops.push({ kind: isExisting ? 'update' : 'create', sourceKey, finalKey });
  }

  // 阶段 1：一次性释放所有 update 的旧身份（不查重、不占位）
  for (const op of ops) {
    if (op.kind === 'update') map.delete(op.sourceKey);
  }

  // 阶段 2：对全部 update/create 统一占位和查重
  for (const op of ops) {
    if (op.kind === 'skip') continue;
    if (map.has(op.finalKey)) return { error: `${kind}最终名称「${op.finalKey}」与另一记录重名` };
    map.set(op.finalKey, op.finalKey);
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
