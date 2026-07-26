# 双路并行向量语义搜索 实现方案

> **对于代理工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 来逐个任务实现此方案。步骤使用 checkbox（- [ ]）语法进行跟踪。

**目标：** 为 hi-story 实现双路并行搜索架构：向量语义搜索（Python text2vec）与关键词 LIKE 搜索并行执行，合并去重后按语义相似度排序返回 top 20。

**架构：** Python 进程在启动时从 SQLite 加载所有 chunk 内容，使用 text2vec-base-chinese 模型编码为 768 维向量并常驻为 numpy 数组。在线搜索时，Node 侧同时发起两路查询：现有 LIKE 管道（同步）和 Python 向量搜索（异步），合并两路 top-50 候选池，通过 Python 语义重排序后返回 top 20。向量持久化在 SQLite BLOB 列中。

**技术栈：** Electron + React + SQLite (better-sqlite3) + Python (sentence-transformers, numpy) + child_process stdin/stdout JSON 行协议

## 全局约束

- sqlite-vss 在 Electron Windows 环境不可用，**禁止使用**
- literary.db 是只读库，不在其中建表或写入
- Python 进程通过 child_process.spawn 驻留运行，通信协议为 stdin/stdout JSON 行
- TypeScript + CommonJS main process，ESM renderer
- 所有 IPC handler 返回 IpcResult<T> 格式 { success, data? } / { success: false, error }
- text2vec-base-chinese 输出维度: 768 (float32 = 4 bytes/dim)
- float32 小端字节序 (IEEE 754)

---

## 文件结构规划

| 文件 | 操作 | 职责 |
|------|------|------|
| src/main/db/migrations.ts | 修改 | 新增 migration v6: embedding BLOB 列 + lit_embeddings 表 |
| src/main/db/repositories/reference.repo.ts | 修改 | 新增 getChunksByIds, getAllChunksForIndexing, getChunksWithoutEmbeddings, updateEmbedding, batchUpdateEmbeddings |
| src/main/ai/semantic-reranker.ts | 大幅修改 | 扩展 build_index, encode_and_index, search_vector, rerank_with_ids 协议; 索引状态管理 |
| semantic_reranker.py | 大幅修改 | 新增 VectorIndex 类: 内存 numpy 管理, build/add/search |
| src/main/ipc/reference.ipc.ts | 修改 | searchAll 双路并行: 关键词管道 + 向量搜索 |
| src/main/ipc/import.ipc.ts | 修改 | 导入后触发增量索引编码 |
| src/main/index.ts | 修改 | 启动时异步构建向量索引; before-quit 关闭 Python |
| scripts/copy-assets.js | 修改 | 新增 semantic_reranker.py 到 dist 的复制规则 |

### 不修改的文件（仅引用）

| 文件 | 用途 |
|------|------|
| src/renderer/App.tsx | 消费 searchAll 结果（接口不变） |
| src/renderer/components/ReferencePanel.tsx | 展示搜索结果（接口不变） |
| src/preload/index.ts | IPC 桥接（无需修改） |
| src/main/ai/similarity.ts | SimilarityResult / SearchAllResult 类型定义（无需修改） |

---

## 核心架构决策

### 1. 向量存储方式：SQLite BLOB 列（非 FAISS）

**决策：** 在 reference_chunks 新增 embedding BLOB 列（768 x 4 = 3072 字节/条），literary.db 的向量存在主数据库的 lit_embeddings 独立表中。

**理由：** sqlite-vss 不可用，FAISS 需要额外文件管理且 Windows 兼容性差。SQLite BLOB 简单可靠，与现有数据库生命周期一致（备份/迁移自然覆盖）。381 条文学记录 + 数百条用户 chunk 的向量总量不到 5MB，BLOB 方案完全够用。

### 2. Python 进程如何持有向量索引：内存 numpy 数组

**决策：** Python 进程启动时从 SQLite 加载（通过 Node 以 JSON 传递文本内容），编码后存为 numpy float32 数组 [N, 768]。查询时 encode query -> 归一化 -> dot product -> argpartition top-k。增量更新时直接 np.vstack 追加。

**理由：** numpy 的向量化操作比 SQLite BLOB 逐行读取快 100x 以上。内存占用极低（N*768*4 bytes，5000 条才 15MB），无需外部索引文件。

### 3. 增量更新策略

