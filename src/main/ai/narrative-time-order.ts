/**
 * 叙事时间序 + 章节别名（并章）纯函数。
 * 零副作用、零 DB；不生成随机 ID。
 */

export type ChapterPosition = {
  id: string;
  projectId: string;
  sortOrder: number | null; // null = 墓碑
  deletedSortOrder: number | null;
};

export type ChapterAlias = {
  from: string;
  to: string;
  ordinalOffset: number;
};

function assertSameProject(a: ChapterPosition, b: ChapterPosition): void {
  if (a.projectId !== b.projectId) {
    throw new Error(`跨项目章节不可比较: ${a.projectId} vs ${b.projectId}`);
  }
}

/** 活跃章按 (sortOrder, id) 全序；跨项目抛错。墓碑不参与正常比较时由调用方过滤。 */
export function compareStoryPosition(a: ChapterPosition, b: ChapterPosition): number {
  assertSameProject(a, b);
  const ao = a.sortOrder;
  const bo = b.sortOrder;
  if (ao === null && bo === null) {
    const ad = a.deletedSortOrder ?? Number.POSITIVE_INFINITY;
    const bd = b.deletedSortOrder ?? Number.POSITIVE_INFINITY;
    if (ad !== bd) return ad < bd ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  }
  if (ao === null) return 1;
  if (bo === null) return -1;
  if (ao !== bo) return ao < bo ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function chaptersBefore(
  chapters: ChapterPosition[],
  target: ChapterPosition,
): ChapterPosition[] {
  return chapters
    .filter((c) => c.sortOrder !== null && compareStoryPosition(c, target) < 0)
    .sort(compareStoryPosition);
}

/** 活跃章重编号为 0..n-1；重复 id / 跨项目 / 缺 id 抛错。墓碑保留不动。 */
export function normalizeChapterOrder(chapters: ChapterPosition[]): ChapterPosition[] {
  if (chapters.some((c) => !c.id)) {
    throw new Error('章节缺少 id');
  }
  const ids = new Set<string>();
  for (const c of chapters) {
    if (ids.has(c.id)) throw new Error(`重复章节 id: ${c.id}`);
    ids.add(c.id);
  }
  const projectIds = new Set(chapters.map((c) => c.projectId));
  if (projectIds.size > 1) {
    throw new Error('跨项目章节不可规范化');
  }

  const active = chapters
    .filter((c) => c.sortOrder !== null)
    .slice()
    .sort(compareStoryPosition);
  const byId = new Map(chapters.map((c) => [c.id, c]));
  const next = chapters.map((c) => ({ ...c }));
  active.forEach((c, index) => {
    const row = next.find((n) => n.id === c.id)!;
    row.sortOrder = index;
    row.deletedSortOrder = null;
    byId.set(c.id, row);
  });
  return next;
}

export function deleteChapter(
  chapters: ChapterPosition[],
  deletedId: string,
): ChapterPosition[] {
  const target = chapters.find((c) => c.id === deletedId);
  if (!target) throw new Error(`章节不存在: ${deletedId}`);
  if (target.sortOrder === null) throw new Error(`章节已是墓碑: ${deletedId}`);

  const next = chapters.map((c) => {
    if (c.id !== deletedId) return { ...c };
    return {
      ...c,
      deletedSortOrder: c.sortOrder,
      sortOrder: null,
    };
  });
  return normalizeChapterOrder(next);
}

export function restoreChapter(
  chapters: ChapterPosition[],
  restoredId: string,
): ChapterPosition[] {
  const target = chapters.find((c) => c.id === restoredId);
  if (!target) throw new Error(`章节不存在: ${restoredId}`);
  if (target.sortOrder !== null) throw new Error(`章节非墓碑: ${restoredId}`);

  const activeCount = chapters.filter((c) => c.sortOrder !== null).length;
  const insertAt = Math.min(target.deletedSortOrder ?? activeCount, activeCount);

  const next = chapters.map((c) => {
    if (c.id === restoredId) {
      return { ...c, sortOrder: insertAt, deletedSortOrder: null };
    }
    if (c.sortOrder !== null && c.sortOrder >= insertAt) {
      return { ...c, sortOrder: c.sortOrder + 1 };
    }
    return { ...c };
  });
  return normalizeChapterOrder(next);
}

export function resolveChapterId(id: string, aliases: ChapterAlias[]): string {
  const visited = new Set<string>();
  let current = id;
  while (true) {
    if (visited.has(current)) {
      throw new Error(`章节别名循环: ${id}`);
    }
    visited.add(current);
    const edge = aliases.find((a) => a.from === current);
    if (!edge) return current;
    current = edge.to;
  }
}

/** 沿 alias 链递归累加每一级 ordinalOffset。 */
export function resolveTransitionOrdinal(
  atChapterId: string,
  atChapterOrdinal: number,
  aliases: ChapterAlias[],
): number {
  const visited = new Set<string>();
  let current = atChapterId;
  let ordinal = atChapterOrdinal;
  while (true) {
    if (visited.has(current)) {
      throw new Error(`章节别名循环: ${atChapterId}`);
    }
    visited.add(current);
    const edge = aliases.find((a) => a.from === current);
    if (!edge) return ordinal;
    ordinal += edge.ordinalOffset;
    current = edge.to;
  }
}

export function mergeChapters(
  chapters: ChapterPosition[],
  aliases: ChapterAlias[],
  survivingId: string,
  mergedId: string,
  ordinalOffset: number,
): { chapters: ChapterPosition[]; aliases: ChapterAlias[] } {
  if (mergedId === survivingId) {
    throw new Error('self-alias：不能把章并入自身');
  }
  if (ordinalOffset < 0) {
    throw new Error('非法 ordinalOffset：不得为负');
  }

  const surviving = chapters.find((c) => c.id === survivingId);
  const merged = chapters.find((c) => c.id === mergedId);
  if (!surviving || !merged) {
    throw new Error('并章源/目标不存在');
  }
  if (surviving.projectId !== merged.projectId) {
    throw new Error('跨项目不可并章');
  }
  if (surviving.sortOrder === null || merged.sortOrder === null) {
    throw new Error('源/目标已软删，不可并章');
  }
  if (aliases.some((a) => a.from === mergedId)) {
    throw new Error(`重复 from 别名: ${mergedId}`);
  }

  // 循环：surviving 最终归属是 merged
  try {
    if (resolveChapterId(survivingId, aliases) === mergedId) {
      throw new Error('并章会产生别名循环');
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes('循环')) throw e;
    throw e;
  }
  // 也检查追加后是否成环
  const provisional = [...aliases, { from: mergedId, to: survivingId, ordinalOffset }];
  resolveChapterId(mergedId, provisional);

  const tombstoned = deleteChapter(chapters, mergedId);
  return {
    chapters: tombstoned,
    aliases: provisional,
  };
}
