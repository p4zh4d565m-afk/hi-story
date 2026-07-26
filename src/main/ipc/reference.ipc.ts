/**
 * 参考文档库 IPC 通道
 * 提供导入参考小说、相似度匹配、全文搜索等功能
 * 搜索覆盖：用户导入的参考文档 + 系统开放的文学数据库
 *
 * 搜索管道：
 *   用户输入 → 清洗标点 → 短语 LIKE 搜索两库 → 跨组加权评分
 *   → 候选池构建 → AI 语义精排（有 AI 配置时）→ snippet 截取 → 返回
 *
 * 降级策略：
 *   - AI 未配置/调用失败/超时 → 回退到 LIKE 评分排序
 */

import { ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';
import { getDb, getLiteraryDb } from '../db/connection';
import {
  ReferenceRepo,
  type CreateReferenceDocInput,
  type FindSimilarInput,
  type SearchReferenceInput,
} from '../db/repositories/reference.repo';
import type { SimilarityResult, SearchAllResult } from '../ai/similarity';
import { aiSemanticRank, aiExpandQueryWords } from '../ai/ai-semantic-rank';
import type { ProviderConfig } from '../ai/provider';
import { ProviderFactory } from '../ai/provider-factory';

// ============================================================
// 内存缓存：同一查询 30 分钟内不重复调用 AI
// ============================================================

interface CachedSearch {
  userResults: SimilarityResult[];
  openResults: SimilarityResult[];
  aiRankedCount: number;
  time: number;
}

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 分钟
const searchCache = new Map<string, CachedSearch>();

// ============================================================
// 同义词配置加载
// ============================================================

let synonymConfig: Record<string, Record<string, string[]>> | null = null;
function getSynonymConfig(): Record<string, Record<string, string[]>> {
  if (synonymConfig) return synonymConfig;
  try {
    const configPath = path.join(__dirname, '..', 'ai', 'synonym-config.json');
    if (fs.existsSync(configPath)) {
      synonymConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch (err) {
    console.warn('加载同义词配置失败:', err);
  }
  return synonymConfig || {};
}

function getRepo(): ReferenceRepo {
  return new ReferenceRepo(getDb());
}

// ============================================================
// IPC 注册
// ============================================================

export function registerReferenceIpc(): void {
  // ── 导入参考文档 ──
  ipcMain.handle('db:reference:create', (_event, input: CreateReferenceDocInput) => {
    try {
      return getRepo().create(input);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // ── 查询所有参考文档 ──
  ipcMain.handle('db:reference:findAll', () => {
    try {
      return getRepo().findAll();
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // ── 根据文件路径查重（批量导入用）──
  ipcMain.handle('db:reference:findBySourceFile', (_event, sourceFile: string) => {
    try {
      const doc = getRepo().findBySourceFile(sourceFile);
      return { success: true, data: doc || null };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // ── 查询单个文档 ──
  ipcMain.handle('db:reference:findById', (_event, id: string) => {
    try {
      return getRepo().findById(id);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // ── 删除参考文档 ──
  ipcMain.handle('db:reference:remove', (_event, id: string) => {
    try {
      return getRepo().remove(id);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // ── 获取文档分块 ──
  ipcMain.handle('db:reference:getChunks', (_event, docId: string) => {
    try {
      return getRepo().getChunks(docId);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // ── 获取上下文块 ──
  ipcMain.handle(
    'db:reference:getContextChunks',
    (_event, docId: string, chunkIndex: number, beforeAfter?: number) => {
      try {
        return getRepo().getContextChunks(docId, chunkIndex, beforeAfter);
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  // ── 相似度匹配 ──
  ipcMain.handle('db:reference:findSimilar', (_event, input: FindSimilarInput) => {
    try {
      return getRepo().findSimilar(input);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // ── 全文搜索 ──
  ipcMain.handle('db:reference:search', (_event, input: SearchReferenceInput) => {
    try {
      return getRepo().searchFts(input.query, input.maxResults);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // ── 向量快速搜索（渐进式搜索第一阶段：0.5s 返回）
  // 如果向量索引未建好 / 维度不匹配 / API 不支持，一律返回 null 让前端降级
  ipcMain.handle('db:reference:searchVector', async (_event, query: string, aiConfig?: ProviderConfig, maxResults?: number) => {
    try {
      const max = maxResults || 15;
      const refRepo = getRepo();

      // 检查是否有向量索引
      if (!refRepo.hasEmbeddings()) {
        console.log('[searchVector] 向量索引未构建，返回 null 降级');
        return { success: true, data: null };
      }

      // 必须有 AI 配置才能调 Embedding API
      if (!aiConfig || !aiConfig.apiKey) {
        console.log('[searchVector] 无 AI 配置，返回 null 降级');
        return { success: true, data: null };
      }

      // DeepSeek 没有 Embedding API，直接降级
      if (aiConfig.name === 'deepseek') {
        console.log('[searchVector] DeepSeek 不支持 Embedding，直接降级');
        return { success: true, data: null };
      }

      // 1. 调用 Embedding API 将查询向量化
      console.log('[searchVector] 查询向量化: query=', query.slice(0, 50));
      console.log('[searchVector] Embedding 使用: name=', aiConfig.name, 'baseUrl=', aiConfig.baseUrl);
      const t0 = Date.now();
      const provider = ProviderFactory.create(aiConfig);
      const vectors = await provider.embed([query], { model: 'text-embedding-v3', dimensions: 1024 });
      const queryVec = vectors[0];
      console.log(`[searchVector] 向量化完成 (${Date.now() - t0}ms), 维度=${queryVec.length}`);

      // 2. 余弦相似度搜索（用户库 + 文学库）
      const userResults = refRepo.searchByEmbedding(queryVec, max);
      console.log(`[searchVector] 用户库向量搜索: ${userResults.data?.length || 0} 条 (${Date.now() - t0}ms)`);

      // 文学库向量搜索
      let openResults: SimilarityResult[] = [];
      try {
        const litRes = refRepo.searchLitByEmbedding(queryVec, max);
        openResults = litRes.success && litRes.data ? litRes.data : [];
      } catch { /* ignore */ }

      // 为文学库结果补全 content（向量表只有 rowid，没有 content）
      if (openResults.length > 0) {
        const litDb = getLiteraryDb();
        if (litDb) {
          const LAYER_LABELS: Record<string, string> = {
            public_domain: '公版文学', history_military: '历史军事',
            myth_fantasy: '神话志怪', dictionary: '词典修辞', user: '用户素材',
          };
          for (const r of openResults) {
            const litRowid = parseInt(r.chunkId.replace('lit_', ''), 10);
            const row = litDb.prepare(
              'SELECT title, content, source_layer FROM materials WHERE rowid = ?'
            ).get(litRowid) as Record<string, unknown> | undefined;
            if (row) {
              const layer = (row.source_layer as string) || '';
              r.docTitle = '[' + (LAYER_LABELS[layer] || layer) + '] ' + (row.title as string || '');
              r.content = (row.content as string) || '';
              r.source = 'open_library';
            }
          }
        }
      }

      // 3. 截取 snippet
      const cleanQuery = query.replace(/[^一-鿿㐀-䶿a-zA-Z0-9]/g, '');
      const uniqueSearchWords = [...new Set(cleanQuery.split('').filter(c => c.trim()))];
      for (const r of userResults.data || []) {
        r.content = generateSnippet(r.content, uniqueSearchWords, 150);
      }
      for (const r of openResults) {
        r.content = generateSnippet(r.content, uniqueSearchWords, 150);
      }

      const totalMs = Date.now() - t0;
      console.log(`[searchVector] 完成: user=${userResults.data?.length || 0}, open=${openResults.length}, 总耗时=${totalMs}ms`);

      return {
        success: true,
        data: {
          userResults: userResults.data || [],
          openResults,
          source: 'vector' as const,
        },
      };
    } catch (err) {
      console.error('[searchVector] 向量搜索失败，返回 null 降级:', (err as Error).message);
      return { success: true, data: null };
    }
  });

  // ── AI 精排向量搜索结果（渐进式搜索第二阶段）
  // 对向量快速结果做 AI 语义精排，返回替换结果
  ipcMain.handle('db:reference:rankVectorResults', async (_event, query: string, fastResults: SimilarityResult[], aiConfig?: ProviderConfig) => {
    try {
      if (!aiConfig || !aiConfig.apiKey) {
        return { success: true, data: { userResults: fastResults.filter(r => r.source === 'user_imported'), openResults: fastResults.filter(r => r.source === 'open_library') } };
      }

      console.log('[rankVectorResults] AI精排:', fastResults.length, '条候选');
      const ranked = await aiSemanticRank(query, fastResults, aiConfig, {
        maxCandidates: fastResults.length,
        snippetLength: 150,
        timeoutMs: 15000,
      });

      // 截取 snippet
      const cleanQuery = query.replace(/[^一-鿿㐀-䶿a-zA-Z0-9]/g, '');
      const uniqueSearchWords = [...new Set(cleanQuery.split('').filter(c => c.trim()))];
      for (const r of ranked) {
        if (!r.content.includes('…')) {
          r.content = generateSnippet(r.content, uniqueSearchWords, 150);
        }
      }

      const sortedUser = ranked.filter(r => r.source === 'user_imported').slice(0, 20);
      const sortedOpen = ranked.filter(r => r.source === 'open_library').slice(0, 20);

      console.log('[rankVectorResults] 完成: user=', sortedUser.length, 'open=', sortedOpen.length);
      return {
        success: true,
        data: { userResults: sortedUser, openResults: sortedOpen } as SearchAllResult,
      };
    } catch (err) {
      console.error('[rankVectorResults] 失败，返回原结果:', (err as Error).message);
      return {
        success: true,
        data: {
          userResults: fastResults.filter(r => r.source === 'user_imported'),
          openResults: fastResults.filter(r => r.source === 'open_library'),
        },
      };
    }
  });

  // ── 降级搜索：LIKE → 候选池 → AI 精排（多 provider 降级）→ 返回
  // 向量索引未建好时走此通道，保留完整 AI 精排体验
  ipcMain.handle('db:reference:fallbackSearch', async (_event, query: string, maxResults?: number, aiConfigs?: ProviderConfig | ProviderConfig[]) => {
    try {
      const max = maxResults || 20;
      const cleaned = query.trim();
      if (!cleaned) return { success: true, data: { userResults: [], openResults: [] } };

      // 清洗标点符号，仅保留汉字/字母/数字用于 LIKE 搜索
      const cleanQuery = query.replace(/[^一-鿿㐀-䶿a-zA-Z0-9]/g, '');
      console.log('[fallbackSearch] 输入:', JSON.stringify(query), '→ 清洗:', JSON.stringify(cleanQuery));
      console.log('[fallbackSearch] max=', max);

      // 提取关键词组（用于 snippet 截取和日志）
      const keywordGroups = extractKeywordGroups(cleanQuery);
      const allSearchWords = keywordGroups.flatMap(g => g.words);
      const uniqueSearchWords = [...new Set(allSearchWords)];

      // 命中条目类型
      type HitEntry = { result: SimilarityResult; hitCount: number; groupHitSet: Set<number> };

      // ═══ 1. 用户导入的参考文档 ═══
      // 多关键词 OR 搜索：将清洗后查询拆成 2-3 字片段分别 LIKE
      // 这样搜"我想你了"→ 搜 %我想% OR %想你% OR %你了%，不会因整短语不匹配而零结果
      const userHits = new Map<string, HitEntry>();
      const refRepo = getRepo();

      if (cleanQuery.length >= 1) {
        // 二段式分词：停用字切分 → 片段内滑动，避免无意义碎片
        const searchKeys = generateSearchKeys(cleanQuery);
        console.log('[fallbackSearch] 搜索关键词:', searchKeys, 'searchKeyCount=', searchKeys.length);

        for (const kw of searchKeys.slice(0, 10)) {
          console.log('[fallbackSearch] 搜索用户库关键词:', JSON.stringify(kw));
          const limit = Math.max(10, Math.floor(max * 3 / searchKeys.length));
          const kwResults = refRepo.searchByKeyword(kw, limit);
          console.log('[fallbackSearch] 关键词结果:', kwResults.success, 'count=', kwResults.data?.length || 0);
          if (kwResults.success && kwResults.data) {
            for (const r of kwResults.data) {
              r.source = 'user_imported';
              r.matchSource = 'keyword';
              const existing = userHits.get(r.chunkId);
              if (existing) {
                existing.hitCount++;
              } else {
                userHits.set(r.chunkId, { result: r, hitCount: 1, groupHitSet: new Set([0]) });
              }
            }
          }
        }
      }

      // ═══ 2. 系统开放的文学数据库 ═══
      const openHits = new Map<string, HitEntry>();
      const LAYER_LABELS: Record<string, string> = {
        public_domain: '公版文学',
        history_military: '历史军事',
        myth_fantasy: '神话志怪',
        dictionary: '词典修辞',
        user: '用户素材',
      };

      const litDb = getLiteraryDb();
      if (litDb && cleanQuery.length >= 1) {
        try {
          // 复用同一套二段式分词
          const litSearchKeys = generateSearchKeys(cleanQuery);

          for (const kw of litSearchKeys.slice(0, 10)) {
            const likePattern = '%' + kw.replace(/[%_]/g, '') + '%';
            const litRows = litDb.prepare(`
              SELECT rowid as row_id, source_layer, title, content, url, tags
              FROM materials WHERE content LIKE ? LIMIT ?
            `).all(likePattern, Math.max(10, Math.floor(max * 3 / litSearchKeys.length))) as Record<string, unknown>[];

            for (const row of litRows) {
              const content = (row.content as string) || '';
              const chunkId = 'lit_' + row.row_id;
              const docTitle = (row.title as string) || '';
              const layer = (row.source_layer as string) || '';
              const layerLabel = LAYER_LABELS[layer] || layer;

              if (openHits.has(chunkId)) {
                const existing = openHits.get(chunkId)!;
                existing.hitCount++;
              } else {
                openHits.set(chunkId, {
                  result: {
                    chunkId,
                    docId: 'lit_doc_' + layer,
                    docTitle: '[' + layerLabel + '] ' + docTitle,
                    docAuthor: undefined,
                    content: content,
                    chunkIndex: 0,
                    score: 0,
                    matchPercentage: 0,
                    source: 'open_library' as const,
                    matchSource: 'keyword' as const,
                  },
                  hitCount: 1,
                  groupHitSet: new Set([0]),
                });
              }
            }
          }
        } catch { /* ignore */ }
      }

      // ═══ 3. 评分与候选池构建 ═══
      const calcScore = (hitCount: number, groupCount: number): number =>
        groupCount * 100 + (hitCount - groupCount) * 10 + hitCount;

      const processCandidatePool = (hits: Map<string, HitEntry>): SimilarityResult[] => {
        const items: SimilarityResult[] = [];
        for (const { result, hitCount, groupHitSet } of hits.values()) {
          const score = calcScore(hitCount, groupHitSet.size);
          result.score = score;
          result.matchPercentage = score;
          items.push(result);
        }
        items.sort((a, b) => b.score - a.score);
        return items.slice(0, 60);
      };

      const finalUserPool = processCandidatePool(userHits);
      const finalOpenPool = processCandidatePool(openHits);

      console.log('[fallbackSearch] LIKE 候选池: user=', finalUserPool.length, 'open=', finalOpenPool.length);

      // ═══ 4. AI 语义精排（多 provider 降级 + 内存缓存）═══
      const allCandidates = [...finalUserPool, ...finalOpenPool];

      // 无候选 → 直接返回空
      if (allCandidates.length === 0) {
        console.log('[fallbackSearch] 无候选，直接返回空');
        return { success: true, data: { userResults: [], openResults: [], debugLog: ['[fallbackSearch] 无候选'] } as SearchAllResult };
      }

      // ── 内存缓存：同一 cleanQuery 30 分钟内不重复调 AI ──
      const cacheKey = cleanQuery;
      const cached = searchCache.get(cacheKey);
      if (cached && Date.now() - cached.time < CACHE_TTL_MS) {
        const ageSec = Math.round((Date.now() - cached.time) / 1000);
        console.log('[fallbackSearch] 🚀 命中缓存: ' + cacheKey + ' (距今' + ageSec + 's), AI精排=' + cached.aiRankedCount + '条');
        // 缓存中存的是分离后的结果，直接返回
        const sortedUser = cached.userResults.slice(0, max);
        const sortedOpen = cached.openResults.slice(0, max);
        return {
          success: true,
          data: {
            userResults: sortedUser,
            openResults: sortedOpen,
            debugLog: ['[fallbackSearch] 🚀 命中缓存: ' + cacheKey + ' (距今' + ageSec + 's)'],
          } as SearchAllResult,
        };
      }

      // 规范化配置列表
      const configList: ProviderConfig[] = Array.isArray(aiConfigs) ? aiConfigs : (aiConfigs ? [aiConfigs] : []);
      console.log('[fallbackSearch] 可用 AI 配置: ' + configList.map(c => c.name).join(' → ') + ', 候选=' + allCandidates.length);

      // 多 provider 逐个尝试：通义千问 → 豆包 → DeepSeek（前端已按优先级排序）
      let rankedAll: SimilarityResult[] | null = null;
      let aiSucceeded: string | null = null;
      const debugLogs: string[] = [];

      if (configList.length > 0) {
        // 过滤掉明显无效的配置（空 baseUrl、空 model 等）
        const validConfigs = configList.filter(c => c.apiKey && c.apiKey.length > 5);
        debugLogs.push('[fallbackSearch] 有效 AI 配置: ' + validConfigs.map(c => c.name).join(' → '));

        for (const cfg of validConfigs) {
          const attemptMsg = '[fallbackSearch] 尝试 AI 精排: provider=' + cfg.name + ' model=' + cfg.model + ' baseUrl=' + (cfg.baseUrl || '(无)');
          console.log(attemptMsg);
          debugLogs.push(attemptMsg);
          try {
            // qwen 搜索精排加速：用 turbo 模型
            const searchConfig = { ...cfg };
            if (cfg.name === 'qwen') {
              searchConfig.model = 'qwen-turbo';
            }

            const t0 = Date.now();
            const attemptMsg2 = '[fallbackSearch] 尝试 AI 精排: provider=' + searchConfig.name + ' model=' + searchConfig.model + ' baseUrl=' + (searchConfig.baseUrl || '(无)');
            console.log(attemptMsg2);
            debugLogs.push(attemptMsg2);

            // 每个 provider 8 秒超时
            rankedAll = await aiSemanticRank(query, allCandidates, searchConfig, {
              maxCandidates: Math.min(allCandidates.length, 20),
              snippetLength: 80,
              timeoutMs: 8000,
            });
            const tElapsed = Date.now() - t0;
            debugLogs.push('[fallbackSearch] ' + searchConfig.name + ' 耗时: ' + tElapsed + 'ms');
            // 检查是否真正精排了（matchSource === 'ai_ranked'）
            const aiCount = rankedAll.filter(r => r.matchSource === 'ai_ranked').length;
            if (aiCount > 0) {
              aiSucceeded = searchConfig.name;
              const okMsg = '[fallbackSearch] ✓ AI 精排成功: provider=' + searchConfig.name + ' model=' + searchConfig.model + ', 精排=' + aiCount + '条, 耗时=' + tElapsed + 'ms';
              console.log(okMsg);
              debugLogs.push(okMsg);
              break; // 成功，跳出循环
            } else {
              const failMsg = '[fallbackSearch] ✗ AI 精排无结果: provider=' + searchConfig.name + ', 返回了 ' + rankedAll.length + '条但无 ai_ranked 标记（JSON 解析可能失败）';
              console.warn(failMsg);
              debugLogs.push(failMsg);
            }
          } catch (err) {
            const errMsg = '[fallbackSearch] ✗ AI 精排异常: ' + (err instanceof Error ? err.message : String(err));
            console.error(errMsg);
            debugLogs.push(errMsg);
          }
        }
      } else {
        debugLogs.push('[fallbackSearch] 无 AI 配置可用');
      }

      if (!aiSucceeded) {
        const fallbackMsg = '[fallbackSearch] ⚠ 所有 AI 精排均失败，使用 LIKE 评分排序';
        console.log(fallbackMsg);
        debugLogs.push(fallbackMsg);
        rankedAll = allCandidates;
      }

      // 防御性检查
      if (!rankedAll || rankedAll.length === 0) {
        rankedAll = allCandidates;
      }

      // ═══ 5. 截取 snippet 并分离来源 ═══
      for (const r of rankedAll) {
        // AI 精排结果已有 matchedSentence，不需要再按关键词截取
        if (r.matchSource === 'ai_ranked') continue;
        if (!r.content.includes('…')) {
          r.content = generateSnippet(r.content, uniqueSearchWords, 150);
        }
      }

      const sortedUser = rankedAll.filter(r => r.source === 'user_imported').slice(0, max);
      const sortedOpen = rankedAll.filter(r => r.source === 'open_library').slice(0, max);

      const aiRankedCountUser = sortedUser.filter(r => r.matchSource === 'ai_ranked').length;
      const aiRankedCountOpen = sortedOpen.filter(r => r.matchSource === 'ai_ranked').length;

      console.log('[fallbackSearch] 最终结果: user=', sortedUser.length, `(AI精排${aiRankedCountUser}条)`, 'open=', sortedOpen.length, `(AI精排${aiRankedCountOpen}条)`);

      // ── 写入缓存 ──
      if (aiSucceeded) {
        searchCache.set(cacheKey, {
          userResults: sortedUser,
          openResults: sortedOpen,
          aiRankedCount: aiRankedCountUser + aiRankedCountOpen,
          time: Date.now(),
        });
        debugLogs.push('[fallbackSearch] 💾 已缓存: ' + cacheKey);
      }

      return {
        success: true,
        data: { userResults: sortedUser, openResults: sortedOpen, debugLog: debugLogs } as SearchAllResult,
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });
}

// ============================================================
// 搜索辅助函数
// ============================================================

/**
 * 单个词的扩展：查 synonym-config.json，返回原词 + 所有匹配的同义词
 */
function expandWord(word: string): string[] {
  const config = getSynonymConfig();
  const result = new Set<string>();
  result.add(word);

  for (const category of Object.values(config)) {
    for (const [key, synonyms] of Object.entries(category)) {
      if (word === key || key.includes(word) || word.includes(key)) {
        result.add(key);
        for (const s of synonyms) result.add(s);
      }
      if (synonyms.includes(word)) {
        result.add(key);
        for (const s of synonyms) result.add(s);
      }
    }
  }

  return [...result];
}

// ============================================================
// 二段式分词：停用字切分 → 片段内滑动窗口
// 避免生成 "你好世"、"好世" 这种跨词边界的无意义碎片
// ============================================================

/** 高频虚词/介词/连词，不太可能作为核心意象词出现，用作切分边界 */
const STOP_CHARS = new Set(
  '的了吗呢啊吧呀么着过是就都会很也还更再这与不那之而其和但或及在从被把向对于因'.split(''),
);

/**
 * 将清洗后的查询文本拆成有意义的搜索关键词
 *
 * 二段式分词：
 *   1. 用停用字将输入切分成片段
 *   2. 每个片段内做 2-3 字滑动窗口
 *   3. 最终集合 = 原查询 + 各片段词（去重）
 *
 * 示例：
 *   "在黄昏里思念故乡" → 清洗 → "在黄昏里思念故乡"
 *   → 停用字切分 → ["黄昏里思念故乡"]  （"在"被切掉）
 *   → 片段内滑动 → ["黄昏", "昏里", "里思", "思念", "念故", "故乡",
 *                    "黄昏里", "昏里思", "里思念", "思念故", "念故乡"]
 *   → 最终: ["在黄昏里思念故乡", "黄昏", "思念", "故乡", ...]（去重）
 *
 * 单字输入（长度 1-3）直接返回自身，不拆分。
 */
function generateSearchKeys(cleanQuery: string): string[] {
  if (!cleanQuery || cleanQuery.length === 0) return [];

  const keys = new Set<string>();

  // 长度 ≤ 3 的短词，直接作为搜索词（不需要拆分）
  if (cleanQuery.length <= 3) {
    keys.add(cleanQuery);
    return [...keys];
  }

  // ── 1. 停用字切分 ──
  // 用停用字作为分隔符，把输入切成有意义的连续片段
  const segments: string[] = [];
  let current = '';
  for (const ch of cleanQuery) {
    if (STOP_CHARS.has(ch)) {
      if (current.length > 0) {
        segments.push(current);
        current = '';
      }
      // 停用字本身不加入片段
    } else {
      current += ch;
    }
  }
  if (current.length > 0) segments.push(current);

  // 如果没有切出任何片段（全是停用字），返回空
  if (segments.length === 0) return [];

  // ── 2. 片段内滑动窗口 ──
  // 每个片段内部生成 2-3 字窗口词
  const segmentTerms: string[] = [];
  for (const seg of segments) {
    if (seg.length <= 3) {
      segmentTerms.push(seg);
    } else {
      for (let n = 2; n <= 3; n++) {
        for (let i = 0; i <= seg.length - n; i++) {
          segmentTerms.push(seg.slice(i, i + n));
        }
      }
    }
  }

  // ── 3. 合并去重（原词 + 片段词），限制数量 ──
  keys.add(cleanQuery);
  for (const t of segmentTerms) {
    keys.add(t);
    if (keys.size >= 30) break;
  }

  return [...keys].slice(0, 30);
}

/**
 * 从查询文本提取关键词组
 */
function extractKeywordGroups(query: string): Array<{ groupIndex: number; words: string[] }> {
  const cleaned = query.replace(/[^一-鿿㐀-䶿a-zA-Z0-9]/g, '').trim();
  if (!cleaned) return [];

  // 提取核心词
  const core: string[] = [];

  if (cleaned.length <= 4) {
    core.push(cleaned);
  } else {
    const seen = new Set<string>();
    const skipChars = /[的了吗呢吧啊呀么着过是就都会很也还更再这与不那之而其]/g;

    for (let n = 2; n <= 4; n++) {
      for (let i = 0; i <= cleaned.length - n; i++) {
        const chunk = cleaned.slice(i, i + n);
        if (/^[，。！？、；：""''（）《》...\-\—\s]+$/.test(chunk)) continue;
        if (chunk.replace(skipChars, '').length < 2) continue;
        if (!seen.has(chunk)) {
          seen.add(chunk);
          core.push(chunk);
        }
      }
    }

    if (core.length > 20) {
      const step = Math.ceil(core.length / 20);
      for (let i = core.length - 1; i >= 0; i--) {
        if (i % step !== 0) core.splice(i, 1);
      }
    }
  }

  // 对每个核心词做复合词拆分
  const groups: Array<{ groupIndex: number; words: string[] }> = [];

  for (const word of core) {
    const expanded = expandWord(word);

    if (expanded.length > 1) {
      groups.push({ groupIndex: groups.length, words: expanded });
    } else {
      const chars = Array.from(word);
      for (const ch of chars) {
        const charExpanded = expandWord(ch);
        groups.push({ groupIndex: groups.length, words: charExpanded });
      }
    }
  }

  // 去重
  const seen = new Set<string>();
  const deduped: Array<{ groupIndex: number; words: string[] }> = [];
  for (const g of groups) {
    const key = g.words.sort().join(',');
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(g);
    }
  }

  return deduped;
}

/**
 * 从长文本中截取与关键词最相关的片段
 * 以命中关键词位置为中心，按句子边界（。！？；）扩展，硬上限 150 字
 */
function generateSnippet(text: string, keywords: string[], length: number = 150): string {
  if (text.length <= length) return text;

  // 找到第一个关键词命中的位置
  let bestPos = 0;
  for (const kw of keywords) {
    const idx = text.indexOf(kw);
    if (idx >= 0) { bestPos = idx; break; }
  }

  // 从命中位置向左找句子开头（上一个句末之后）
  const SENTENCE_END = /[。！？；]/g;
  let sentenceStart = 0;
  let lastEnd = 0;
  SENTENCE_END.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SENTENCE_END.exec(text)) !== null) {
    if (m.index >= bestPos) break;
    lastEnd = m.index + 1;
  }
  sentenceStart = lastEnd;

  // 从命中位置向右找句子结尾
  SENTENCE_END.lastIndex = bestPos;
  const nextEnd = SENTENCE_END.exec(text);
  let sentenceEnd = text.length;
  if (nextEnd) sentenceEnd = nextEnd.index + 1;

  // 关键句内容
  const keySentence = text.slice(sentenceStart, sentenceEnd).trim();

  // 如果关键句本身已经超过上限，硬截断到上限
  if (keySentence.length > length) {
    return '…' + keySentence.slice(0, length - 1) + '…';
  }

  // 以关键句为中心，向外扩展相邻句子，直到触及上限
  let result = keySentence;
  let expanded = true;

  while (expanded) {
    expanded = false;
    const currentLen = result.length;

    // 优先向后扩展（关键句之后的句子通常有更多语境）
    if (sentenceEnd < text.length) {
      SENTENCE_END.lastIndex = sentenceEnd;
      const afterEnd = SENTENCE_END.exec(text);
      const nextEndPos = afterEnd ? afterEnd.index + 1 : text.length;
      const nextSentence = text.slice(sentenceEnd, nextEndPos).trim();
      if (nextSentence && currentLen + nextSentence.length <= length) {
        result = result + nextSentence;
        sentenceEnd = nextEndPos;
        expanded = true;
        continue;
      }
    }

    // 再向前扩展
    if (sentenceStart > 0) {
      SENTENCE_END.lastIndex = 0;
      let prevEnd = 0;
      while ((m = SENTENCE_END.exec(text)) !== null) {
        if (m.index >= sentenceStart - 2) break;
        prevEnd = m.index + 1;
      }
      const prevSentence = text.slice(prevEnd, sentenceStart).trim();
      if (prevSentence && currentLen + prevSentence.length <= length) {
        result = prevSentence + result;
        sentenceStart = prevEnd;
        expanded = true;
      }
    }
  }

  // 添加省略号标记
  if (sentenceStart > 0) result = '…' + result;
  if (sentenceEnd < text.length) result = result + '…';

  // 最终硬截断（兜底）
  if (result.length > length + 3) {
    result = result.slice(0, length) + '…';
  }

  return result;
}