**决策：** 导入新文档后，Node 侧插入 chunk 到 SQLite -> 发送 encode_and_index 给 Python -> Python 编码追加到内存 numpy -> 返回 base64 编码的 BLOB -> Node 写入 SQLite BLOB 列。

**理由：** 两阶段提交保证一致性：内存索引更新成功才写 BLOB 列。如果进程中途崩溃，重启后从 SQLite 重新加载完整索引。

### 4. literary.db 的 381 条数据向量索引

**决策：** 建立索引，但不写入只读的 literary.db。向量存在两个地方：主数据库 lit_embeddings 表（lit_rowid INTEGER PRIMARY KEY, embedding BLOB）和 Python 进程内存 numpy 数组。

首次启动时，Node 从 literary.db 读取所有 materials 内容，传给 Python 编码，Python 返回 embeddings，Node 写入 lit_embeddings 表。后续启动检测到 lit_embeddings 已有记录即跳过重复编码。

### 5. 降级策略：逐层回退

```
Python unready -> skip vector -> pure LIKE pipeline
search_vector timeout -> empty vector pool -> LIKE pool only
rerank timeout -> skip rerank -> merge by keyword score
```

| 故障点 | 降级行为 | 影响 |
|--------|----------|------|
| Python 进程未启动 | isIndexReady()=false，跳过向量搜索 | 搜索退化到原有关键词模式 |
| build_index 超时/失败 | _indexReady=false | 同上述 |
| search_vector 超时/失败 | 向量候选池为空 | 合并时仅用 LIKE 候选池 |
| rerank_with_ids 超时/失败 | 跳过精排，用合并排序 | 排序质量下降，结果不丢失 |
| Python crash 后重启 | exit 事件 _indexReady=false; 下次懒重启 | 需重建索引 |
| 增量索引失败 | 新 chunk 仅 keyword 可命中 | 下次重启补齐 |

---

## Task 1: 数据库 Migration v6 -- embedding 列 + lit_embeddings 表

**Files:**
- Modify: src/main/db/migrations.ts:208-210（在 v5 之后追加 v6）

**产物：** ALTER TABLE reference_chunks ADD COLUMN embedding BLOB; CREATE TABLE lit_embeddings;

### 步骤

在 MIGRATIONS 数组末尾（v5 对象之后）追加：

```typescript
  // 006: 向量语义搜索 -- embedding BLOB 列 + 文学库向量索引表
  {
    version: 6,
    sql: `
      ALTER TABLE reference_chunks ADD COLUMN embedding BLOB;

      CREATE TABLE IF NOT EXISTS lit_embeddings (
        lit_rowid INTEGER PRIMARY KEY,
        embedding BLOB NOT NULL,
        indexed_at TEXT NOT NULL DEFAULT (datetime("now"))
      );
    `,
  },
```

编译验证: `npx vite build`

Commit: `git add src/main/db/migrations.ts && git commit -m "feat: migration v6 - embedding BLOB 列 + lit_embeddings 表"`

## Task 2: 扩展 ReferenceRepo -- 向量相关查询方法

**Files:**
- Modify: src/main/db/repositories/reference.repo.ts（在 searchByKeyword 之后追加新方法）

**产物：**
- getAllChunksForIndexing(): IpcResult<{id, content, source}[]>
- getChunksWithoutEmbeddings(): IpcResult<{id, content}[]>
- updateEmbedding(chunkId, embedding): IpcResult<void>
- batchUpdateEmbeddings(items): IpcResult<void>
- getChunksByIds(ids): IpcResult<SimilarityResult[]>

### 步骤

在 searchByKeyword 方法之后、findSimilar 方法之前插入以下方法：

