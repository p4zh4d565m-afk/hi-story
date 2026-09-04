import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { IpcResult, MasterOutline, PlanningIdea, StoryOption, VolumeOutline } from '../../../renderer/types';

export interface SavePlanningIdeaInput {
  projectId: string;
  idea: string;
  requirements?: string;
  generatedOptions?: StoryOption[];
  selectedOption?: number | null;
  status?: PlanningIdea['status'];
  masterOutline?: MasterOutline | null;
  outlineStatus?: PlanningIdea['outlineStatus'];
  volumeOutlines?: VolumeOutline[];
  volumeStatus?: PlanningIdea['volumeStatus'];
}

export class PlanningRepo {
  constructor(private db: Database.Database) {}

  findByProject(projectId: string): IpcResult<PlanningIdea | null> {
    const row = this.db.prepare(
      'SELECT * FROM planning_ideas WHERE project_id = ? ORDER BY updated_at DESC LIMIT 1',
    ).get(projectId) as Record<string, unknown> | undefined;
    return { success: true, data: row ? this.rowToPlanningIdea(row) : null };
  }

  save(input: SavePlanningIdeaInput): IpcResult<PlanningIdea> {
    const existing = this.db.prepare(
      'SELECT id FROM planning_ideas WHERE project_id = ? ORDER BY updated_at DESC LIMIT 1',
    ).get(input.projectId) as { id: string } | undefined;
    const now = new Date().toISOString();

    if (existing) {
      this.db.prepare(`
        UPDATE planning_ideas
        SET idea = ?, requirements = ?, generated_options = ?, selected_option = ?, status = ?,
            master_outline = ?, outline_status = ?, volume_outlines = ?, volume_status = ?, updated_at = ?
        WHERE id = ?
      `).run(
        input.idea,
        input.requirements ?? '',
        JSON.stringify(input.generatedOptions ?? []),
        input.selectedOption ?? null,
        input.status ?? 'draft',
        input.masterOutline ? JSON.stringify(input.masterOutline) : '',
        input.outlineStatus ?? 'empty',
        JSON.stringify(input.volumeOutlines ?? []),
        input.volumeStatus ?? 'empty',
        now,
        existing.id,
      );
      return this.findById(existing.id);
    }

    const id = uuidv4();
    this.db.prepare(`
      INSERT INTO planning_ideas
        (id, project_id, idea, requirements, generated_options, selected_option, status, master_outline, outline_status, volume_outlines, volume_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.projectId,
      input.idea,
      input.requirements ?? '',
      JSON.stringify(input.generatedOptions ?? []),
      input.selectedOption ?? null,
      input.status ?? 'draft',
      input.masterOutline ? JSON.stringify(input.masterOutline) : '',
      input.outlineStatus ?? 'empty',
      JSON.stringify(input.volumeOutlines ?? []),
      input.volumeStatus ?? 'empty',
      now,
      now,
    );
    return this.findById(id);
  }

  private findById(id: string): IpcResult<PlanningIdea> {
    const row = this.db.prepare('SELECT * FROM planning_ideas WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return { success: false, error: '策划记录不存在' };
    return { success: true, data: this.rowToPlanningIdea(row) };
  }

  private rowToPlanningIdea(row: Record<string, unknown>): PlanningIdea {
    let generatedOptions: StoryOption[] = [];
    let masterOutline: MasterOutline | null = null;
    let volumeOutlines: VolumeOutline[] = [];
    try { generatedOptions = JSON.parse(String(row.generated_options || '[]')); } catch {}
    try { masterOutline = row.master_outline ? JSON.parse(String(row.master_outline)) : null; } catch {}
    try { volumeOutlines = JSON.parse(String(row.volume_outlines || '[]')); } catch {}
    return {
      id: String(row.id),
      projectId: String(row.project_id),
      idea: String(row.idea || ''),
      requirements: String(row.requirements || ''),
      generatedOptions,
      selectedOption: row.selected_option === null ? null : Number(row.selected_option),
      status: row.status as PlanningIdea['status'],
      masterOutline,
      outlineStatus: (row.outline_status || 'empty') as PlanningIdea['outlineStatus'],
      volumeOutlines,
      volumeStatus: (row.volume_status || 'empty') as PlanningIdea['volumeStatus'],
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }
}
