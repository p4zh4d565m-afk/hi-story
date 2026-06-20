import type Database from 'better-sqlite3';

/**
 * FTS5 全文搜索引擎
 * 管理五个文学数据层的全文索引
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
  layers?: string[];        // Limit to specific layers
  maxResultsPerLayer?: number;
  maxTotalResults?: number;
  includeUserLayer?: boolean;
}

export class SearchEngine {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Initialize FTS5 tables for all search layers
   */
  initFTS(): void {
    // Create FTS5 tables for each layer
    for (const layer of SEARCH_LAYERS) {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS fts_${layer.name} USING fts5(
          title,
          content,
          source,
          tags,
          tokenize='unicode61'
        );
      `);
    }

    // Create a combined view for cross-layer search
    console.log('FTS5 indexes initialized for all 5 layers.');
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
      includeUserLayer = true,
    } = options;

    const targetLayers = layers
      ? SEARCH_LAYERS.filter(l => layers.includes(l.name))
      : includeUserLayer
        ? SEARCH_LAYERS
        : SEARCH_LAYERS.filter(l => l.name !== 'user');

    const allResults: SearchResult[] = [];

    for (const layer of targetLayers) {
      const layerResults = this.searchLayer(query, layer, maxResultsPerLayer);
      allResults.push(...layerResults);
    }

    // Sort by score descending
    allResults.sort((a, b) => b.score - a.score);

    return allResults.slice(0, maxTotalResults);
  }

  /**
   * Search a single FTS5 layer
   */
  private searchLayer(query: string, layer: SearchLayer, limit: number): SearchResult[] {
    try {
      // Sanitize FTS5 query
      const sanitized = query
        .replace(/['"]/g, '')
        .replace(/[+\-*^~()<>]/g, '')
        .trim();

      if (!sanitized) return [];

      // Use prefix matching for partial words
      const ftsQuery = sanitized.split(/\s+/).map(w => `"${w}"*`).join(' AND ');

      const stmt = this.db.prepare(`
        SELECT
          m.id,
          m.title,
          m.content,
          m.url as source,
          m.tags,
          fts_${layer.name}.rank AS score
        FROM fts_${layer.name}
        JOIN materials m ON m.id = fts_${layer.name}.rowid AND m.source_layer = ?
        WHERE fts_${layer.name} MATCH ?
        ORDER BY rank
        LIMIT ?
      `);

      const rows = stmt.all(layer.name, ftsQuery, limit) as any[];

      return rows.map((row: any) => {
        const snippet = this.generateSnippet(row.content, sanitized, 120);
        return {
          layer: layer.name,
          layerDisplay: layer.displayName,
          layerIcon: layer.icon,
          title: row.title,
          content: row.content,
          snippet,
          score: row.score ? Math.abs(row.score) : 0,
          source: row.source,
          materialId: row.id,
        };
      });
    } catch (err) {
      // If FTS table doesn't exist or query fails, return empty
      return [];
    }
  }

  /**
   * Generate a readable snippet showing the matched context
   */
  private generateSnippet(text: string, query: string, maxLength: number): string {
    const cleanText = text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    if (cleanText.length <= maxLength) return cleanText;

    // Find best matching position
    const terms = query.split(/\s+/);
    let bestPos = 0;
    let bestScore = -1;

    for (const term of terms) {
      const idx = cleanText.indexOf(term);
      if (idx !== -1) {
        const contextScore = Math.min(idx, cleanText.length - idx - term.length);
        if (bestScore === -1 || contextScore > bestScore) {
          bestScore = contextScore;
          bestPos = Math.max(0, idx - Math.floor(maxLength / 3));
        }
      } else {
        // Try case-insensitive
        const lowerText = cleanText.toLowerCase();
        const lowerTerm = term.toLowerCase();
        const cidx = lowerText.indexOf(lowerTerm);
        if (cidx !== -1) {
          bestPos = Math.max(0, cidx - Math.floor(maxLength / 3));
          break;
        }
      }
    }

    let snippet = cleanText.slice(bestPos, bestPos + maxLength);
    if (bestPos > 0) snippet = '...' + snippet;
    if (bestPos + maxLength < cleanText.length) snippet = snippet + '...';

    return snippet;
  }

  /**
   * Index a material document into its FTS layer
   */
  indexMaterial(materialId: string, layer: string, title: string, content: string, source: string, tags: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO fts_${layer} (rowid, title, content, source, tags)
      VALUES (?, ?, ?, ?, ?)
    `);

    // Get the material's rowid
    const material = this.db.prepare('SELECT rowid FROM materials WHERE id = ?').get(materialId) as { rowid: number } | undefined;
    if (!material) {
      console.warn(`Material ${materialId} not found for indexing`);
      return;
    }

    stmt.run(material.rowid, title, content, source, tags);
  }

  /**
   * Re-index all materials of a given layer
   */
  reindexLayer(layer: string): void {
    // Clear existing index
    this.db.exec(`DELETE FROM fts_${layer}`);

    // Re-index all materials in this layer
    const materials = this.db.prepare(
      'SELECT rowid, title, content, url, tags FROM materials WHERE source_layer = ?'
    ).all(layer) as any[];

    const stmt = this.db.prepare(`
      INSERT INTO fts_${layer} (rowid, title, content, source, tags)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const m of materials) {
      stmt.run(m.rowid, m.title, m.content, m.url || '', m.tags);
    }

    console.log(`Re-indexed ${materials.length} documents in layer "${layer}"`);
  }
}
