import { ipcMain } from 'electron';
import { createHash } from 'crypto';
import { getDb } from '../db/connection';
import { ObsidianImportRepo } from '../db/repositories/obsidian-import.repo';
import { validateObsidianCommitInput } from '../obsidian/import-validator';
import type { IpcResult, ObsidianCommitInput, ObsidianImportReparseInput } from '../../renderer/types';

/** 有界稳定序列化：递归排序对象键、保留数组顺序，遇到循环/超预算返回 null。 */
function canonicalize(value: unknown, budget: number): string | null {
  if (budget <= 0) return null;
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'string') return JSON.stringify(value);
  if (t === 'number' || t === 'boolean') return String(value);
  if (t === 'undefined') return 'undefined';
  if (t !== 'object') return null;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const item of value) {
      const s = canonicalize(item, budget - 1);
      if (s === null) return null;
      parts.push(s);
    }
    return `[${parts.join(',')}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts: string[] = [];
  for (const k of keys) {
    const s = canonicalize((value as Record<string, unknown>)[k], budget - 1);
    if (s === null) return null;
    parts.push(`${JSON.stringify(k)}:${s}`);
  }
  return `{${parts.join(',')}}`;
}

/** 对 commit 输入做稳定指纹；超预算（64 MiB）、循环引用等返回 'invalid_input'。 */
export const INVALID_INPUT_FINGERPRINT = 'invalid_input';

export function hashCanonicalCommitInput(input: ObsidianCommitInput): string {
  try {
    const canonical = canonicalize(input, 10000);
    if (canonical === null) return INVALID_INPUT_FINGERPRINT;
    const bytes = Buffer.byteLength(canonical, 'utf8');
    if (bytes > 64 * 1024 * 1024) return INVALID_INPUT_FINGERPRINT;
    return createHash('sha256').update(canonical).digest('hex');
  } catch {
    return INVALID_INPUT_FINGERPRINT;
  }
}

interface RegistryEntry {
  fingerprint: string;
  promise: Promise<IpcResult<any>>;
  completedAt?: number;
}

export function createOperationRegistry(options: { now?: () => number; ttlMs?: number; maxEntries?: number } = {}) {
  const map = new Map<string, RegistryEntry>();
  const nowFn = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? 10 * 60 * 1000;
  const maxEntries = options.maxEntries ?? 100;
  return {
    execute<T>(projectId: string, operationId: string, fingerprint: string, run: () => Promise<IpcResult<T>>): Promise<IpcResult<T>> {
      if (!operationId || operationId.length > 200) return Promise.resolve({ success: false, error: 'operationId 无效' });
      const key = `${projectId}:${operationId}`;
      const now = nowFn();
      for (const [oldKey, entry] of map) {
        if (entry.completedAt && now - entry.completedAt > ttlMs) map.delete(oldKey);
      }
      const existing = map.get(key);
      if (existing && existing.fingerprint !== fingerprint) return Promise.resolve({ success: false, error: 'operationId 已用于不同的导入内容' });
      if (existing) return existing.promise as Promise<IpcResult<T>>;
      const promise = Promise.resolve().then(run).then(result => {
        if (result.success) {
          const current = map.get(key);
          if (current) current.completedAt = nowFn();
          const completed = [...map.entries()].filter(([, e]) => e.completedAt !== undefined).sort((a, b) => (a[1].completedAt || 0) - (b[1].completedAt || 0));
          while (completed.length > maxEntries) { const oldest = completed.shift(); if (oldest) map.delete(oldest[0]); }
        } else {
          map.delete(key);
        }
        return result;
      }).catch(error => {
        map.delete(key);
        return { success: false, error: (error as Error).message } as IpcResult<T>;
      });
      map.set(key, { fingerprint, promise });
      return promise;
    },
    size: () => map.size,
  };
}

const registry = createOperationRegistry();

export function registerObsidianImportIpc(): void {
  ipcMain.handle('obsidian:preparePlanningImport', async (_event, projectId: string): Promise<IpcResult<unknown>> => {
    try {
      return await new ObsidianImportRepo(getDb()).prepare(projectId);
    } catch (e) { return { success: false, error: (e as Error).message }; }
  });

  ipcMain.handle('obsidian:reparsePlanningImport', async (_event, input: ObsidianImportReparseInput): Promise<IpcResult<unknown>> => {
    try { return await new ObsidianImportRepo(getDb()).reparse(input); }
    catch (e) { return { success: false, error: (e as Error).message }; }
  });

  ipcMain.handle('obsidian:commitPlanningImport', async (_event, input: ObsidianCommitInput): Promise<IpcResult<unknown>> => {
    try {
      // 运行时 DTO 校验必须先于 canonical hash 与幂等注册，明确区分参数错误与业务错误。
      const validated = validateObsidianCommitInput(input);
      if (!validated.valid) return { success: false, error: validated.error };

      const fingerprint = hashCanonicalCommitInput(validated.value);
      if (fingerprint === INVALID_INPUT_FINGERPRINT) {
        return { success: false, error: '导入参数无效' };
      }
      return await registry.execute(input.projectId, input.operationId, fingerprint, () => new ObsidianImportRepo(getDb()).commit(validated.value));
    } catch (e) {
      return { success: false, error: (e as Error).message || '导入参数无效' };
    }
  });
}
