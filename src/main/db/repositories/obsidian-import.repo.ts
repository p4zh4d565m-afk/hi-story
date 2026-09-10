import type Database from 'better-sqlite3';
import { promises as fs } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { scanImportCandidates, resolveInsideRoot, sha256 } from '../../obsidian/import-candidates';
import { parseMarkdown } from '../../obsidian/markdown-vault';
import { parseCandidateDrafts } from '../../obsidian/import-parser';
import type {
  IpcResult, ObsidianCommitInput, ObsidianImportPrepareResult, ObsidianImportTargetState,
  ObsidianImportSummary, ObsidianImportReparseInput, ObsidianImportReparseResult,
  MasterOutline, VolumeOutline, ChapterOutline, StoryOption,
  ObsidianImportSelection, ObsidianImportDrafts, ImportCharacterInput, ImportWorldInput,
  ObsidianImportSlot, ImportChapterDraft,
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
      const parsed = parseMarkdown(bytes.toString('utf8'));
      const name = typeof parsed.frontmatter.name === 'string' ? parsed.frontmatter.name.trim() : path.basename(input.relativePath, path.extname(input.relativePath));
      const result = parseCandidateDrafts(parsed.content, parsed.frontmatter, input.slots, name, input.defaultVolumeIndex ?? null);
      return { success: true, data: { drafts: result.drafts, issues: result.issues } };
    } catch (e) { return { success: false, error: (e as Error).message }; }
  }

  async commit(input: ObsidianCommitInput): Promise<IpcResult<ObsidianImportSummary>> {
    try {
      const { obsidianPath } = this.requireProject(input.projectId);
      // —— 事务外：重新扫描，校验 selection 路径 + hash，主进程重建 drafts ——
      const scan = await scanImportCandidates(obsidianPath);
      const byPath = new Map(scan.candidates.map(c => [c.relativePath, c]));

      // 重复 relativePath 校验
      const seenPaths = new Set<string>();
      for (const sel of input.selections) {
        if (seenPaths.has(sel.relativePath)) throw new Error(`重复选择文件：${sel.relativePath}`);
        seenPaths.add(sel.relativePath);
        const cand = byPath.get(sel.relativePath);
        if (!cand) throw new Error(`文件不在候选范围：${sel.relativePath}`);
        if (cand.hash !== sel.hash) throw new Error(`文件已变化，请重新扫描：${sel.relativePath}`);
      }

      // —— 主进程重建 drafts（不信任渲染端），并合并白名单 overrides ——
      const rebuilt = await this.rebuildSelections(input.projectId, obsidianPath, input.selections);

      // —— 事务外校验 ——
      this.validateFinalState(input.projectId, input, rebuilt);

      // —— 短事务写库 ——
      const write = this.db.transaction(() => {
        return this.applyImport(input.projectId, input, rebuilt);
      });
      const summary = write();
      return { success: true, data: summary };
    } catch (e) { return { success: false, error: (e as Error).message }; }
  }

  /** 主进程按文件真实内容 + slots + defaultVolumeIndex 重建 drafts，再合并白名单 override。 */
  private async rebuildSelections(projectId: string, obsidianPath: string, selections: ObsidianImportSelection[]): Promise<Array<{ relativePath: string; hash: string; slots: ObsidianImportSlot[]; drafts: ObsidianImportDrafts }>> {
    const result: Array<{ relativePath: string; hash: string; slots: ObsidianImportSlot[]; drafts: ObsidianImportDrafts }> = [];

    for (const sel of selections) {
      const realPath = await resolveInsideRoot(obsidianPath, sel.relativePath);
      if (!realPath) throw new Error(`路径非法或超出 Obsidian 目录：${sel.relativePath}`);
      const bytes = await fs.readFile(realPath);
      if (sha256(bytes) !== sel.hash) throw new Error(`文件已变化，请重新扫描：${sel.relativePath}`);

      const parsed = parseMarkdown(bytes.toString('utf8'));
      const name = typeof parsed.frontmatter.name === 'string' ? parsed.frontmatter.name.trim() : path.basename(sel.relativePath, path.extname(sel.relativePath));
      const parsedDrafts = parseCandidateDrafts(parsed.content, parsed.frontmatter, sel.slots, name, sel.defaultVolumeIndex ?? null);
      const drafts = parsedDrafts.drafts;

      // 合并人物 override：按 sourceName 定位重建草稿，只改 name/overwrite
      if (sel.characterOverrides.length) {
        const map = new Map(drafts.characters.map(c => [normalizeName(c.sourceName), c]));
        for (const ov of sel.characterOverrides) {
          const key = normalizeName(ov.sourceName);
          const target = map.get(key);
          if (!target) throw new Error(`人物来源「${ov.sourceName}」不存在于文件 ${sel.relativePath}`);
          target.name = ov.name;
          target.overwrite = ov.overwrite;
        }
      }
      // 合并世界观 override
      if (sel.worldOverrides.length) {
        const map = new Map(drafts.worlds.map(w => [normalizeName(w.sourceName), w]));
        for (const ov of sel.worldOverrides) {
          const key = normalizeName(ov.sourceName);
          const target = map.get(key);
          if (!target) throw new Error(`世界观来源「${ov.sourceName}」不存在于文件 ${sel.relativePath}`);
          target.name = ov.name;
          target.category = ov.category;
          target.overwrite = ov.overwrite;
        }
      }

      result.push({ relativePath: sel.relativePath, hash: sel.hash, slots: sel.slots, drafts });
    }
    return result;
  }

  /** 计算最终三层存在性与动作，校验锁定语义、来源有无内容、最终状态不变量、重复项。 */
  private validateFinalState(projectId: string, input: ObsidianCommitInput, rebuilt: Array<{ relativePath: string; hash: string; slots: ObsidianImportSlot[]; drafts: ObsidianImportDrafts }>): void {
    const target = this.buildTargetState(projectId);
    const lc = input.layerChoices;

    // 聚合来源草稿
    let master: MasterOutline | null = null;
    const volumes: VolumeOutline[] = [];
    const chapters: ImportChapterDraft[] = [];
    const characters: ImportCharacterInput[] = [];
    const worlds: ImportWorldInput[] = [];
    for (const r of rebuilt) {
      if (r.drafts.master) master = r.drafts.master;
      if (r.drafts.volumes.length) volumes.push(...r.drafts.volumes);
      if (r.drafts.chapters.length) chapters.push(...r.drafts.chapters);
      if (r.drafts.characters.length) characters.push(...r.drafts.characters);
      if (r.drafts.worlds.length) worlds.push(...r.drafts.worlds);
    }

    // 章节号/卷归属必须为非空正整数；收窄成 ChapterOutline 在 applyImport 做
    for (const ch of chapters) {
      if (ch.chapterNumber === null || !Number.isInteger(ch.chapterNumber) || ch.chapterNumber <= 0) throw new Error(`章节「${ch.sourceHeading}」章节号非法`);
      if (ch.volumeIndex === null || !Number.isInteger(ch.volumeIndex) || ch.volumeIndex < 0) throw new Error(`章节「${ch.sourceHeading}」卷归属非法`);
    }

    // 世界观 category 非法枚举则阻塞
    const WORLD_CATS = new Set(['place', 'faction', 'race', 'law', 'history', 'culture']);
    for (const w of worlds) {
      if (!WORLD_CATS.has(w.category as string)) throw new Error(`世界观「${w.name}」需先选择合法分类`);
    }

    // 重复校验：卷标识、实体名、章节 (volumeIndex, chapterNumber)
    const volumeKeys = new Map<string, string>();
    for (const v of volumes) {
      const key = normalizeName(v.title) || (v.chapterRange ? normalizeName(v.chapterRange) : '');
      if (key && volumeKeys.has(key)) throw new Error(`重复卷「${v.title}」`);
      if (key) volumeKeys.set(key, v.title);
    }
    const charKeys = new Map<string, string>();
    for (const c of characters) {
      const key = normalizeName(c.sourceName);
      if (charKeys.has(key)) throw new Error(`重复人物名「${c.name}」`);
      charKeys.set(key, c.name);
    }
    const worldKeys = new Map<string, string>();
    for (const w of worlds) {
      const key = normalizeName(w.sourceName);
      if (worldKeys.has(key)) throw new Error(`重复世界观名「${w.name}」`);
      worldKeys.set(key, w.name);
    }
    const chapterKeys = new Set<string>();
    for (const ch of chapters) {
      const key = `${ch.volumeIndex}:${ch.chapterNumber}`;
      if (chapterKeys.has(key)) throw new Error(`重复章节 卷${ch.volumeIndex} 第${ch.chapterNumber}章`);
      chapterKeys.add(key);
    }

    // 单层动作与锁定语义
    const applyAction = (action: string, unlock: boolean, currentExists: boolean, hasIncoming: boolean, locked: boolean): boolean => {
      // 返回该层最终是否存在
      if (action === 'clear') {
        if (locked && !unlock) throw new Error('目标层级已锁定，需明确解锁后清空');
        return false;
      }
      if (action === 'replace') {
        if (locked && !unlock) throw new Error('目标层级已锁定，需明确解锁后替换');
        if (!hasIncoming) throw new Error('没有可替换的来源内容');
        return true;
      }
      if (action === 'fill') {
        if (!currentExists && !hasIncoming) throw new Error('没有可填入内容');
        return currentExists || hasIncoming;
      }
      return currentExists; // keep
    };

    const finalMaster = applyAction(lc.master.action, lc.master.unlockLocked, target.layers.master.exists, !!master, target.layers.master.status === 'locked');
    const finalVolumes = applyAction(lc.volumes.action, lc.volumes.unlockLocked, target.layers.volumes.exists, volumes.length > 0, target.layers.volumes.status === 'locked');
    const finalChapters = applyAction(lc.chapters.action, lc.chapters.unlockLocked, target.layers.chapters.exists, chapters.length > 0, target.layers.chapters.status === 'locked');

    // 最终状态不变量
    if (finalVolumes && !finalMaster) throw new Error('存在分卷纲但缺少全书总纲');
    if (finalChapters && (!finalMaster || !finalVolumes)) throw new Error('存在章纲但缺少全书总纲或分卷纲');

    // 上下游动作约束：替换/清空上游，下游必须也替换/清空（若下游最终存在）
    if ((lc.master.action === 'replace' || lc.master.action === 'clear') && finalVolumes && !['replace', 'clear'].includes(lc.volumes.action)) {
      throw new Error('替换或清空总纲时，分卷纲需同步替换或清空');
    }
    if ((lc.volumes.action === 'replace' || lc.volumes.action === 'clear') && finalChapters && !['replace', 'clear'].includes(lc.chapters.action)) {
      throw new Error('替换或清空分卷纲时，章纲需同步替换或清空');
    }

    // A1：仅当本次涉及策划层时检查多条策划记录
    const touchesPlanning = master || volumes.length > 0 || chapters.length > 0 || ['replace', 'clear', 'fill'].includes(lc.master.action) || ['replace', 'clear', 'fill'].includes(lc.volumes.action) || ['replace', 'clear', 'fill'].includes(lc.chapters.action);
    if (touchesPlanning && target.planningRecordCount > 1) throw new Error('项目存在多条策划记录，请先整理后再导入');
  }


  private applyImport(projectId: string, input: ObsidianCommitInput, rebuilt: Array<{ relativePath: string; hash: string; slots: ObsidianImportSlot[]; drafts: ObsidianImportDrafts }>): ObsidianImportSummary {
    const summary: ObsidianImportSummary = {
      planning: { master: 'kept', volumes: 'kept', chapters: 'kept' },
      characters: { created: 0, updated: 0, skipped: 0 },
      worlds: { created: 0, updated: 0, skipped: 0 },
    };

    // 聚合各层草稿
    let master: MasterOutline | null = null;
    const volumes: VolumeOutline[] = [];
    const chapters: ChapterOutline[] = [];
    const characters: ImportCharacterInput[] = [];
    const worlds: ImportWorldInput[] = [];
    for (const r of rebuilt) {
      if (r.drafts.master) master = r.drafts.master;
      if (r.drafts.volumes.length) volumes.push(...r.drafts.volumes);
      for (const ch of r.drafts.chapters) {
        // 收窄 ImportChapterDraft → ChapterOutline（validateFinalState 已保证 number 非空）
        chapters.push({ volumeIndex: ch.volumeIndex as number, chapterNumber: ch.chapterNumber as number, title: ch.title, pov: ch.pov, chapterGoal: ch.chapterGoal, openingSituation: ch.openingSituation, centralConflict: ch.centralConflict, keyBeats: ch.keyBeats, reveal: ch.reveal, characterChange: ch.characterChange, emotionalBeat: ch.emotionalBeat, payoff: ch.payoff, endingHook: ch.endingHook });
      }
      characters.push(...r.drafts.characters);
      worlds.push(...r.drafts.worlds);
    }

    // 策划层（仅当涉及策划时）
    const touchesPlanning = master || volumes.length > 0 || chapters.length > 0 || input.layerChoices.master.action !== 'keep' || input.layerChoices.volumes.action !== 'keep' || input.layerChoices.chapters.action !== 'keep';
    if (touchesPlanning) {
      summary.planning = this.applyPlanning(projectId, input, master, volumes, chapters);
    }

    // 人物
    if (characters.length) summary.characters = this.applyCharacters(projectId, characters);
    // 世界观
    if (worlds.length) summary.worlds = this.applyWorlds(projectId, worlds);

    return summary;
  }

  private applyPlanning(projectId: string, input: ObsidianCommitInput, master: MasterOutline | null, volumes: VolumeOutline[], chapters: ChapterOutline[]): ObsidianImportSummary['planning'] {
    const rows = this.db.prepare('SELECT * FROM planning_ideas WHERE project_id = ?').all(projectId) as Record<string, unknown>[];
    if (rows.length > 1) throw new Error('项目存在多条策划记录，请先整理后再导入');
    const existing = rows[0];
    const now = new Date().toISOString();

    const lc = input.layerChoices;
    const decide = (action: 'keep' | 'fill' | 'replace' | 'clear', unlock: boolean, current: string, incoming: string, exists: boolean, locked: boolean, currentStatus: string): { value: string; status: string; outcome: 'kept' | 'filled' | 'replaced' | 'cleared' } => {
      if (action === 'clear') {
        if (locked && !unlock) throw new Error('目标层级已锁定，需明确解锁后清空');
        return { value: '', status: 'empty', outcome: 'cleared' };
      }
      if (action === 'replace') {
        if (locked && !unlock) throw new Error('目标层级已锁定，需明确解锁后替换');
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

    const masterDecision = decide(lc.master.action, lc.master.unlockLocked, masterCurrent, master ? JSON.stringify(master) : '', masterExists, masterStatus === 'locked', masterStatus);
    const volumesDecision = decide(lc.volumes.action, lc.volumes.unlockLocked, volumesCurrent, JSON.stringify(volumes), volumesExists, volumesStatus === 'locked', volumesStatus);
    const chaptersDecision = decide(lc.chapters.action, lc.chapters.unlockLocked, chaptersCurrent, JSON.stringify(chapters), chaptersExists, chaptersStatus === 'locked', chaptersStatus);

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

  private applyCharacters(projectId: string, characters: ImportCharacterInput[]): ObsidianImportSummary['characters'] {
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

  private applyWorlds(projectId: string, worlds: ImportWorldInput[]): ObsidianImportSummary['worlds'] {
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
