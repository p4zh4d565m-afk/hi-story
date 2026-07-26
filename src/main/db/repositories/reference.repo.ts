/**
 * 参考文档库 Repository
 * 管理导入的小说参考库（全局共享，不关联特定项目）
 * 提供文档 CRUD、分块存储、FTS5 搜索、相似度匹配
 */

import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { IpcResult } from '../../../renderer/types';
import {
  hybridSimilarity,
  buildFtsQuery,
  extractCoreText,
  type SimilarityResult,
} from '../../ai/similarity';

// ============================================================
// 类型定义
// ============================================================

export interface ReferenceDoc {
  id: string;
  title: string;
  author: string | null;
  format: 'txt' | 'epub' | 'markdown';
  totalWords: number;
  sourceFile: string | null;
  createdAt: string;
}

export interface ReferenceChunk {
  id: string;
  docId: string;
  chunkIndex: number;
  content: string;
  wordCount: number;
}

export interface CreateReferenceDocInput {
  title: string;
  author?: string;
  format: 'txt' | 'epub' | 'markdown';
  totalWords: number;
  sourceFile?: string;
  chunks: { content: string; wordCount: number }[];
}

export interface FindSimilarInput {
  queryText: string;
  threshold: number;   // 0.0 ~ 1.0
  maxResults: number;
}

export interface SearchReferenceInput {
  query: string;
  maxResults?: number;
}

// ============================================================
// Repository
// ============================================================

export class ReferenceRepo {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  // ── 文档 CRUD ──

