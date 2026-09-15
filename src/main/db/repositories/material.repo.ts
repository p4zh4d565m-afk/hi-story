/**
 * 素材（参考材料）Repository
 * 管理用户收集的素材：支持项目级与全局（project_id 为 null）两类。
 * 从 entities.ipc.ts 的旧 SQL 抽离出来，统一走 Repo 层，补齐 source_layer 校验。
 */

import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { IpcResult, Material } from '../../../renderer/types';

/** materials.source_layer 允许的取值（与 migrations 的 CHECK 约束一致） */
export const MATERIAL_SOURCE_LAYERS = [
  'public_domain',
  'history_military',
  'myth_fantasy',
  'dictionary',
  'user',
] as const;

export type MaterialSourceLayer = (typeof MATERIAL_SOURCE_LAYERS)[number];

export interface CreateMaterialInput {
  projectId?: string | null;
  title: string;
  content?: string;
  sourceLayer?: string;
  url?: string | null;
  tags?: string[];
}

export interface UpdateMaterialInput {
  title?: string;
  content?: string;
  tags?: string[];
}

/** 非法 source_layer 统一回退到 'user'，避免触发 CHECK 约束导致写库报错 */
function normalizeSourceLayer(raw: string | undefined): MaterialSourceLayer {
  return (MATERIAL_SOURCE_LAYERS as readonly string[]).includes(raw ?? '')
    ? (raw as MaterialSourceLayer)
    : 'user';
}

function rowToMaterial(row: Record<string, unknown>): Material {
  let tags: string[] = [];
  try {
    tags = JSON.parse((row.tags as string) || '[]');
  } catch { tags = []; }
  return {
    id: row.id as string,
    projectId: (row.project_id as string) ?? null,
    sourceLayer: (row.source_layer as MaterialSourceLayer) ?? 'user',
    title: row.title as string,
    content: (row.content as string) ?? '',
    url: (row.url as string) ?? null,
    tags,
    createdAt: row.created_at as string,
  };
}

export class MaterialRepo {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  create(input: CreateMaterialInput): IpcResult<Material> {
    const id = uuidv4();
    const now = new Date().toISOString();
    const sourceLayer = normalizeSourceLayer(input.sourceLayer);
    const tags = JSON.stringify(input.tags ?? []);

    this.db.prepare(`
      INSERT INTO materials (id, project_id, source_layer, title, content, url, tags, created_at)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(
      id,
      input.projectId || null,
      sourceLayer,
      input.title,
      input.content ?? '',
      input.url ?? null,
      tags,
      now,
    );

    return this.findById(id);
  }

  findById(id: string): IpcResult<Material> {
    const row = this.db.prepare('SELECT * FROM materials WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return { success: false, error: '素材不存在' };
    return { success: true, data: rowToMaterial(row) };
  }

  findByProject(projectId: string): IpcResult<Material[]> {
    const rows = this.db.prepare(
      'SELECT * FROM materials WHERE project_id = ? ORDER BY created_at DESC'
    ).all(projectId) as Record<string, unknown>[];
    return { success: true, data: rows.map(rowToMaterial) };
  }

  findGlobal(): IpcResult<Material[]> {
    const rows = this.db.prepare(
      'SELECT * FROM materials WHERE project_id IS NULL ORDER BY created_at DESC'
    ).all() as Record<string, unknown>[];
    return { success: true, data: rows.map(rowToMaterial) };
  }

  update(id: string, input: UpdateMaterialInput): IpcResult<Material> {
    const existing = this.db.prepare('SELECT * FROM materials WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!existing) return { success: false, error: '素材不存在' };

    // 读-改-写合并：未传字段保留旧值
    const nextTitle = input.title ?? (existing.title as string);
    const nextContent = input.content ?? (existing.content as string);
    let nextTags: string;
    if (input.tags === undefined) {
      nextTags = existing.tags as string;
    } else {
      nextTags = JSON.stringify(input.tags);
    }

    this.db.prepare('UPDATE materials SET title=?, content=?, tags=? WHERE id=?')
      .run(nextTitle, nextContent, nextTags, id);

    return this.findById(id);
  }

  remove(id: string): IpcResult<void> {
    const res = this.db.prepare('DELETE FROM materials WHERE id = ?').run(id);
    if (res.changes === 0) return { success: false, error: '素材不存在' };
    return { success: true };
  }
}
