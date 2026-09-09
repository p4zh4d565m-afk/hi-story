import type Database from 'better-sqlite3';
import type { CreativeDecision, CreativeDecisionRelatedItems, DecisionRelatedItem } from '../../../renderer/types';

export function normalize(value: unknown): string {
  return String(value ?? '').normalize('NFKC').trim().toLowerCase();
}

export function findDecisionRelatedItems(db: Database.Database, decision: CreativeDecision): CreativeDecisionRelatedItems {
  const result: CreativeDecisionRelatedItems = { matches: [], knowledge: [], missingSubject: [] };
  const rows = (table: DecisionRelatedItem['targetTable'], predicate: string, args: unknown[]) => db.prepare(
    `SELECT * FROM ${table} WHERE project_id = ? AND ${predicate} ORDER BY created_at DESC, id DESC`,
  ).all(decision.projectId, ...args) as Record<string, unknown>[];
  const item = (table: DecisionRelatedItem['targetTable'], row: Record<string, unknown>): DecisionRelatedItem => ({
    targetTable: table, id: String(row.id), subject: String(row.subject ?? row.character_name ?? ''),
    description: String(row.description ?? row.fact_description ?? ''), status: String(row.status),
  });
  if (decision.type === 'story_fact') {
    const p = decision.payload;
    const useObject = !['location', 'emotional_state'].includes(p.factType);
    result.matches = rows('story_facts', "status = 'active' AND fact_type = ?", [p.factType])
      .filter(row => normalize(row.subject) === normalize(p.subject)
        && (!useObject || normalize(row.object) === normalize(p.object)))
      .map(row => item('story_facts', row));
  } else if (decision.type === 'character_knowledge') {
    const p = decision.payload;
    result.knowledge = rows('character_knowledge', "status = 'active'", [])
      .filter(row => p.characterId ? row.character_id === p.characterId
        : normalize(row.character_name) === normalize(p.characterName))
      .slice(0, 20).map(row => item('character_knowledge', row));
  } else {
    const hook = decision.type === 'narrative_hook';
    const table = hook ? 'narrative_hooks' : 'narrative_debts';
    const candidates = decision.type === 'narrative_hook'
      ? rows(table, "status IN ('open','partially_resolved') AND hook_type = ?", [decision.payload.hookType])
      : rows(table, "status IN ('unpaid','overdue') AND debt_type = ?", [decision.payload.debtType]);
    const subject = normalize(decision.payload.subject);
    result.matches = candidates.filter(row => subject !== '' && normalize(row.subject) === subject).map(row => item(table, row));
    result.missingSubject = candidates.filter(row => normalize(row.subject) === '').slice(0, 20).map(row => item(table, row));
  }
  return result;
}