  /**
   * 导入参考文档（含分块）
   * 使用事务确保原子性
   */
  create(input: CreateReferenceDocInput, skipFtsRebuild?: boolean): IpcResult<ReferenceDoc> {
    const now = new Date().toISOString();
    const docId = uuidv4();

    const tx = this.db.transaction(() => {
      // 插入文档元数据
      this.db.prepare(`
        INSERT INTO reference_docs (id, title, author, format, total_words, source_file, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(docId, input.title, input.author ?? null, input.format,
        input.totalWords, input.sourceFile ?? null, now);

      // 批量插入分块
      const insertChunk = this.db.prepare(`
        INSERT INTO reference_chunks (id, doc_id, chunk_index, content, word_count)
        VALUES (?, ?, ?, ?, ?)
      `);

      for (let i = 0; i < input.chunks.length; i++) {
        const ch = input.chunks[i];
        insertChunk.run(uuidv4(), docId, i, ch.content, ch.wordCount);
      }

      // 重建 FTS5 索引 — 批量导入时可跳过，等全部导完再统一 rebuild
      if (!skipFtsRebuild) {
        this.db.exec(`
          INSERT INTO reference_chunks_fts(reference_chunks_fts) VALUES('rebuild')
        `);
      }
    });

    tx();
    return this.findById(docId);
  }

  /** 批量导入完成后统一重建 FTS5 索引 */
  rebuildFts(): void {
    this.db.exec(`
      INSERT INTO reference_chunks_fts(reference_chunks_fts) VALUES('rebuild')
    `);
  }

  findById(id: string): IpcResult<ReferenceDoc> {
    const row = this.db.prepare('SELECT * FROM reference_docs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return { success: false, error: '参考文档不存在' };
    return { success: true, data: rowToDoc(row) };
  }

  /** 根据来源文件路径查找已有文档（用于批量导入查重） */
  findBySourceFile(sourceFile: string): ReferenceDoc | null {
    const row = this.db.prepare(
      'SELECT * FROM reference_docs WHERE source_file = ?'
    ).get(sourceFile) as Record<string, unknown> | undefined;
    if (!row) return null;
    return rowToDoc(row);
  }

  findAll(): IpcResult<ReferenceDoc[]> {
    const rows = this.db.prepare('SELECT * FROM reference_docs ORDER BY created_at DESC').all() as Record<string, unknown>[];
    return { success: true, data: rows.map(rowToDoc) };
  }

  remove(id: string): IpcResult<void> {
    const doc = this.findById(id);
    if (!doc.success) return { success: false, error: '参考文档不存在' };

    // FTS5 也需要清理（通过 DELETE FROM reference_chunks 级联触发 FTS5 自动清理）
    this.db.prepare('DELETE FROM reference_docs WHERE id = ?').run(id);
    // 手动清理 FTS5 中可能残留的条目
    this.db.exec("INSERT INTO reference_chunks_fts(reference_chunks_fts) VALUES('optimize')");
    return { success: true };
  }

  // ── 分块查询 ──

  getChunks(docId: string): IpcResult<ReferenceChunk[]> {
    const rows = this.db.prepare(
      'SELECT * FROM reference_chunks WHERE doc_id = ? ORDER BY chunk_index ASC'
    ).all(docId) as Record<string, unknown>[];
    return { success: true, data: rows.map(rowToChunk) };
  }

  /**
   * 获取指定 chunk 的上下文（前后各 N 个 chunk）
   */
  getContextChunks(docId: string, chunkIndex: number, beforeAfter: number = 2): IpcResult<ReferenceChunk[]> {
    const rows = this.db.prepare(`
      SELECT * FROM reference_chunks
      WHERE doc_id = ? AND chunk_index >= ? AND chunk_index <= ?
      ORDER BY chunk_index ASC
    `).all(docId, Math.max(0, chunkIndex - beforeAfter), chunkIndex + beforeAfter) as Record<string, unknown>[];
    return { success: true, data: rows.map(rowToChunk) };
  }

  // ── FTS5 全文搜索 ──

  /**
   * 使用 FTS5 在参考库中搜索
   */
  searchFts(query: string, maxResults: number = 20): IpcResult<SimilarityResult[]> {
    const ftsQuery = buildFtsQuery(query);
    if (!ftsQuery) return { success: true, data: [] };

    try {
      const rows = this.db.prepare(`
        SELECT
          rc.id, rc.doc_id, rc.chunk_index, rc.content, rc.word_count,
          rd.title, rd.author
        FROM reference_chunks_fts fts
        JOIN reference_chunks rc ON rc.rowid = fts.rowid
        JOIN reference_docs rd ON rd.id = rc.doc_id
        WHERE reference_chunks_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `).all(ftsQuery, maxResults) as Record<string, unknown>[];

      // 用 Jaccard 重排序
      const results: SimilarityResult[] = rows.map(r => ({
        chunkId: r.id as string,
        docId: r.doc_id as string,
        docTitle: r.title as string,
        docAuthor: (r.author as string) || undefined,
        content: r.content as string,
        chunkIndex: r.chunk_index as number,
        score: 0,
        matchPercentage: 0,
        source: 'user_imported' as const,
        matchSource: 'keyword' as const,
      }));

      // 计算 Jaccard 分数
      for (const r of results) {
        const score = hybridSimilarity(query, r.content);
        r.score = score;
        r.matchPercentage = Math.round(score * 100);
      }

      // 按分数降序排列
      results.sort((a, b) => b.score - a.score);

      return { success: true, data: results };
    } catch (err) {
      // FTS5 query syntax errors are common with special characters
      console.error('FTS5 search error:', err);
      return { success: true, data: [] };
    }
  }

  // ── LIKE 关键词搜索（替代 FTS5，适用短词和 CJK）──

  /**
   * 使用 LIKE 做关键词搜索（覆盖短词、CJK 字符）
   * 解决 FTS5 unicode61 tokenizer 对 CJK 索引不完整的问题
   */
  searchByKeyword(query: string, maxResults: number = 20): IpcResult<SimilarityResult[]> {
    const cleaned = query.trim();
    if (!cleaned || cleaned.length < 1) return { success: true, data: [] };

    try {
      const likePattern = `%${cleaned.replace(/[%_]/g, '')}%`;
      // 如果 LIKE 匹配过多（>1000），加限制
      const countRow = this.db.prepare(`
        SELECT COUNT(*) as c FROM reference_chunks WHERE content LIKE ?
      `).get(likePattern) as Record<string, unknown>;
      const total = (countRow.c as number) || 0;

      const limit = total > 1000 ? maxResults * 2 : maxResults;

      const rows = this.db.prepare(`
        SELECT
          rc.id, rc.doc_id, rc.chunk_index, rc.content, rc.word_count,
          rd.title, rd.author
        FROM reference_chunks rc
        JOIN reference_docs rd ON rd.id = rc.doc_id
        WHERE rc.content LIKE ?
        ORDER BY rc.word_count DESC
        LIMIT ?
      `).all(likePattern, limit) as Record<string, unknown>[];

      // 用 Jaccard 对结果排序
      const results: SimilarityResult[] = rows.map(r => ({
        chunkId: r.id as string,
        docId: r.doc_id as string,
        docTitle: r.title as string,
        docAuthor: (r.author as string) || undefined,
        content: r.content as string,
        chunkIndex: r.chunk_index as number,
        score: 0,
        matchPercentage: 0,
        source: 'user_imported' as const,
        matchSource: 'keyword' as const,
      }));

      for (const r of results) {
        const score = hybridSimilarity(query, r.content);
        r.score = score;
        r.matchPercentage = Math.round(score * 100);
      }

      results.sort((a, b) => b.score - a.score);
      return { success: true, data: results.slice(0, maxResults) };
    } catch (err) {
      console.error('LIKE search error:', err);
      return { success: true, data: [] };
    }
  }

  // ── 相似度匹配（核心方法）──

  /**
   * 混合匹配流程:
   * 1. 从用户文本中提取核心段落
   * 2. FTS5 候选召回 (top 50)
   * 3. Jaccard 混合相似度重排序
   * 4. 过滤低于阈值的匹配
   * 5. 返回 top N
   */
  findSimilar(input: FindSimilarInput): IpcResult<SimilarityResult[]> {
    const coreText = extractCoreText(input.queryText, 300);
    if (coreText.length < 20) return { success: true, data: [] };

    // 1. FTS5 候选召回
    const ftsResults = this.searchFts(coreText, 50);
    if (!ftsResults.success || !ftsResults.data || ftsResults.data.length === 0) {
      return { success: true, data: [] };
    }

    // 2. Jaccard 重排序 + 阈值过滤
    const results = ftsResults.data
      .filter(r => r.score >= input.threshold)
      .slice(0, input.maxResults);

    return { success: true, data: results };
  }

  // ═══════════════════════════════════════════════════
  // ── 向量相关查询 ──
  // ═══════════════════════════════════════════════════

  /** 检查是否已建向量索引 */
  hasEmbeddings(): boolean {
    const row = this.db.prepare(
      'SELECT COUNT(*) as c FROM reference_chunks WHERE embedding IS NOT NULL'
    ).get() as { c: number };
    return row.c > 0;
  }

  /** 查 embedding 为 NULL 的分块（待索引） */
  getUnindexedChunks(): IpcResult<ReferenceChunk[]> {
    const rows = this.db.prepare(`
      SELECT * FROM reference_chunks WHERE embedding IS NULL
    `).all() as Record<string, unknown>[];
    return { success: true, data: rows.map(rowToChunk) };
  }

  /** 更新单条分块的向量 */
  updateEmbedding(chunkId: string, blob: Buffer): void {
    this.db.prepare('UPDATE reference_chunks SET embedding = ? WHERE id = ?')
      .run(blob, chunkId);
  }

  /**
   * 向量余弦相似度搜索
   * 加载所有有向量的分块，在 JS 侧计算余弦相似度，返回 top N
   * 自动兼容不同维度的向量（768 / 1024），维度不匹配的记录跳过
   */
  searchByEmbedding(queryVec: number[], topN: number = 100): IpcResult<SimilarityResult[]> {
    const rows = this.db.prepare(`
      SELECT
        rc.id, rc.doc_id, rc.chunk_index, rc.content, rc.word_count, rc.embedding,
        rd.title, rd.author
      FROM reference_chunks rc
      JOIN reference_docs rd ON rd.id = rc.doc_id
      WHERE rc.embedding IS NOT NULL
    `).all() as Record<string, unknown>[];

    if (rows.length === 0) return { success: true, data: [] };

    // 检测维度兼容性
    const firstEmb = rows[0].embedding as Buffer;
    const firstDim = firstEmb.length / 4; // float32 = 4 bytes
    if (firstDim !== queryVec.length) {
      console.warn(`[searchByEmbedding] 维度不匹配！查询向量=${queryVec.length}维, 数据库向量=${firstDim}维。请用 build_embeddings.py 重建索引。`);
      return { success: true, data: [] };
    }

    // 计算每条记录的余弦相似度
    const scored: SimilarityResult[] = [];
    for (const row of rows) {
      const embBlob = row.embedding as Buffer;
      const float32 = new Float32Array(embBlob.buffer, embBlob.byteOffset, embBlob.length / 4);
      const embVec = Array.from(float32);
      const sim = cosineSimilarity(queryVec, embVec);
      scored.push({
        chunkId: row.id as string,
        docId: row.doc_id as string,
        docTitle: row.title as string,
        docAuthor: (row.author as string) || undefined,
        content: row.content as string,
        chunkIndex: row.chunk_index as number,
        score: sim,
        matchPercentage: Math.round(sim * 100),
        source: 'user_imported' as const,
        matchSource: 'semantic' as const,
      });
    }

    // 按分数降序，取 top N
    scored.sort((a, b) => b.score - a.score);
    return { success: true, data: scored.slice(0, topN) };
  }

  /**
   * 文学库向量搜索
   * 自动兼容不同维度的向量（768 / 1024），维度不匹配的记录跳过
   */
  searchLitByEmbedding(queryVec: number[], topN: number = 100): IpcResult<SimilarityResult[]> {
    const rows = this.db.prepare(`
      SELECT le.lit_rowid, le.embedding
      FROM lit_embeddings le
    `).all() as Record<string, unknown>[];

    if (rows.length === 0) return { success: true, data: [] };

    // 检测维度兼容性
    const firstEmb = rows[0].embedding as Buffer;
    const firstDim = firstEmb.length / 4;
    if (firstDim !== queryVec.length) {
      console.warn(`[searchLitByEmbedding] 维度不匹配！查询向量=${queryVec.length}维, 数据库向量=${firstDim}维。请用 build_embeddings.py 重建索引。`);
      return { success: true, data: [] };
    }

    const scored: SimilarityResult[] = [];
    for (const row of rows) {
      const embBlob = row.embedding as Buffer;
      const float32 = new Float32Array(embBlob.buffer, embBlob.byteOffset, embBlob.length / 4);
      const embVec = Array.from(float32);
      const sim = cosineSimilarity(queryVec, embVec);
      scored.push({
        chunkId: 'lit_' + row.lit_rowid,
        docId: 'lit_doc',
        docTitle: '',
        content: '',
        chunkIndex: 0,
        score: sim,
        matchPercentage: Math.round(sim * 100),
        source: 'open_library' as const,
        matchSource: 'semantic' as const,
      });
    }

    scored.sort((a, b) => b.score - a.score);
    return { success: true, data: scored.slice(0, topN) };
  }

  /** 加载所有分块向量（供 Python 建内存索引） */
  getAllEmbeddings(): IpcResult<Array<{ chunkId: string; embedding: Buffer }>> {
    const rows = this.db.prepare(`
      SELECT id, embedding FROM reference_chunks WHERE embedding IS NOT NULL
    `).all() as Record<string, unknown>[];
    return {
      success: true,
      data: rows.map(r => ({ chunkId: r.id as string, embedding: r.embedding as Buffer })),
    };
  }

  /** 加载文学库向量（供 Python 建索引） */
  getLitEmbeddings(): IpcResult<Array<{ litRowid: number; embedding: Buffer }>> {
    const rows = this.db.prepare(`
      SELECT lit_rowid, embedding FROM lit_embeddings
    `).all() as Record<string, unknown>[];
    return {
      success: true,
      data: rows.map(r => ({ litRowid: r.lit_rowid as number, embedding: r.embedding as Buffer })),
    };
  }

  /** 写入/更新文学库向量 */
  upsertLitEmbedding(litRowid: number, blob: Buffer): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO lit_embeddings (lit_rowid, embedding) VALUES (?, ?)
    `).run(litRowid, blob);
  }
}

// ============================================================
// 工具函数
// ============================================================

function rowToDoc(row: Record<string, unknown>): ReferenceDoc {
  return {
    id: row.id as string,
    title: row.title as string,
    author: (row.author as string) || null,
    format: row.format as ReferenceDoc['format'],
    totalWords: row.total_words as number,
    sourceFile: (row.source_file as string) || null,
    createdAt: row.created_at as string,
  };
}

function rowToChunk(row: Record<string, unknown>): ReferenceChunk {
  return {
    id: row.id as string,
    docId: row.doc_id as string,
    chunkIndex: row.chunk_index as number,
    content: row.content as string,
    wordCount: row.word_count as number,
  };
}

/**
 * 余弦相似度计算
 * cos(θ) = (A·B) / (|A| × |B|)
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
