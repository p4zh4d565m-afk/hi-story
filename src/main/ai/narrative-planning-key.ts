/**
 * 规划章身份 + 批量运行不变量纯函数。
 * 不生成随机 ID：新 id 一律由调用方预分配传入。
 */

export type OutlineIdentity = {
  id: string;
  volumeIndex: number;
  chapterNumber: number;
  title: string;
};

export type OutlineDraft = Omit<OutlineIdentity, 'id'>;

export function sameOutlineIdentity(a: OutlineIdentity, b: OutlineIdentity): boolean {
  return a.id === b.id;
}

export function assignChapterOutlineIds<T extends { id?: string }>(
  items: T[],
  allocateId: () => string,
): Array<T & { id: string }> {
  const seen = new Set<string>();
  return items.map((item) => {
    const existing = typeof item.id === 'string' ? item.id.trim() : '';
    const id = existing || allocateId();
    if (seen.has(id)) throw new Error(`章纲 id 重复: ${id}`);
    seen.add(id);
    return { ...item, id };
  });
}

export function findChapterForOutline<T extends {
  planningOutlineId?: string | null;
  planningOutline?: { volumeIndex: number; chapterNumber: number } | null;
}>(
  chapters: T[],
  outline: { id?: string; volumeIndex: number; chapterNumber: number },
): T | undefined {
  if (outline.id) {
    const byId = chapters.find((c) => c.planningOutlineId === outline.id);
    if (byId) return byId;
  }
  return chapters.find((c) =>
    c.planningOutline?.volumeIndex === outline.volumeIndex
    && c.planningOutline?.chapterNumber === outline.chapterNumber
  );
}

export function splitOutlineIdentity(
  original: OutlineIdentity,
  newChapterId: string,
): { original: OutlineIdentity; newChapter: OutlineIdentity } {
  if (newChapterId === original.id) {
    throw new Error('拆章新章 id 不得与原章相同');
  }
  return {
    original: { ...original },
    newChapter: {
      id: newChapterId,
      volumeIndex: original.volumeIndex,
      chapterNumber: original.chapterNumber,
      title: original.title,
    },
  };
}

export function mapRegeneratedOutlineIds(
  oldOnes: OutlineIdentity[],
  newOnes: OutlineDraft[],
  mapping: Array<{ oldId: string; newIndex: number }>,
  freshIds: Record<number, string>,
): OutlineIdentity[] {
  const oldById = new Map(oldOnes.map((o) => [o.id, o]));
  const seenOld = new Set<string>();
  const mappedIndexes = new Set<number>();

  for (const m of mapping) {
    if (!oldById.has(m.oldId)) {
      throw new Error(`oldId 不存在: ${m.oldId}`);
    }
    if (seenOld.has(m.oldId)) {
      throw new Error(`oldId 重复: ${m.oldId}`);
    }
    seenOld.add(m.oldId);
    if (m.newIndex < 0 || m.newIndex >= newOnes.length) {
      throw new Error(`newIndex 越界: ${m.newIndex}`);
    }
    if (mappedIndexes.has(m.newIndex)) {
      throw new Error(`newIndex 重复: ${m.newIndex}`);
    }
    mappedIndexes.add(m.newIndex);
  }

  for (const key of Object.keys(freshIds)) {
    const idx = Number(key);
    if (!Number.isInteger(idx) || idx < 0 || idx >= newOnes.length) {
      throw new Error(`freshIds index 越界: ${key}`);
    }
    if (mappedIndexes.has(idx)) {
      throw new Error(`mapping 与 freshIds index 冲突: ${idx}`);
    }
  }

  const reusedOldIds = new Set(mapping.map((m) => m.oldId));
  const freshValues = Object.values(freshIds);
  const freshSet = new Set(freshValues);
  if (freshSet.size !== freshValues.length) {
    throw new Error('freshIds 含重复最终 ID');
  }
  for (const id of freshValues) {
    if (reusedOldIds.has(id)) {
      throw new Error(`fresh ID 与 mapping 复用旧 ID 冲突: ${id}`);
    }
  }

  const result: OutlineIdentity[] = newOnes.map((draft, index) => {
    const mapped = mapping.find((m) => m.newIndex === index);
    if (mapped) {
      return { ...draft, id: mapped.oldId };
    }
    const fresh = freshIds[index];
    if (!fresh) {
      throw new Error(`缺少 freshId: index ${index}`);
    }
    return { ...draft, id: fresh };
  });

  const finalIds = result.map((r) => r.id);
  if (new Set(finalIds).size !== finalIds.length) {
    throw new Error('最终 id 重复');
  }
  return result;
}

export type PlanningBinding = {
  outlineId: string;
  chapterId: string;
  tombstoned: boolean;
};

export function canRebindPlanningKey(existing: PlanningBinding[], outlineId: string): boolean {
  const hit = existing.find((b) => b.outlineId === outlineId);
  if (!hit) return true;
  if (hit.tombstoned) return false;
  return false; // 已有未删除绑定也不可自动重绑
}

export function replacePlanningBinding(
  existing: PlanningBinding[],
  outlineId: string,
  newChapterId: string,
): PlanningBinding[] {
  const others = existing.filter((b) => b.outlineId !== outlineId);
  return [...others, { outlineId, chapterId: newChapterId, tombstoned: false }];
}

export function resolveObsidianOutlineIdentity(candidate: {
  explicitId?: string;
  pathHash: string;
}): { id: string | null; reason: 'explicit' | 'no-key' } {
  void candidate.pathHash;
  if (candidate.explicitId) {
    return { id: candidate.explicitId, reason: 'explicit' };
  }
  return { id: null, reason: 'no-key' };
}

export type BatchChapter = {
  chapterId: string;
  textHash: string;
  status: 'pending' | 'running' | 'done' | 'cancelled';
};

export type BatchRunState = {
  chapters: BatchChapter[];
  tempSummaries: Array<{ forChapterId: string; sourceHash: string; text: string }>;
  unconfirmedProposals: Array<{ forChapterId: string }>;
};

export function invalidateBatchAfterChapter(
  state: BatchRunState,
  changedIndex: number,
): BatchRunState {
  const cancelledIds = new Set<string>();
  const chapters = state.chapters.map((c, index) => {
    if (index <= changedIndex) return { ...c };
    if (c.status === 'pending' || c.status === 'running') {
      cancelledIds.add(c.chapterId);
      return { ...c, status: 'cancelled' as const };
    }
    return { ...c };
  });

  return {
    chapters,
    tempSummaries: state.tempSummaries.filter((t) => !cancelledIds.has(t.forChapterId)),
    unconfirmedProposals: state.unconfirmedProposals.filter(
      (p) => !cancelledIds.has(p.forChapterId),
    ),
  };
}
