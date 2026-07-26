/**
 * 语义搜索桥接模块
 * 通过 child_process 启动 Python 微服务，stdin/stdout JSON 行协议通信
 * 支持：语义重排序、向量索引初始化、向量搜索、编码建索引
 * 超时降级，异常回退到原排序
 */

import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';

let pythonProcess: ChildProcess | null = null;
let pendingRequests: Map<
  string,
  { resolve: (data: any) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }
> = new Map();
let requestId = 0;

/**
 * 获取或创建 Python 进程（懒启动）
 */
export function getPythonProcess(): ChildProcess {
  if (pythonProcess && !pythonProcess.killed) {
    return pythonProcess;
  }

  const scriptPath = path.join(__dirname, '..', '..', '..', '..', 'semantic_reranker.py');
  const altPath = path.join(process.resourcesPath || '', 'semantic_reranker.py');
  const actualScript = fs.existsSync(scriptPath) ? scriptPath
    : fs.existsSync(altPath) ? altPath
    : scriptPath;

  console.log('[VectorSearch] 启动 Python 服务:', actualScript);

  pythonProcess = spawn('python', [actualScript], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  });

  let stderrBuffer = '';
  pythonProcess.stderr?.on('data', (data: Buffer) => {
    stderrBuffer += data.toString();
    if (stderrBuffer.includes('\n')) {
      const lines = stderrBuffer.split('\n').filter(Boolean);
      for (const line of lines) {
        console.log('[VectorSearch]', line.trim());
      }
      stderrBuffer = lines[lines.length - 1] || '';
    }
  });

  let stdoutBuffer = '';
  pythonProcess.stdout?.on('data', (data: Buffer) => {
    stdoutBuffer += data.toString();
    const lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line.trim());
        const rid = parsed._requestId;
        const pending = pendingRequests.get(rid);
        if (pending) {
          clearTimeout(pending.timer);
          pendingRequests.delete(rid);
          pending.resolve(parsed);
        }
      } catch {
        // 忽略非 JSON 行
      }
    }
  });

  pythonProcess.on('exit', (code) => {
    console.log('[VectorSearch] Python 进程退出, code:', code);
    for (const [rid, pending] of pendingRequests) {
      clearTimeout(pending.timer);
      pending.resolve(null);
    }
    pendingRequests.clear();
    pythonProcess = null;
  });

  pythonProcess.on('error', (err) => {
    console.error('[VectorSearch] Python 进程错误:', err.message);
  });

  return pythonProcess;
}

/**
 * 通用请求发送（action + payload → 等待响应）
 */
function sendRequest(payload: Record<string, unknown>, timeoutMs: number = 30000): Promise<any> {
  const proc = getPythonProcess();
  if (!proc || proc.killed) return Promise.resolve(null);

  const rid = String(++requestId);
  const fullPayload = { ...payload, _requestId: rid };

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(rid);
      console.warn('[VectorSearch] 超时:', payload.action);
      resolve(null);
    }, timeoutMs);

    pendingRequests.set(rid, { resolve, reject: () => resolve(null), timer });

    try {
      proc.stdin?.write(JSON.stringify(fullPayload) + '\n');
    } catch (err) {
      clearTimeout(timer);
      pendingRequests.delete(rid);
      console.warn('[VectorSearch] 写入失败');
      resolve(null);
    }
  });
}

// ═══════════════════════════════════════════════════
// 公开 API
// ═══════════════════════════════════════════════════

/**
 * 语义重排序（保留兼容旧接口）
 */
export async function semanticRerank(
  query: string,
  candidates: string[],
  topK: number = 20,
  timeoutMs: number = 5000,
): Promise<Array<{ sentence: string; score: number }> | null> {
  if (!candidates || candidates.length <= 5) {
    return candidates.map(s => ({ sentence: s, score: 1.0 }));
  }

  const res = await sendRequest({ action: 'rerank', query, candidates, top_k: topK }, timeoutMs);
  if (!res || !res.ranked) return null;

  // 从 Python 响应转换
  return (res.ranked as Array<{ sentence: string; score: number }>).map(r => ({
    sentence: r.sentence,
    score: r.score,
  }));
}

/**
 * 初始化向量索引（从 DB 加载所有 embedding → 传给 Python 构建内存索引）
 */
export async function buildIndex(
  userChunkIds: string[],
  userEmbeddings: string[],  // base64 BLOB
  litRowIds: number[],
  litEmbeddings: string[],  // base64 BLOB
): Promise<{ userCount: number; litCount: number } | null> {
  const res = await sendRequest({
    action: 'init_index',
    user_chunk_ids: userChunkIds,
    user_embeddings: userEmbeddings,
    lit_row_ids: litRowIds,
    lit_embeddings: litEmbeddings,
  }, 60000); // 大量数据可能较慢

  if (!res || res.status !== 'ok') return null;
  return res.indexSize as { userCount: number; litCount: number };
}

/**
 * 向量语义搜索
 * @returns [{id: "user:chunkId" 或 "lit:litRowid", score}, ...] 或 null
 */
export async function vectorSearch(
  query: string,
  topK: number = 50,
  timeoutMs: number = 10000,
): Promise<Array<{ id: string; score: number }> | null> {
  const res = await sendRequest({ action: 'search', query, top_k: topK }, timeoutMs);
  if (!res || !res.results) return null;
  return res.results as Array<{ id: string; score: number }>;
}

/**
 * 编码一批文本为向量（返回 base64 BLOB 数组），并加入 Python 内存索引
 */
export async function encodeAndIndex(
  texts: string[],
  chunkIds: string[],
): Promise<string[] | null> {
  const res = await sendRequest({
    action: 'encode_and_index',
    texts,
    chunk_ids: chunkIds,
  }, 60000);

  if (!res || !res.blobs) return null;
  return res.blobs as string[];
}

/**
 * 检查 Python 进程是否就绪（等待模型加载完成，最长等 120 秒）
 */
export async function pingPython(): Promise<boolean> {
  const res = await sendRequest({ action: 'ping' }, 120000);
  return res?.status === 'ok';
}

/**
 * 关闭 Python 进程（应用退出时调用）
 */
export function shutdownReranker(): void {
  if (pythonProcess && !pythonProcess.killed) {
    try {
      pythonProcess.stdin?.write(JSON.stringify({ action: 'shutdown', _requestId: '0' }) + '\n');
      setTimeout(() => {
        if (pythonProcess && !pythonProcess.killed) pythonProcess.kill();
      }, 2000);
    } catch {
      pythonProcess.kill();
    }
  }
}