```typescript
  /**
   * 获取所有需要建索引的 chunk（含 id 和 content）
   */
  getAllChunksForIndexing(): IpcResult<Array<{ id: string; content: string; source: "user" }>> {
    const rows = this.db.prepare(`
      SELECT id, content FROM reference_chunks ORDER BY rowid ASC
    `).all() as Array<{ id: string; content: string }>;
    return {
      success: true,
      data: rows.map(r => ({ id: r.id, content: r.content, source: "user" as const })),
    };
  }

  /**
   * 获取没有 embedding 的 chunk（增量索引用）
   */
  getChunksWithoutEmbeddings(): IpcResult<Array<{ id: string; content: string }>> {
    const rows = this.db.prepare(`
      SELECT id, content FROM reference_chunks WHERE embedding IS NULL ORDER BY rowid ASC
    `).all() as Array<{ id: string; content: string }>;
    return { success: true, data: rows };
  }

  /**
   * 写入单个 chunk 的 embedding
   */
  updateEmbedding(chunkId: string, embedding: Buffer): IpcResult<void> {
    this.db.prepare(
      "UPDATE reference_chunks SET embedding = ? WHERE id = ?"
    ).run(embedding, chunkId);
    return { success: true };
  }

  /**
   * 批量写入 embeddings（事务包裹）
   */
  batchUpdateEmbeddings(items: Array<{ id: string; embedding: Buffer }>): IpcResult<void> {
    const tx = this.db.transaction(() => {
      const stmt = this.db.prepare("UPDATE reference_chunks SET embedding = ? WHERE id = ?");
      for (const item of items) {
        stmt.run(item.embedding, item.id);
      }
    });
    tx();
    return { success: true };
  }

  /**
   * 根据 chunk ID 列表获取完整 SimilarityResult（仅 user_imported 来源）
   */
  getChunksByIds(ids: string[]): IpcResult<SimilarityResult[]> {
    const userIds = ids.filter(id => !id.startsWith("lit_"));
    if (userIds.length === 0) return { success: true, data: [] };

    const placeholders = userIds.map(() => "?").join(",");
    const rows = this.db.prepare(`
      SELECT rc.id, rc.doc_id, rc.chunk_index, rc.content, rc.word_count, rd.title, rd.author
      FROM reference_chunks rc
      JOIN reference_docs rd ON rd.id = rc.doc_id
      WHERE rc.id IN (${placeholders})
    `).all(...userIds) as Record<string, unknown>[];

    return {
      success: true,
      data: rows.map(r => ({
        chunkId: r.id as string,
        docId: r.doc_id as string,
        docTitle: r.title as string,
        docAuthor: (r.author as string) || undefined,
        content: r.content as string,
        chunkIndex: r.chunk_index as number,
        score: 0,
        matchPercentage: 0,
        source: "user_imported" as const,
      })),
    };
  }
```

编译验证: `npx vite build`

Commit: `git add src/main/db/repositories/reference.repo.ts && git commit -m "feat: ReferenceRepo 新增向量索引相关查询方法"`

## Task 3: 重写 Python semantic_reranker.py -- 向量索引核心

**Files:**
- Modify: semantic_reranker.py（完全重写，约 200 行）

**产物：** VectorIndex 类 + 扩展后的主循环支持所有 action 类型

**Python 新协议：**

```
build_index:      {action, chunks: [{id, content, source}, ...]}  -> {status: ok, count: N}
encode_and_index: {action, chunks: [{id, content, source}, ...]}  -> {status: ok, embeddings: [{id, embedding_b64}]}
search_vector:    {action, query, top_k}                          -> [{id, score}, ...]
rerank_with_ids:  {action, query, candidates, ids, top_k}         -> [{id, sentence, score}, ...]
rerank:           {query, candidates, top_k}                      -> [{sentence, score}, ...]  # 向后兼容
index_stats:      {action}                                        -> {status: ok, total_chunks, user_chunks, lit_chunks, dim}
ping:             {action: "ping"}                                -> {status: ok}
shutdown:         {action: "shutdown"}                            -> {status: bye}
```

### 重写要点

1. 新增 VectorIndex 类：
   - __init__(self, dim=768): 初始化空 embeddings [0, dim], ids[], sources[]
   - build(self, chunks): 编码所有文本，存入 numpy 数组
   - add(self, chunks): 增量编码，np.vstack 追加，返回 [{id, embedding_b64}]
   - search(self, query_embedding, top_k): 归一化点积 -> argpartition -> 返回 [{id, score}]
   - get_stats(self): 返回索引统计

2. 重构 handle_request(data) 路由函数：
   - 根据 data.action 字段分发
   - 保持向后兼容：无 action 字段时默认按 rerank 处理

3. main() 入口修改：
   - 加载模型后初始化 index = VectorIndex(dim=768)
   - 主循环调用 handle_request 处理所有 action
   - 所有响应附带 _requestId（来自输入）

