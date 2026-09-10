import type Database from 'better-sqlite3';
import { promises as fs } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { scanImportCandidates, resolveInsideRoot, sha256 } from '../../obsidian/import-candidates';
import type {
  IpcResult, ObsidianCommitInput, ObsidianImportPrepareResult, ObsidianImportTargetState,
  ObsidianImportSummary, ObsidianImportReparseInput, ObsidianImportReparseResult,
  MasterOutline, VolumeOutline, ChapterOutline, StoryOption,
} from '../../../renderer/types';

function normalizeName(value: unknown): string {
  return String(value ?? '').normalize('NFKC').trim().toLowerCase();
}

export class ObsidianImportRepo {
  constructor(private db: Database.Database) {}

  private requireProject(projectId: string): { obsidianPath: string } {
    const row = this.db.prepare('SELECT obsidian_path FROM projects WHERE id = ?').get(projectId) as { obsidian_path?: string } | undefined;
    if (!row) throw new Error('项目不存在');
    return { obsidianPath: row.obsidian_path ?? '' };
  }

  private buildTargetState(projectId: string): ObsidianImportTargetState {
    const planningRows = this.db.prepare('SELECT * FROM planning_ideas WHERE project_id = ?').all(projectId) as Record<string, unknown>[];
    const planning = planningRows[0];
    const charRows = this.db.prepare('SELECT name FROM characters WHERE project_id = ? ORDER BY sort_order ASC').all(projectId) as { name: string }[];
    const worldRows = this.db.prepare('SELECT name, category FROM world_entries WHERE project_id = ? ORDER BY sort_order ASC').all(projectId) as { name: string; category: ObsidianImportTargetState['worlds'][number]['category'] }[];
    return {
      planningRecordCount: planningRows.length,
      hasConfirmedStoryOption: planning ? planning.status === 'confirmed' && planning.selected_option !== null : false,
      layers: {
        master: { exists: planning ? !!planning.master_outline : false, status: (planning?.outline_status || 'empty') as ObsidianImportTargetState['layers']['master']['status'] },
        volumes: { exists: planning ? (() => { try { return JSON.parse(String(planning.volume_outlines || '[]')).length > 0; } catch { return false; } })() : false, status: (planning?.volume_status || 'empty') as ObsidianImportTargetState['layers']['volumes']['status'] },
        chapters: { exists: planning ? (() => { try { return JSON.parse(String(planning.chapter_outlines || '[]')).length > 0; } catch { return false; } })() : false, status: (planning?.chapter_outline_status || 'empty') as ObsidianImportTargetState['layers']['chapters']['status'] },
      },
      characters: charRows.map(c => ({ name: c.name, normalizedName: normalizeName(c.name) })),
      worlds: worldRows.map(w => ({ name: w.name, normalizedName: normalizeName(w.name), category: w.category })),
    };
  }

  async prepare(projectId: string): Promise<IpcResult<ObsidianImportPrepareResult>> {
    try {
      const { obsidianPath } = this.requireProject(projectId);
      const scan = await scanImportCandidates(obsidianPath);
      const target = this.buildTargetState(projectId);
      return { success: true, data: { status: scan.status, rootPath: scan.rootPath, target, candidates: scan.candidates, issues: scan.issues, message: scan.message } };
    } catch (e) { return { success: false, error: (e as Error).message }; }
  }

  async reparse(input: ObsidianImportReparseInput): Promise<IpcResult<ObsidianImportReparseResult>> {
    try {
      const { obsidianPath } = this.requireProject(input.projectId);
      const realPath = await resolveInsideRoot(obsidianPath, input.relativePath);
      if (!realPath) throw new Error('路径非法或超出 Obsidian 目录');
      const bytes = await fs.readFile(realPath);
      if (sha256(bytes) !== input.hash) throw new Error('文件已变化，请重新扫描');
      // 重解析：复用解析器，按新槽位与卷归属
      const { parseMarkdown } = require('../../obsidian/markdown-vault');
      const { parseCandidateDrafts } = require('../../obsidian/import-parser');
      const parsed = parseMarkdown(bytes.toString('utf8'));
      const name = typeof parsed.frontmatter.name === 'string' ? parsed.frontmatter.name.trim() : path.basename(input.relativePath, path.extname(input.relativePath));
      const result = parseCandidateDrafts(parsed.content, parsed.frontmatter, input.slots, name, input.defaultVolumeIndex ?? null);
      return { success: true, data: { drafts: result.drafts, issues: result.issues } };
    } catch (e) { return { success: false, error: (e as Error).message }; }
  }

