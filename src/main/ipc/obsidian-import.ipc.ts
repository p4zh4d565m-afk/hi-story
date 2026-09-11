import { ipcMain } from 'electron';
import { createHash } from 'crypto';
import { getDb } from '../db/connection';
import { ObsidianImportRepo } from '../db/repositories/obsidian-import.repo';
import { validateObsidianCommitInput } from '../obsidian/import-validator';
import type { IpcResult, ObsidianCommitInput, ObsidianImportReparseInput } from '../../renderer/types';

/** 有界稳定序列化：递归排序对象键、保留数组顺序，遇到循环/超预算立即终止返回 null。
 * 预算按累计字节数计算，每次累加都通过 consume 检查，超限立即返回 false。
 * seen 是「当前递归栈」集合（进入对象 add、处理完 delete），只拒绝回到祖先对象的真环，
 * 不拒绝 DAG 中共享引用（如三个 layer 复用同一 decision 对象）。 */
function canonicalize(value: unknown, state: { bytes: number; seen: WeakSet<object> }, budget: number): string | null {
  if (value === null) { if (!consume(state, budget, 4)) return null; return 'null'; }
  const t = typeof value;
  if (t === 'string') {
    const s = JSON.stringify(value);
    if (!consume(state, budget, Buffer.byteLength(s, 'utf8'))) return null;
    return s;
  }
  if (t === 'number' || t === 'boolean') { const s = String(value); if (!consume(state, budget, s.length)) return null; return s; }
  if (t === 'undefined') { if (!consume(state, budget, 9)) return null; return 'undefined'; }
  if (t !== 'object') return null;

  // 递归栈循环检测：回到当前祖先对象才是真环；共享引用（DAG）放行
  if (state.seen.has(value as object)) return null;
  state.seen.add(value as object);
  try {
    if (Array.isArray(value)) {
      if (!consume(state, budget, 2)) return null; // 左右括号
      const parts: string[] = [];
      for (let i = 0; i < value.length; i++) {
        if (i > 0 && !consume(state, budget, 1)) return null; // 逗号
        const s = canonicalize(value[i], state, budget);
        if (s === null) return null;
        parts.push(s);
      }
      return `[${parts.join(',')}]`;
    }
    const keys = Object.keys(value as Record<string, unknown>).sort();
    if (!consume(state, budget, 2)) return null; // 左右花括号
    const parts: string[] = [];
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const ks = JSON.stringify(k);
      if (!consume(state, budget, Buffer.byteLength(ks, 'utf8') + 1)) return null; // key + 冒号
      if (i > 0 && !consume(state, budget, 1)) return null; // 逗号
      const s = canonicalize((value as Record<string, unknown>)[k], state, budget);
      if (s === null) return null;
      parts.push(`${ks}:${s}`);
    }
    return `{${parts.join(',')}}`;
  } finally {
    state.seen.delete(value as object);
  }
}

function consume(state: { bytes: number }, budget: number, n: number): boolean {
  state.bytes += n;
  return state.bytes <= budget;
}

/** 对 commit 输入做稳定指纹；超预算（64 MiB）、循环引用等返回 'invalid_input'。 */
export const INVALID_INPUT_FINGERPRINT = 'invalid_input';

export function hashCanonicalCommitInput(input: ObsidianCommitInput): string {
  try {
    const state = { bytes: 0, seen: new WeakSet<object>() };
    const canonical = canonicalize(input, state, 64 * 1024 * 1024);
    if (canonical === null) return INVALID_INPUT_FINGERPRINT;
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