4. 关键实现细节：
   - embedding_b64 = base64.b64encode(embedding.tobytes()).decode("ascii")
   - float32 numpy -> tobytes() 产生 C-contiguous 小端字节序（与 Node Buffer 兼容）
   - 余弦相似度 = 归一化后点积: emb / ||emb|| dot query / ||query||
   - 大索引时用 np.argpartition 代替 argsort 获取 top_k

5. 现有 rerank 函数保留（参数扩展支持可选 ids 参数）

### 完整的 python 脚本已在方案设计文档中给出，此任务对应的源码约 200 行。

### 验证

```bash
python -c "import ast; ast.parse(open('semantic_reranker.py').read()); print('syntax ok')"
```

Commit: `git add semantic_reranker.py && git commit -m "feat: 重写 Python 服务 - 新增 VectorIndex 类 + 多种 action 支持"`

## Task 4: 扩展 Node 侧 semantic-reranker.ts -- 新协议客户端

**Files:**
- Modify: src/main/ai/semantic-reranker.ts

**产物：**
- sendRequest(payload, timeoutMs): 通用请求发送函数（提取自现有 semanticRerank）
- buildVectorIndex(chunks): Promise<{count} | null>
- encodeAndIndex(chunks): Promise<[{id, embedding_b64}] | null>
- searchVector(query, topK): Promise<[{id, score}] | null>
- rerankWithIds(query, candidates, ids, topK): Promise<[{id, sentence, score}] | null>
- isIndexReady(): boolean
- waitForIndex(timeoutMs): Promise<boolean>
- getIndexStats(): Promise<Record<string, unknown> | null>

### 重构步骤

**Step 1: 提取通用 sendRequest 函数**

将现有 semanticRerank 中的 stdin write + pendingRequests 逻辑提取为独立函数：

```typescript
function sendRequest(payload: Record<string, unknown>, timeoutMs: number): Promise<Record<string, unknown> | null> {
  const proc = getPythonProcess();
  if (!proc || proc.killed) {
    return Promise.resolve(null);
  }
  const rid = String(++requestId);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(rid);
      resolve(null);
    }, timeoutMs);
    pendingRequests.set(rid, {
      resolve,
      reject: () => resolve(null),
      timer,
    });
    const payloadWithId = { ...payload, _requestId: rid };
    const line = JSON.stringify(payloadWithId) + "
";
    try {
      proc.stdin?.write(line);
    } catch (err) {
      clearTimeout(timer);
      pendingRequests.delete(rid);
      resolve(null);
    }
  });
}
```

**Step 2: 简化 semanticRerank 使用 sendRequest**

将函数体替换为直接调用 sendRequest。

**Step 3: 新增向量索引函数**

在 sendRequest 之后追加：

```typescript
let _indexReady = false;

export function isIndexReady(): boolean { return _indexReady; }

export async function waitForIndex(timeoutMs = 60000): Promise<boolean> {
  if (_indexReady) return true;
  const start = Date.now();
  while (!_indexReady && (Date.now() - start) < timeoutMs) {
    await new Promise(r => setTimeout(r, 500));
  }
  return _indexReady;
}

export async function buildVectorIndex(
  chunks: Array<{ id: string; content: string; source: string }>,
): Promise<{ count: number } | null> {
  const response = await sendRequest({ action: "build_index", chunks }, 300000);
  if (response && response.status === "ok") {
    _indexReady = true;
    return { count: response.count as number };
  }
  return null;
}

export async function encodeAndIndex(
  chunks: Array<{ id: string; content: string; source: string }>,
): Promise<Array<{ id: string; embedding_b64: string }> | null> {
  const response = await sendRequest({ action: "encode_and_index", chunks }, 120000);
  if (response && response.status === "ok" && Array.isArray(response.embeddings)) {
    return response.embeddings as Array<{ id: string; embedding_b64: string }>;
  }
  return null;
}

export async function searchVector(
  query: string,
  topK = 50,
): Promise<Array<{ id: string; score: number }> | null> {
  const response = await sendRequest({ action: "search_vector", query, top_k: topK }, 10000);
  if (!response) return null;
  if (response.results && Array.isArray(response.results)) {
    return response.results as Array<{ id: string; score: number }>;
  }
  if (Array.isArray(response)) {
    return response as Array<{ id: string; score: number }>;
  }
  return null;
}

export async function rerankWithIds(
  query: string,
  candidates: string[],
  ids: string[],
  topK = 20,
): Promise<Array<{ id: string; sentence: string; score: number }> | null> {
  if (candidates.length === 0) return [];
  if (candidates.length <= 5) {
    return candidates.slice(0, topK).map((s, i) => ({
      id: ids[i] || `unknown_${i}`,
      sentence: s,
      score: 1.0,
    }));
  }
  const response = await sendRequest(
    { action: "rerank_with_ids", query, candidates, ids, top_k: topK },
    10000,
  );
  if (!response) return null;
  if (response.results && Array.isArray(response.results)) {
    return response.results as Array<{ id: string; sentence: string; score: number }>;
  }
  if (Array.isArray(response)) {
    return response as Array<{ id: string; sentence: string; score: number }>;
  }
  return null;
}
```

