import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { ChapterOutline, IpcResult, MasterOutline, PlanningIdea, StoryOption, VolumeOutline } from '../../../renderer/types';
import { assignChapterOutlineIds } from '../../ai/narrative-planning-key';

/**
 * 保存策划输入的字段语义（读-改-写合并，见 save）：
 * - JSON 列（generatedOptions/masterOutline/volumeOutlines/chapterOutlines）：
 *   **省略（undefined）= 保留库中旧值**；显式传 `null`（对象型）或 `[]`（数组型）= 清空。
 *   严禁把「漏传」误当「想清空」——这两个语义由 `=== undefined` 区分，`??` 会吞掉 null。
 * - 标量列（requirements/status/selectedOption）省略时仍会写成默认值（''/draft/null），
 *   当前调用方（PlanningWorkspace.save）总是整包提交，暂不打中；新增调用方勿依赖「省略=保留」。
 */
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
  chapterOutlines?: ChapterOutline[];
  chapterOutlineStatus?: PlanningIdea['chapterOutlineStatus'];
}

export class PlanningRepo {
  constructor(private db: Database.Database) {}

  findByProject(projectId: string): IpcResult<PlanningIdea | null> {
    const row = this.db.prepare(
      'SELECT * FROM planning_ideas WHERE project_id = ?',
    ).get(projectId) as Record<string, unknown> | undefined;
    if (!row) return { success: true, data: null };
    return this.parseRow(row);
  }

  save(input: SavePlanningIdeaInput): IpcResult<PlanningIdea> {
    const existing = this.db.prepare(
      'SELECT * FROM planning_ideas WHERE project_id = ?',
    ).get(input.projectId) as Record<string, unknown> | undefined;
    const now = new Date().toISOString();

    // 读-改-写合并：JSON 字段未传（undefined）保留旧值；显式 null/[] 才清空。
    // 严禁用 `??` —— 那会把「未传」与「想清空」都吞成默认值。
    const pickJson = <T>(incoming: T | null | undefined, existingRaw: string | undefined): T | null => {
      if (incoming === undefined) {
        if (existingRaw === undefined || existingRaw === '') return null;
        return JSON.parse(existingRaw) as T;
      }
      return incoming;
    };

    const idea = input.idea;
    const requirements = input.requirements ?? '';
    const generatedOptions = pickJson<StoryOption[]>(input.generatedOptions, existing?.generated_options as string | undefined);
    const selectedOption = input.selectedOption === undefined ? (existing ? (existing.selected_option == null ? null : Number(existing.selected_option)) : null) : input.selectedOption;
    const status = input.status ?? ((existing?.status as PlanningIdea['status']) ?? 'draft');
    const masterOutline = pickJson<MasterOutline>(input.masterOutline, existing?.master_outline as string | undefined);
    const outlineStatus = input.outlineStatus ?? ((existing?.outline_status as PlanningIdea['outlineStatus']) ?? 'empty');
    const volumeOutlines = pickJson<VolumeOutline[]>(input.volumeOutlines, existing?.volume_outlines as string | undefined);
    const volumeStatus = input.volumeStatus ?? ((existing?.volume_status as PlanningIdea['volumeStatus']) ?? 'empty');
    const chapterOutlines = assignChapterOutlineIds(
      pickJson<ChapterOutline[]>(input.chapterOutlines, existing?.chapter_outlines as string | undefined) ?? [],
      () => uuidv4(),
    );
    const chapterOutlineStatus = input.chapterOutlineStatus ?? ((existing?.chapter_outline_status as PlanningIdea['chapterOutlineStatus']) ?? 'empty');

    if (existing) {
      this.db.prepare(`
        UPDATE planning_ideas
        SET idea = ?, requirements = ?, generated_options = ?, selected_option = ?, status = ?,
            master_outline = ?, outline_status = ?, volume_outlines = ?, volume_status = ?,
            chapter_outlines = ?, chapter_outline_status = ?, updated_at = ?
        WHERE id = ?
      `).run(
        idea,
        requirements,
        JSON.stringify(generatedOptions ?? []),
        selectedOption,
        status,
        masterOutline ? JSON.stringify(masterOutline) : '',
        outlineStatus,
        JSON.stringify(volumeOutlines ?? []),
        volumeStatus,
        JSON.stringify(chapterOutlines),
        chapterOutlineStatus,
        now,
        existing.id,
      );
      return this.findById(existing.id as string);
    }

    const id = uuidv4();
    this.db.prepare(`
      INSERT INTO planning_ideas
        (id, project_id, idea, requirements, generated_options, selected_option, status, master_outline, outline_status, volume_outlines, volume_status, chapter_outlines, chapter_outline_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.projectId,
      idea,
      requirements,
      JSON.stringify(generatedOptions ?? []),
      selectedOption,
      status,
      masterOutline ? JSON.stringify(masterOutline) : '',
      outlineStatus,
      JSON.stringify(volumeOutlines ?? []),
      volumeStatus,
        JSON.stringify(chapterOutlines),
      chapterOutlineStatus,
      now,
      now,
    );
    return this.findById(id);
  }

  private findById(id: string): IpcResult<PlanningIdea> {
    const row = this.db.prepare('SELECT * FROM planning_ideas WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return { success: false, error: '策划记录不存在' };
    return this.parseRow(row);
  }

  /** 解析一行策划。任一 JSON 列损坏即报错，绝不返回空纲冒充成功。 */
  private parseRow(row: Record<string, unknown>): IpcResult<PlanningIdea> {
    const parse = (raw: string | unknown, what: string): unknown => {
      try {
        const s = String(raw ?? '');
        return s ? JSON.parse(s) : null;
      } catch {
        throw new Error(`策划数据损坏（${what}），请从备份或 Obsidian 重新导入`);
      }
    };
    try {
      return {
        success: true,
        data: {
          id: String(row.id),
          projectId: String(row.project_id),
          idea: String(row.idea || ''),
          requirements: String(row.requirements || ''),
          generatedOptions: (parse(row.generated_options, '故事方案') ?? []) as StoryOption[],
          selectedOption: row.selected_option === null ? null : Number(row.selected_option),
          status: row.status as PlanningIdea['status'],
          masterOutline: parse(row.master_outline, '总纲') as MasterOutline | null,
          outlineStatus: (row.outline_status || 'empty') as PlanningIdea['outlineStatus'],
          volumeOutlines: (parse(row.volume_outlines, '分卷纲') ?? []) as VolumeOutline[],
          volumeStatus: (row.volume_status || 'empty') as PlanningIdea['volumeStatus'],
          chapterOutlines: (parse(row.chapter_outlines, '章纲') ?? []) as ChapterOutline[],
          chapterOutlineStatus: (row.chapter_outline_status || 'empty') as PlanningIdea['chapterOutlineStatus'],
          createdAt: String(row.created_at),
          updatedAt: String(row.updated_at),
        },
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }
}