  async commit(input: ObsidianCommitInput): Promise<IpcResult<ObsidianImportSummary>> {
    try {
      const { obsidianPath } = this.requireProject(input.projectId);
      // —— 事务外校验：重新扫描，校验每个 selection 的路径 + hash ——
      const scan = await scanImportCandidates(obsidianPath);
      const byPath = new Map(scan.candidates.map(c => [c.relativePath, c]));
      for (const sel of input.selections) {
        const cand = byPath.get(sel.relativePath);
        if (!cand) throw new Error(`文件不在候选范围：${sel.relativePath}`);
        if (cand.hash !== sel.hash) throw new Error(`文件已变化，请重新扫描：${sel.relativePath}`);
      }

      // —— 聚合与校验（纯数据，事务外）——
      const hasMaster = input.selections.some(s => s.slots.includes('master') && s.drafts.master);
      const hasVolumes = input.selections.some(s => s.slots.includes('volume') && s.drafts.volumes.length);
      const hasChapters = input.selections.some(s => s.slots.includes('chapter') && s.drafts.chapters.length);
      const hasCharacter = input.selections.some(s => s.slots.includes('character') && s.drafts.characters.length);
      const hasWorld = input.selections.some(s => s.slots.includes('world') && s.drafts.worlds.length);

      // 依赖矩阵：最终某层是否存在，由「数据库现状 + 本次选择 + 是否导入」共同决定
      const target = this.buildTargetState(input.projectId);
      const finalExists = (action: string, hasIncoming: boolean, currentExists: boolean): boolean => {
        if (action === 'clear') return false;
        if (action === 'replace') return hasIncoming;
        if (action === 'fill') return currentExists || hasIncoming;
        return currentExists; // keep
      };
      const finalMaster = finalExists(input.layerChoices.master.action, hasMaster, target.layers.master.exists);
      const finalVolumes = finalExists(input.layerChoices.volumes.action, hasVolumes, target.layers.volumes.exists);

      if (hasVolumes && !finalMaster) throw new Error('分卷纲需要全书总纲');
      if (hasChapters) {
        if (!finalVolumes) throw new Error('章纲需要分卷纲');
        if (!finalMaster) throw new Error('章纲需要全书总纲');
      }

      // 世界观 category 为空则阻塞
      for (const sel of input.selections) {
        for (const w of sel.drafts.worlds) {
          if (w.category === null) throw new Error(`世界观「${w.name}」需先选择分类`);
        }
      }

      // —— 短事务写库 ——
      const write = this.db.transaction(() => {
        return this.applyImport(input.projectId, input, { hasMaster, hasVolumes, hasChapters, hasCharacter, hasWorld });
      });
      const summary = write();
      return { success: true, data: summary };
    } catch (e) { return { success: false, error: (e as Error).message }; }
  }

  private applyImport(projectId: string, input: ObsidianCommitInput, flags: { hasMaster: boolean; hasVolumes: boolean; hasChapters: boolean; hasCharacter: boolean; hasWorld: boolean }): ObsidianImportSummary {
    const summary: ObsidianImportSummary = {
      planning: { master: 'kept', volumes: 'kept', chapters: 'kept' },
      characters: { created: 0, updated: 0, skipped: 0 },
      worlds: { created: 0, updated: 0, skipped: 0 },
    };

    // 聚合各层草稿
    let master: MasterOutline | null = null;
    const volumes: VolumeOutline[] = [];
    const chapters: ChapterOutline[] = [];
    const characters: ObsidianCommitInput['selections'][number]['drafts']['characters'] = [];
    const worlds: ObsidianCommitInput['selections'][number]['drafts']['worlds'] = [];
    for (const sel of input.selections) {
      if (sel.drafts.master) master = sel.drafts.master;
      if (sel.drafts.volumes.length) volumes.push(...sel.drafts.volumes);
      for (const ch of sel.drafts.chapters) {
        if (ch.chapterNumber === null || ch.volumeIndex === null) throw new Error(`章节「${ch.sourceHeading}」缺少章节号或卷归属`);
        chapters.push({ volumeIndex: ch.volumeIndex, chapterNumber: ch.chapterNumber, title: ch.title, pov: ch.pov, chapterGoal: ch.chapterGoal, openingSituation: ch.openingSituation, centralConflict: ch.centralConflict, keyBeats: ch.keyBeats, reveal: ch.reveal, characterChange: ch.characterChange, emotionalBeat: ch.emotionalBeat, payoff: ch.payoff, endingHook: ch.endingHook });
      }
      characters.push(...sel.drafts.characters);
      worlds.push(...sel.drafts.worlds);
    }

    // 策划层
    if (flags.hasMaster || flags.hasVolumes || flags.hasChapters) {
      summary.planning = this.applyPlanning(projectId, input, master, volumes, chapters);
    }

    // 人物
    if (flags.hasCharacter) summary.characters = this.applyCharacters(projectId, characters);
    // 世界观
    if (flags.hasWorld) summary.worlds = this.applyWorlds(projectId, worlds);

    return summary;
  }