编译验证: `npx vite build`

Commit: `git add src/main/ai/semantic-reranker.ts && git commit -m "feat: Node 侧语义桥接 - build_index/search_vector/rerank_with_ids 新方法"`

## Task 5: 启动时自动构建向量索引

**Files:**
- Modify: src/main/index.ts:65-84（在 app.whenReady 回调中追加索引构建逻辑）

**产物：** 启动时异步调用 Python 构建全量向量索引

### 步骤

**Step 1: 添加导入**

在 index.ts 顶部追加（import 区域）：

```typescript
import { buildVectorIndex, isIndexReady, getIndexStats } from "./ai/semantic-reranker";
import { getLiteraryDb } from "./db/connection";
import { ReferenceRepo } from "./db/repositories/reference.repo";
```

**Step 2: 在 app.whenReady 末尾调用索引构建**

在 createWindow() 调用之后、createAppMenu 之前插入：

```typescript
  // 异步构建向量索引（不阻塞窗口渲染）
  buildIndexOnStartup().catch(err => {
    console.error("向量索引构建失败:", err);
  });
```

**Step 3: 定义 buildIndexOnStartup 函数**

在 app.on("window-all-closed") 之前插入：

```typescript
/**
 * 启动时构建向量索引
 * 从 SQLite 加载所有 chunk -> 发送给 Python 编码 -> Python 内存中构建 numpy 索引
 */
async function buildIndexOnStartup(): Promise<void> {
  try {
    const repo = new ReferenceRepo(getDb());
    const litDb = getLiteraryDb();
    const chunks: Array<{ id: string; content: string; source: string }> = [];

    // 用户导入的 chunk
    const userRes = repo.getAllChunksForIndexing();
    if (userRes.success && userRes.data) {
      for (const ch of userRes.data) {
        chunks.push({ id: ch.id, content: ch.content, source: "user" });
      }
    }

    // 文学库 entries
    if (litDb) {
      const litRows = litDb.prepare(
        "SELECT rowid, content FROM materials ORDER BY rowid ASC"
      ).all() as Array<{ rowid: number; content: string }>;
      for (const row of litRows) {
        chunks.push({ id: `lit_${row.rowid}`, content: row.content || "", source: "lit" });
      }
    }

    console.log(`[Index] preparing ${chunks.length} chunks (user=${userRes.data?.length || 0}, lit=${chunks.length - (userRes.data?.length || 0)})`);

    if (chunks.length > 0) {
      const result = await buildVectorIndex(chunks);
      if (result) {
        console.log(`[Index] built: ${result.count} items`);
      } else {
        console.warn("[Index] build failed, Python may not be ready");
      }
    } else {
      await buildVectorIndex([]);
    }
  } catch (err) {
    console.error("[Index] build error:", err);
  }
}
```

**关键注意：** 此函数异步执行，不阻塞窗口创建。Python 模型加载需要几秒，窗口渲染早于索引就绪。搜索时通过 isIndexReady() 判断。

编译验证: `npx vite build`

Commit: `git add src/main/index.ts && git commit -m "feat: startup auto-build vector index (user chunks + literary db)"`

## Task 6: searchAll 双路并行搜索

**Files:**
- Modify: src/main/ipc/reference.ipc.ts:131-311（searchAll handler 重写）

**产物：** 双路并行搜索 -- 关键词 LIKE + 向量语义搜索 -> 合并去重 -> 语义精排 -> top 20 分组返回

**返回格式不变：** 仍为 { success: true, data: { userResults, openResults } }

### 实现要点

**Step 1: 追加导入**

文件顶部 append:
```typescript
import { searchVector, rerankWithIds, isIndexReady } from "../ai/semantic-reranker";
```

