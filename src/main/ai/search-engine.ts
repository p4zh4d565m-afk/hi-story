import type Database from 'better-sqlite3';
import { getDb, getLiteraryDb } from '../db/connection';

/**
 * FTS5 全文搜索引擎
 * 搜索本地的文学数据库 (literary.db)
 */
export interface SearchLayer {
  name: string;
  displayName: string;
  icon: string;
  description: string;
}

export const SEARCH_LAYERS: SearchLayer[] = [
  { name: 'public_domain', displayName: '公版文学', icon: '📚', description: '四大名著、唐诗宋词、古文观止等公版文本' },
  { name: 'history_military', displayName: '历史军事', icon: '📜', description: '史书精选、兵法战争、西方历史与神话' },
  { name: 'myth_fantasy', displayName: '神话志怪', icon: '🦊', description: '聊斋、山海经、克苏鲁、哥特文学' },
  { name: 'dictionary', displayName: '词典修辞', icon: '📖', description: '成语词典、近义词库、修辞大全' },
  { name: 'user', displayName: '用户导入', icon: '👤', description: '用户收集的素材与灵感碎片' },
];

export interface SearchResult {
  layer: string;
  layerDisplay: string;
  layerIcon: string;
  title: string;
  content: string;
  snippet: string;
  score: number;
  source?: string;
  materialId?: string;
}

export interface SearchOptions {
  query: string;
  layers?: string[];
  maxResultsPerLayer?: number;
  maxTotalResults?: number;
  includeUserLayer?: boolean;
}

export class SearchEngine {
  private db: Database.Database;
  private litDb: Database.Database | null = null;

  constructor(db: Database.Database) {
    this.db = db;
    this.litDb = getLiteraryDb();
  }

  /** Lazily open the literary DB (cached) */
  private ensureLitDb(): Database.Database | null {
    if (this.litDb) return this.litDb;
    this.litDb = getLiteraryDb();
    return this.litDb;
  }

  /**
   * Search across layers concurrently
   */
  search(options: SearchOptions): SearchResult[] {
    const {
      query,
      layers,
      maxResultsPerLayer = 10,
      maxTotalResults = 50,
    } = options;

    const targetLayers = layers
      ? SEARCH_LAYERS.filter(l => layers.includes(l.name))
      : SEARCH_LAYERS;

    const allResults: SearchResult[] = [];

    for (const layer of targetLayers) {
      const layerResults = this.searchLayer(query, layer, maxResultsPerLayer);
      allResults.push(...layerResults);
    }

    allResults.sort((a, b) => b.score - a.score);
    return allResults.slice(0, maxTotalResults);
  }

  /**
   * Search a single layer in the literary database
   */
  private searchLayer(query: string, layer: SearchLayer, limit: number): SearchResult[] {
    const litDb = this.ensureLitDb();
    if (!litDb) return [];

    try {
      const sanitized = query
        .replace(/['"]/g, '')
        .replace(/[+\-*^~()<>]/g, '')
        .trim();

      if (!sanitized) return [];

      // ===== Pinyin detection and auto-conversion =====
      // Check if the query looks like pinyin (mostly ASCII + tone numbers or marks)
      const isLikelyPinyin = /^[a-zA-Z0-9\sāáǎàōóǒòēéěèīíǐìūúǔùǖǘǚǜü]+$/.test(sanitized);

      // Build search variants
      const searchVariants = [sanitized];
      if (isLikelyPinyin) {
        // For pinyin input, also search as-is (materials may contain pinyin annotations)
        // and try common pinyin-to-hanzi via titles that contain pinyin
        searchVariants.push(sanitized.replace(/\s+/g, ''));
      }

      // First try FTS5 (if table exists)
      const tableExists = litDb.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
      ).get(`fts_${layer.name}`);

      if (tableExists) {
        for (const variant of searchVariants) {
          // FTS5 query needs to use the prefix tokenizer properly
          const terms = variant.split(/\s+/).filter(w => w.length > 0);
          const ftsQuery = terms.map(w => `"${w}"`).join(' OR ');

          try {
            const rows = litDb.prepare(`
              SELECT m.rowid as material_id, m.title, m.content, m.url as source, m.tags,
                     fts_${layer.name}.rank AS score
              FROM fts_${layer.name}
              JOIN materials m ON m.rowid = fts_${layer.name}.rowid AND m.source_layer = ?
              WHERE fts_${layer.name} MATCH ?
              ORDER BY rank
              LIMIT ?
            `).all(layer.name, ftsQuery, limit) as any[];

            if (rows.length > 0) {
              return rows.map((row: any) => ({
                layer: layer.name,
                layerDisplay: layer.displayName,
                layerIcon: layer.icon,
                title: row.title,
                content: row.content || '',
                snippet: this.generateSnippet(row.content || '', variant, 150),
                score: row.score ? Math.abs(row.score) : 0,
                source: row.source || '',
                materialId: String(row.material_id || ''),
              }));
            }
          } catch {
            // FTS query failed, fall through to LIKE search
          }
        }
      }

      // Fallback: LIKE search
      for (const variant of searchVariants) {
        const likePattern = `%${variant}%`;
        const rows = litDb.prepare(`
          SELECT rowid as material_id, title, content, url as source, tags
          FROM materials
          WHERE source_layer = ? AND (title LIKE ? OR content LIKE ?)
          LIMIT ?
        `).all(layer.name, likePattern, likePattern, limit) as any[];

        if (rows.length > 0) {
          return rows.map((row: any) => ({
            layer: layer.name,
            layerDisplay: layer.displayName,
            layerIcon: layer.icon,
            title: row.title || '',
            content: row.content || '',
            snippet: this.generateSnippet(row.content || '', variant, 150),
            score: 1,
            source: row.source || '',
            materialId: String(row.material_id || ''),
          }));
        }
      }

      return [];
    } catch (err) {
      return [];
    }
  }

  private generateSnippet(text: string, query: string, maxLength: number): string {
    const cleanText = text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    if (cleanText.length <= maxLength) return cleanText;

    const idx = cleanText.indexOf(query);
    let start = idx >= 0 ? Math.max(0, idx - maxLength / 3) : 0;
    let snippet = cleanText.slice(Math.floor(start), Math.floor(start + maxLength));
    if (start > 0) snippet = '...' + snippet;
    if (start + maxLength < cleanText.length) snippet = snippet + '...';
    return snippet;
  }
}