  private applyPlanning(projectId: string, input: ObsidianCommitInput, master: MasterOutline | null, volumes: VolumeOutline[], chapters: ChapterOutline[]): ObsidianImportSummary['planning'] {
    const rows = this.db.prepare('SELECT * FROM planning_ideas WHERE project_id = ?').all(projectId) as Record<string, unknown>[];
    if (rows.length > 1) throw new Error('项目存在多条策划记录，请先整理后再导入');
    const existing = rows[0];
    const now = new Date().toISOString();

    const lc = input.layerChoices;
    const decide = (action: 'keep' | 'fill' | 'replace' | 'clear', current: string, incoming: string, exists: boolean, locked: boolean, currentStatus: string): { value: string; status: string; outcome: 'kept' | 'filled' | 'replaced' | 'cleared' } => {
      if (action === 'clear') return { value: '', status: 'empty', outcome: 'cleared' };
      if (action === 'replace') {
        if (locked) throw new Error('目标层级已锁定，需明确解锁后替换');
        return { value: incoming, status: 'generated', outcome: 'replaced' };
      }
      if (action === 'fill') {
        if (exists && current) return { value: current, status: currentStatus, outcome: 'kept' };
        return { value: incoming, status: 'generated', outcome: 'filled' };
      }
      // keep：保留原值与原状态
      return { value: current, status: currentStatus, outcome: 'kept' };
    };

    const masterCurrent = existing ? String(existing.master_outline || '') : '';
    const volumesCurrent = existing ? String(existing.volume_outlines || '[]') : '[]';
    const chaptersCurrent = existing ? String(existing.chapter_outlines || '[]') : '[]';
    const masterExists = !!masterCurrent;
    const volumesExists = volumesCurrent !== '[]';
    const chaptersExists = chaptersCurrent !== '[]';
    const masterStatus = (existing?.outline_status || 'empty') as string;
    const volumesStatus = (existing?.volume_status || 'empty') as string;
    const chaptersStatus = (existing?.chapter_outline_status || 'empty') as string;

    const masterDecision = decide(lc.master.action, masterCurrent, master ? JSON.stringify(master) : '', masterExists, masterStatus === 'locked', masterStatus);
    const volumesDecision = decide(lc.volumes.action, volumesCurrent, JSON.stringify(volumes), volumesExists, volumesStatus === 'locked', volumesStatus);
    const chaptersDecision = decide(lc.chapters.action, chaptersCurrent, JSON.stringify(chapters), chaptersExists, chaptersStatus === 'locked', chaptersStatus);

    // 替换上游必须处理下游
    if (lc.master.action === 'replace' && !['replace', 'clear'].includes(lc.volumes.action)) throw new Error('替换总纲时，分卷纲需同步替换或清空');
    if (lc.volumes.action === 'replace' && !['replace', 'clear'].includes(lc.chapters.action)) throw new Error('替换分卷纲时，章纲需同步替换或清空');

    // 无已确认方向时构造导入方案
    let generatedOptions = existing ? JSON.parse(String(existing.generated_options || '[]')) as StoryOption[] : [];
    let selectedOption = existing?.selected_option == null ? null : Number(existing.selected_option);
    let status = (existing?.status || 'draft') as string;
    if (master && (status !== 'confirmed' || selectedOption === null)) {
      const projectRow = this.db.prepare('SELECT name FROM projects WHERE id = ?').get(projectId) as { name: string };
      const option: StoryOption = input.storyOptionDraft ?? {
        title: projectRow.name, logline: master.premise, targetReader: '', corePromise: master.storyPromises?.[0] || '',
        protagonist: '', centralConflict: master.centralConflict, differentiator: '', endingDirection: master.ending,
      };
      generatedOptions.push(option);
      selectedOption = generatedOptions.length - 1;
      status = 'confirmed';
    }

    if (existing) {
      this.db.prepare(`
        UPDATE planning_ideas SET
          master_outline = ?, outline_status = ?,
          volume_outlines = ?, volume_status = ?,
          chapter_outlines = ?, chapter_outline_status = ?,
          generated_options = ?, selected_option = ?, status = ?, updated_at = ?
        WHERE id = ?
      `).run(
        masterDecision.value, masterDecision.status,
        volumesDecision.value, volumesDecision.status,
        chaptersDecision.value, chaptersDecision.status,
        JSON.stringify(generatedOptions), selectedOption, status, now, existing.id,
      );
    } else {
      const id = uuidv4();
      this.db.prepare(`
        INSERT INTO planning_ideas
          (id, project_id, idea, requirements, generated_options, selected_option, status,
           master_outline, outline_status, volume_outlines, volume_status, chapter_outlines, chapter_outline_status, created_at, updated_at)
        VALUES (?, ?, '', '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, projectId, JSON.stringify(generatedOptions), selectedOption, status,
        masterDecision.value, masterDecision.status, volumesDecision.value, volumesDecision.status,
        chaptersDecision.value, chaptersDecision.status, now, now,
      );
    }

    return { master: masterDecision.outcome, volumes: volumesDecision.outcome, chapters: chaptersDecision.outcome };
  }

  private applyCharacters(projectId: string, characters: ObsidianCommitInput['selections'][number]['drafts']['characters']): ObsidianImportSummary['characters'] {
    const result = { created: 0, updated: 0, skipped: 0 };
    const existing = this.db.prepare('SELECT * FROM characters WHERE project_id = ?').all(projectId) as Record<string, unknown>[];
    const now = new Date().toISOString();
    const seen = new Set<string>();
    for (const ch of characters) {
      const key = normalizeName(ch.sourceName);
      if (seen.has(key)) { result.skipped++; continue; }
      seen.add(key);
      const match = existing.find(c => normalizeName(c.name) === key);
      if (match) {
        if (!ch.overwrite) { result.skipped++; continue; }
        this.db.prepare('UPDATE characters SET name=?, aliases=?, appearance=?, personality=?, background=?, arc=?, updated_at=? WHERE id=?')
          .run(ch.name, ch.aliases, ch.appearance, ch.personality, ch.background, ch.arc, now, match.id);
        result.updated++;
      } else {
        const id = uuidv4();
        const maxSort = (this.db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM characters WHERE project_id = ?').get(projectId) as { m: number }).m;
        this.db.prepare('INSERT INTO characters (id, project_id, name, aliases, appearance, personality, background, arc, profile_outline, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(id, projectId, ch.name, ch.aliases, ch.appearance, ch.personality, ch.background, ch.arc, '[]', maxSort + 1, now, now);
        result.created++;
      }
    }
    return result;
  }

  private applyWorlds(projectId: string, worlds: ObsidianCommitInput['selections'][number]['drafts']['worlds']): ObsidianImportSummary['worlds'] {
    const result = { created: 0, updated: 0, skipped: 0 };
    const existing = this.db.prepare('SELECT * FROM world_entries WHERE project_id = ?').all(projectId) as Record<string, unknown>[];
    const now = new Date().toISOString();
    const seen = new Set<string>();
    for (const w of worlds) {
      const key = normalizeName(w.sourceName);
      if (seen.has(key)) { result.skipped++; continue; }
      seen.add(key);
      const match = existing.find(e => normalizeName(e.name) === key);
      if (match) {
        if (!w.overwrite) { result.skipped++; continue; }
        this.db.prepare('UPDATE world_entries SET name=?, description=?, category=?, updated_at=? WHERE id=?')
          .run(w.name, w.description, w.category, now, match.id);
        result.updated++;
      } else {
        const id = uuidv4();
        const maxSort = (this.db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM world_entries WHERE project_id = ? AND parent_id IS NULL').get(projectId) as { m: number }).m;
        this.db.prepare('INSERT INTO world_entries (id, project_id, parent_id, category, name, description, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
          .run(id, projectId, null, w.category, w.name, w.description, maxSort + 1, now, now);
        result.created++;
      }
    }
    return result;
  }
}