**Step 2: 重写 searchAll handler**

保持现有 extractKeywordGroups + LIKE 搜索逻辑不变（路径一），但调整候选池上限从 max*2 改为固定 MAX_PER_PATH=50。

新增路径二（在候选池构建完成后）：

```typescript
      // ═══ 路径二：向量语义搜索（异步）═══
      let vectorCandidates: SimilarityResult[] = [];
      if (isIndexReady()) {
        try {
          const vecResults = await searchVector(cleaned, MAX_PER_PATH);
          if (vecResults && vecResults.length > 0) {
            const vecIds = vecResults.map(r => r.id);
            const userIds = vecIds.filter(id => !id.startsWith("lit_"));
            const litRowIds = vecIds
              .filter(id => id.startsWith("lit_"))
              .map(id => parseInt(id.replace("lit_", ""), 10));

            // 查 user chunk 内容
            const userChunks = refRepo.getChunksByIds(userIds);
            if (userChunks.success && userChunks.data) {
              for (const r of userChunks.data) {
                r.score = vecResults.find(v => v.id === r.chunkId)?.score || 0;
                r.matchPercentage = Math.round(r.score * 100);
                vectorCandidates.push(r);
              }
            }

            // 查 literary.db 条目
            if (litDb && litRowIds.length > 0) {
              const placeholders = litRowIds.map(() => "?").join(",");
              const litRows = litDb.prepare(`
                SELECT rowid as row_id, source_layer, title, content
                FROM materials WHERE rowid IN (${placeholders})
              `).all(...litRowIds) as Record<string, unknown>[];
              for (const row of litRows) {
                const chunkId = `lit_${row.row_id}`;
                const layer = (row.source_layer as string) || "";
                const vs = vecResults.find(v => v.id === chunkId);
                vectorCandidates.push({
                  chunkId, docId: `lit_doc_${layer}`,
                  docTitle: `[${LAYER_LABELS[layer] || layer}] ${row.title || ""}`,
                  docAuthor: undefined,
                  content: (row.content as string) || "",
                  chunkIndex: 0,
                  score: vs?.score || 0,
                  matchPercentage: Math.round((vs?.score || 0) * 100),
                  source: "open_library" as const,
                });
              }
            }
            vectorCandidates.sort((a, b) => b.score - a.score);
          }
        } catch (err) { console.warn("[searchAll] vector search failed:", err); }
      }
```

**Step 3: 合并去重**

```typescript
      // 合并: Map<chunkId, result>，向量结果优先（分数更精确）
      const merged = new Map<string, SimilarityResult>();
      for (const r of allKwResults) merged.set(r.chunkId, r);
      for (const r of vectorCandidates) {
        if (!merged.has(r.chunkId)) merged.set(r.chunkId, r);
      }
      const mergedList = [...merged.values()];
```

**Step 4: 语义精排 + snippet 截取**

```typescript
      if (mergedList.length > 0) {
        const candidates = mergedList.map(r => r.content);
        const ids = mergedList.map(r => r.chunkId);
        try {
          const ranked = await rerankWithIds(cleaned, candidates, ids, max);
          if (ranked) {
            // 按分数分配 userResults / openResults
            // 每个结果调用 generateSnippet + uniqueSearchWords 截取
            return { success: true, data: { userResults: ..., openResults: ... } };
          }
        } catch (err) { console.warn("rerank failed, fallback:", err); }
      }
      // 降级: 保持现有 merge sort + snippet 逻辑
```

编译验证: `npx vite build`

Commit: `git add src/main/ipc/reference.ipc.ts && git commit -m "feat: searchAll dual-path - LIKE + vector search merge dedup rerank"`

## Task 7: 新导入文档增量索引更新

**Files:**
- Modify: src/main/ipc/import.ipc.ts:43-88（import:toReference handler 尾部追加增量索引调用）

**产物：** 导入完成后自动触发增量向量编码 + 追加到 Python 内存索引 + 写入 SQLite BLOB

### 步骤

**Step 1: 追加导入**

```typescript
import { encodeAndIndex, isIndexReady } from "../ai/semantic-reranker";
```

**Step 2: 在 import:toReference handler 成功分支尾部追加逻辑**

在 return 语句之前（createRes.success 分支内）：

