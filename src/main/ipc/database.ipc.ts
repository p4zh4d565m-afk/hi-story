/**
 * 数据库浏览器 IPC 通道
 * 提供查询已导入的参考库和系统开放书籍的功能
 */

import { ipcMain } from 'electron';
import { getDb, getLiteraryDb } from '../db/connection';
import { ReferenceRepo } from '../db/repositories/reference.repo';

// ============================================================
// 类型定义
// ============================================================

export interface DatabaseBook {
  id: string;
  title: string;
  author: string | null;
  source: 'user_imported' | 'open_library';  // 区分来源
  sourceLayer?: string;   // 开放书籍的分类层
  format?: string;        // 用户导入的格式
  totalEntries: number;   // 条目/分块总数
  totalWords: number;
  createdAt: string;
}

export interface DatabaseBookDetail {
  id: string;
  title: string;
  author: string | null;
  source: 'user_imported' | 'open_library';
  sourceLayer?: string;
  format?: string;
  totalWords: number;
  createdAt: string;
  // 内容列表
  entries: DatabaseEntry[];
}

export interface DatabaseEntry {
  id: string;
  index: number;
  content: string;
  wordCount: number;
  sourceUrl?: string;
  tags?: string[];
}

// ============================================================
// 注册 IPC
// ============================================================

function getRepo(): ReferenceRepo {
  return new ReferenceRepo(getDb());
}

export function registerDatabaseIpc(): void {
  // ── 获取所有数据库书籍列表（用户导入 + 系统开放）──
  ipcMain.handle('db:browser:listAll', () => {
    try {
      const books: DatabaseBook[] = [];

      // 1. 用户导入的参考文档
      const refRepo = getRepo();
      const refDocsRes = refRepo.findAll();
      if (refDocsRes.success && refDocsRes.data) {
        for (const doc of refDocsRes.data) {
          // 获取分块数量
          const chunksRes = refRepo.getChunks(doc.id);
          const chunkCount = (chunksRes.success && chunksRes.data)
            ? chunksRes.data.length : 0;

          books.push({
            id: doc.id,
            title: doc.title,
            author: doc.author,
            source: 'user_imported',
            format: doc.format,
            totalEntries: chunkCount,
            totalWords: doc.totalWords,
            createdAt: doc.createdAt,
          });
        }
      }

      // 2. 系统开放的文学数据库
      const litDb = getLiteraryDb();
      if (litDb) {
        try {
          const layerRows = litDb.prepare(`
            SELECT source_layer, title, COUNT(*) as entry_count,
                   SUM(LENGTH(content)) as total_chars,
                   MAX(rowid) as sample_id
            FROM materials
            GROUP BY source_layer, title
            ORDER BY source_layer, title
          `).all() as Record<string, unknown>[];

          for (const row of layerRows) {
            books.push({
              id: `lit_${row.sample_id}`,
              title: row.title as string,
              author: null,
              source: 'open_library',
              sourceLayer: row.source_layer as string,
              totalEntries: row.entry_count as number,
              totalWords: Math.round((row.total_chars as number || 0) / 2), // 估算字数（CJK ≈ chars/2）
              createdAt: '', // 开放书籍没有创建时间
            });
          }
        } catch (err) {
          console.error('查询文学数据库失败:', err);
        }
      }

      return { success: true, data: books };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // ── 查看书籍详情（内容条目）──
  ipcMain.handle('db:browser:getDetail', (_event, bookId: string) => {
    try {
      // 用户导入的参考文档
      if (!bookId.startsWith('lit_')) {
        const refRepo = getRepo();
        const docRes = refRepo.findById(bookId);
        if (!docRes.success || !docRes.data) {
          return { success: false, error: '文档不存在' };
        }

        const doc = docRes.data;
        const chunksRes = refRepo.getChunks(bookId);
        const chunks = (chunksRes.success && chunksRes.data) ? chunksRes.data : [];

        const detail: DatabaseBookDetail = {
          id: doc.id,
          title: doc.title,
          author: doc.author,
          source: 'user_imported',
          format: doc.format,
          totalWords: doc.totalWords,
          createdAt: doc.createdAt,
          entries: chunks.map(ch => ({
            id: ch.id,
            index: ch.chunkIndex,
            content: ch.content,
            wordCount: ch.wordCount,
          })),
        };
        return { success: true, data: detail };
      }

      // 系统开放书籍 — 从 literary.db 查询
      const litDb = getLiteraryDb();
      if (!litDb) {
        return { success: false, error: '文学数据库未找到' };
      }

      const sampleId = parseInt(bookId.replace('lit_', ''), 10);
      // 先获取这本书的 source_layer 和 title
      const sampleRow = litDb.prepare(
        'SELECT source_layer, title FROM materials WHERE rowid = ?'
      ).get(sampleId) as Record<string, unknown> | undefined;

      if (!sampleRow) {
        return { success: false, error: '书籍不存在' };
      }

      const sourceLayer = sampleRow.source_layer as string;
      const title = sampleRow.title as string;

      const rows = litDb.prepare(`
        SELECT rowid as id, title, content, url, tags
        FROM materials
        WHERE source_layer = ? AND title = ?
        ORDER BY rowid ASC
      `).all(sourceLayer, title) as Record<string, unknown>[];

      const detail: DatabaseBookDetail = {
        id: bookId,
        title: title,
        author: null,
        source: 'open_library',
        sourceLayer: sourceLayer,
        totalWords: rows.reduce((sum, r) =>
          sum + Math.round((r.content as string || '').length / 2), 0),
        createdAt: '',
        entries: rows.map((r, i) => ({
          id: String(r.id),
          index: i,
          content: (r.content as string || '').slice(0, 500), // 截断长内容
          wordCount: Math.round((r.content as string || '').length / 2),
          sourceUrl: r.url as string | undefined,
          tags: (() => {
            try {
              const t = r.tags as string;
              return t ? JSON.parse(t) : undefined;
            } catch { return undefined; }
          })(),
        })),
      };

      return { success: true, data: detail };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // ── 删除用户导入的参考文档 ──
  ipcMain.handle('db:browser:delete', (_event, bookId: string) => {
    try {
      if (bookId.startsWith('lit_')) {
        return { success: false, error: '不能删除系统开放的书籍' };
      }
      return getRepo().remove(bookId);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });
}
