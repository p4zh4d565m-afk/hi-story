import type { ChatMessage } from '../../main/ai/provider';
import type { CreativeDecisionDraft } from '../types';

const DECISION_TYPES = new Set([
  'story_fact', 'character_knowledge', 'narrative_hook', 'narrative_debt',
]);
const FACT_TYPES = new Set(['location', 'possession', 'relationship', 'knowledge', 'event', 'emotional_state']);
const HOOK_TYPES = new Set(['cliffhanger', 'foreshadowing', 'promise', 'mystery', 'emotional_hook']);
const DEBT_TYPES = new Set(['reveal', 'payoff', 'character_return', 'mystery_answer', 'power_up']);

const EXTRACTION_SYSTEM_PROMPT = `你负责把一条 AI 创作回复整理成等待作者确认的结构化决策。
仅返回 JSON 数组，不要返回 Markdown、解释或额外文字。没有可确认内容时返回 []。

只允许四种 type：story_fact、character_knowledge、narrative_hook、narrative_debt。
每项必须包含 type、title、rationale、payload。
- story_fact.payload：factType、subject、predicate、object、description，可选 chapterId。
- character_knowledge.payload：characterName、factDescription、source，可选 characterId、learnedAtChapterId。
- narrative_hook.payload：hookType、subject（非空主体）、description、intensity（1-5 整数），可选 chapterId、dueChapterId。
- narrative_debt.payload：debtType、subject（非空主体）、description，可选 chapterId、promisedByChapter（正整数）。

只能提取回复中明确提出且适合作者确认的内容。不能把猜测、可能性、备选方案或未发生事件写成已经发生的事实。`;

export function buildDecisionExtractionMessages(content: string): ChatMessage[] {
  return [
    { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
    { role: 'user', content },
  ];
}

export function parseDecisionDrafts(text: string): CreativeDecisionDraft[] {
  const normalized = stripSingleFence(text.trim());
  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    throw new Error('决策提取结果不是有效 JSON');
  }
  if (!Array.isArray(parsed)) throw new Error('决策提取结果必须是 JSON 数组');
  return parsed.map((item, index) => validateDraft(item, index));
}

function stripSingleFence(text: string): string {
  const match = text.match(/^```(?:json)?\s*\r?\n([\s\S]*?)\r?\n```$/i);
  return match ? match[1].trim() : text;
}

function validateDraft(value: unknown, index: number): CreativeDecisionDraft {
  if (!isRecord(value)) throw new Error(`第 ${index + 1} 项决策格式无效`);
  if (typeof value.type !== 'string' || !DECISION_TYPES.has(value.type)) {
    throw new Error('不支持的决策类型');
  }
  assertOnlyKeys(value, ['type', 'title', 'rationale', 'payload'], '决策');
  requireText(value.title, '决策标题');
  requireText(value.rationale, '决策理由');
  if (!isRecord(value.payload)) throw new Error('决策载荷无效');

  switch (value.type) {
    case 'story_fact':
      assertOnlyKeys(value.payload, [
        'factType', 'subject', 'predicate', 'object', 'description', 'chapterId', 'targetId',
      ], '事实载荷');
      requireEnum(value.payload.factType, FACT_TYPES, '事实类型');
      requireText(value.payload.subject, '事实主体');
      requireText(value.payload.predicate, '事实关系');
      requireText(value.payload.object, '事实对象');
      requireText(value.payload.description, '事实描述');
      requireOptionalId(value.payload.chapterId, '章节 ID');
      requireOptionalId(value.payload.targetId, '修订目标 ID');
      return value as unknown as CreativeDecisionDraft;
    case 'character_knowledge':
      assertOnlyKeys(value.payload, [
        'characterId', 'characterName', 'factDescription', 'source',
        'learnedAtChapterId', 'targetId',
      ], '人物知识载荷');
      requireText(value.payload.characterName, '人物姓名');
      requireText(value.payload.factDescription, '人物知识');
      requireText(value.payload.source, '知识来源');
      requireOptionalId(value.payload.characterId, '人物 ID');
      requireOptionalId(value.payload.learnedAtChapterId, '章节 ID');
      requireOptionalId(value.payload.targetId, '修订目标 ID');
      return value as unknown as CreativeDecisionDraft;
    case 'narrative_hook':
      assertOnlyKeys(value.payload, [
        'hookType', 'subject', 'description', 'intensity', 'chapterId', 'dueChapterId', 'targetId',
      ], '叙事钩子载荷');
      requireEnum(value.payload.hookType, HOOK_TYPES, '钩子类型');
      requireText(value.payload.description, '钩子描述');
      requireText(value.payload.subject, '钩子主体');
      if (!Number.isInteger(value.payload.intensity)
        || Number(value.payload.intensity) < 1
        || Number(value.payload.intensity) > 5) {
        throw new Error('钩子强度必须是 1 到 5 的整数');
      }
      requireOptionalId(value.payload.chapterId, '章节 ID');
      requireOptionalId(value.payload.dueChapterId, '到期章节 ID');
      requireOptionalId(value.payload.targetId, '修订目标 ID');
      return value as unknown as CreativeDecisionDraft;
    case 'narrative_debt':
      assertOnlyKeys(value.payload, [
        'debtType', 'subject', 'description', 'chapterId', 'promisedByChapter', 'targetId',
      ], '叙事债务载荷');
      requireEnum(value.payload.debtType, DEBT_TYPES, '债务类型');
      requireText(value.payload.description, '债务描述');
      requireText(value.payload.subject, '债务主体');
      if (value.payload.promisedByChapter != null
        && (!Number.isInteger(value.payload.promisedByChapter)
          || Number(value.payload.promisedByChapter) < 1)) {
        throw new Error('承诺章节必须是正整数');
      }
      requireOptionalId(value.payload.chapterId, '章节 ID');
      requireOptionalId(value.payload.targetId, '修订目标 ID');
      return value as unknown as CreativeDecisionDraft;
    default:
      throw new Error('不支持的决策类型');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireText(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}不能为空`);
}

function requireEnum(value: unknown, values: Set<string>, label: string): asserts value is string {
  if (typeof value !== 'string' || !values.has(value)) throw new Error(`${label}无效`);
}

function requireOptionalId(value: unknown, label: string): void {
  if (value == null) return;
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}无效`);
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: string[], label: string): void {
  const keys = new Set(allowed);
  if (Object.keys(value).some(key => !keys.has(key))) throw new Error(`${label}包含不支持的字段`);
}
