import type { ObsidianCommitInput, ObsidianImportSlot, WorldEntry } from '../../renderer/types';
import { IMPORT_LIMITS } from './import-candidates';

export type ValidationResult<T> =
  | { valid: true; value: T }
  | { valid: false; error: string };

const SLOTS: ObsidianImportSlot[] = ['master', 'volume', 'chapter', 'character', 'world'];
const LAYER_ACTIONS = ['keep', 'fill', 'replace', 'clear'];
const WORLD_CATEGORIES = ['place', 'faction', 'race', 'law', 'history', 'culture'];
const STORY_OPTION_FIELDS = ['title', 'logline', 'targetReader', 'corePromise', 'protagonist', 'centralConflict', 'differentiator', 'endingDirection'] as const;

function fail(error: string): { valid: false; error: string } {
  return { valid: false, error };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/** 64 位小写十六进制 SHA-256。 */
function isSha256Hex(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
}

/** 对任意运行时对象做逐层结构校验，返回判别联合。 */
export function validateObsidianCommitInput(value: unknown): ValidationResult<ObsidianCommitInput> {
  if (!isPlainObject(value)) return fail('导入参数无效：输入必须是对象');

  const root = value as Record<string, unknown>;

  if (!isNonEmptyString(root.projectId)) return fail('参数错误：projectId 缺失或为空白字符串');
  if (!isNonEmptyString(root.operationId) || (root.operationId as string).length > 200) return fail('参数错误：operationId 长度须为 1—200');

  if (!Array.isArray(root.selections)) return fail('参数错误：selections 必须是数组');
  if (root.selections.length > IMPORT_LIMITS.maxCandidates) return fail(`参数错误：selections 数量超过上限 ${IMPORT_LIMITS.maxCandidates}`);

  for (let si = 0; si < root.selections.length; si++) {
    const sel = root.selections[si];
    if (!isPlainObject(sel)) return fail(`参数错误：selections[${si}] 必须是对象`);
    if (!isNonEmptyString(sel.relativePath)) return fail(`参数错误：selections[${si}].relativePath 缺失`);
    if (!isSha256Hex(sel.hash)) return fail(`参数错误：selections[${si}].hash 不是 64 位小写十六进制 SHA-256`);

    if (!Array.isArray(sel.slots)) return fail(`参数错误：selections[${si}].slots 必须是数组`);
    const seen = new Set<string>();
    for (const s of sel.slots) {
      if (!SLOTS.includes(s as ObsidianImportSlot)) return fail(`参数错误：selections[${si}].slots 含非法元素「${String(s)}」`);
      if (seen.has(s as string)) return fail(`参数错误：selections[${si}].slots 含重复元素「${String(s)}」`);
      seen.add(s as string);
    }

    const dvi = sel.defaultVolumeIndex;
    if (dvi !== null && dvi !== undefined && (!Number.isInteger(dvi) || (dvi as number) < 0)) {
      return fail(`参数错误：selections[${si}].defaultVolumeIndex 须为 null/undefined/非负整数`);
    }

    if (!Array.isArray(sel.characterOverrides)) return fail(`参数错误：selections[${si}].characterOverrides 必须是数组`);
    if (!Array.isArray(sel.worldOverrides)) return fail(`参数错误：selections[${si}].worldOverrides 必须是数组`);

    for (const ov of sel.characterOverrides) {
      if (!isPlainObject(ov)) return fail(`参数错误：selections[${si}].characterOverrides 含非法元素`);
      if (typeof ov.sourceName !== 'string' || typeof ov.name !== 'string') return fail(`参数错误：人物 override 的 sourceName/name 必须是字符串`);
      if (typeof ov.overwrite !== 'boolean') return fail(`参数错误：人物 override 的 overwrite 必须是布尔值`);
    }

    for (const ov of sel.worldOverrides) {
      if (!isPlainObject(ov)) return fail(`参数错误：selections[${si}].worldOverrides 含非法元素`);
      if (typeof ov.sourceName !== 'string' || typeof ov.name !== 'string') return fail(`参数错误：世界观 override 的 sourceName/name 必须是字符串`);
      if (typeof ov.overwrite !== 'boolean') return fail(`参数错误：世界观 override 的 overwrite 必须是布尔值`);
      if (!WORLD_CATEGORIES.includes(ov.category as WorldEntry['category'])) return fail(`参数错误：世界观 override 的 category 非法`);
    }
  }

  if (!isPlainObject(root.layerChoices)) return fail('参数错误：layerChoices 缺失');
  const lc = root.layerChoices as Record<string, unknown>;
  for (const layer of ['master', 'volumes', 'chapters'] as const) {
    const d = lc[layer];
    if (!isPlainObject(d)) return fail(`参数错误：layerChoices.${layer} 缺失`);
    if (!LAYER_ACTIONS.includes(d.action as string)) return fail(`参数错误：layerChoices.${layer}.action 非法`);
    if (typeof d.unlockLocked !== 'boolean') return fail(`参数错误：layerChoices.${layer}.unlockLocked 必须是布尔值`);
  }

  if (root.storyOptionDraft !== undefined) {
    if (!isPlainObject(root.storyOptionDraft)) return fail('参数错误：storyOptionDraft 必须是对象');
    for (const field of STORY_OPTION_FIELDS) {
      const fv = (root.storyOptionDraft as Record<string, unknown>)[field];
      if (fv !== undefined && typeof fv !== 'string') return fail(`参数错误：storyOptionDraft.${field} 必须是字符串`);
    }
  }

  return { valid: true, value: value as unknown as ObsidianCommitInput };
}