```typescript
        // 增量更新向量索引
        if (isIndexReady() && createRes.success && createRes.data) {
          const chunksRes = getRefRepo().getChunksWithoutEmbeddings();
          if (chunksRes.success && chunksRes.data && chunksRes.data.length > 0) {
            const chunksToIndex = chunksRes.data.map(ch => ({
              id: ch.id,
              content: ch.content,
              source: "user" as const,
            }));
            try {
              const encoded = await encodeAndIndex(chunksToIndex);
              if (encoded) {
                const updateItems = encoded.map(e => ({
                  id: e.id,
                  embedding: Buffer.from(e.embedding_b64, "base64"),
                }));
                getRefRepo().batchUpdateEmbeddings(updateItems);
                console.log(`[Import] incremental index updated: ${encoded.length} chunks`);
              }
            } catch (err) {
              console.warn("[Import] incremental index failed:", err);
            }
          }
        }
```

编译验证: `npx vite build`

Commit: `git add src/main/ipc/import.ipc.ts && git commit -m "feat: incremental vector index update after document import"`

## Task 8: 确保 Python 进程正确关闭 + 复制脚本

**Sub-task 8a -- before-quit 钩子**

**Files:**
- Modify: src/main/index.ts:92-95

在 app.on("before-quit", ...) 中追加：

```typescript
app.on("before-quit", () => {
  try {
    const { shutdownReranker } = require("./ai/semantic-reranker");
    shutdownReranker();
  } catch {}
  closeDb();
});
```

**Sub-task 8b -- copy-assets**

**Files:**
- Modify: scripts/copy-assets.js

在 copies 数组中追加：

```javascript
const copies = [
  ["src/main/ai/synonym-config.json", "dist/main/main/ai/synonym-config.json"],
  ["semantic_reranker.py", "dist/semantic_reranker.py"],
];
```

验证: `npm run build:main && ls dist/semantic_reranker.py`

Commit: `git add src/main/index.ts scripts/copy-assets.js && git commit -m "fix: before-quit shutdown Python + copy semantic_reranker.py to dist"`

---

## 实现顺序建议

按 Task 1-8 顺序执行，每个 Task 的代码改动独立可编译。推荐流程：

1. Task 1 (migration) -> 编译验证
2. Task 2 (ReferenceRepo 方法) -> 编译验证
3. Task 3 (Python 重写) -> 语法验证
4. Task 4 (Node 桥接) -> 编译验证
5. Task 5 (启动索引构建) -> 编译验证
6. Task 6 (双路并行搜索) -> 编译验证 -- 这是核心变更
7. Task 7 (增量更新) -> 编译验证
8. Task 8 (生命周期 + 构建) -> 编译验证

完成后运行 `npm run dev` 进行端到端测试。

---

## 潜在风险与应对

| 风险 | 概率 | 应对 |
|------|------|------|
| Python 模型首次下载慢（国内网络） | 高 | 已设 HF_ENDPOINT hf-mirror.com; 模型缓存在 ~/.cache/huggingface |
| Python stdin/stdout 缓冲区阻塞 | 中 | PYTHONUNBUFFERED=1; 每行 flush(); 每次只发一个请求 |
| 大文档导入导致编码耗时过长 | 中 | buildIndex 超时设 5min; 增量编码设 2min; 分批发送 |
| BLOB 大小写兼容 (big vs little endian) | 低 | Python tobytes() 和 Node Buffer.from 都是 C-contiguous LE; 显式使用 float32 |
| 文学库为空时 build 传空数组 | 低 | 已处理空数组情况（len=0 返回空索引） |
| 用户没有安装 Python 或 sentence-transformers | 中 | 已设降级: isIndexReady()=false -> 纯 LIKE 搜索; 不影响基本功能 |
| 现有的 setSearchResults / autoSearch 流程干扰 | 低 | searchAll 返回格式不变（userResults + openResults）; 不影响现有流程 |

---

## 前端影响分析

**零前端改动。** 理由：

- IPC 接口 `db:reference:searchAll` 的输入输出完全不变（仍为 query string + maxResults，返回 {userResults, openResults}）
- SimilarityResult 类型不变
- ReferencePanel 的展示逻辑不变（分区展示 / 高亮 / 展开）
- App.tsx 的 handleManualReferenceSearch 不变

唯一的用户感知变化：搜索结果质量和召回率的提升（向量搜索覆盖了关键词扩展无法匹配的语义相近内容）。
