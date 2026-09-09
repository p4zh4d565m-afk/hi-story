// ===== 小说项目 =====
export interface Project {
  id: string;
  name: string;
  typeTags: string[];       // 类型标签: ["仙侠", "宫斗"]
  style: string;             // 风格描述
  summary: string;           // 简介
  obsidianPath: string;      // Obsidian 仓库或项目目录（只读数据源）
  createdAt: string;         // ISO 8601
  updatedAt: string;         // ISO 8601
}

export interface CreateProjectInput {
  name: string;
  typeTags?: string[];
  style?: string;
  summary?: string;
  obsidianPath?: string;
}

export interface UpdateProjectInput {
  id: string;
  name?: string;
  typeTags?: string[];
  style?: string;
  summary?: string;
  obsidianPath?: string;
}

// ===== Obsidian 单向只读资料 =====
export type ObsidianDocumentKind = 'character' | 'world' | 'outline';

export interface ObsidianDocument {
  id: string;
  kind: ObsidianDocumentKind;
  name: string;
  relativePath: string;
  content: string;
  frontmatter: Record<string, unknown>;
  updatedAt: string;
}

export interface ObsidianScanWarning {
  relativePath: string;
  message: string;
}

export interface ObsidianScanResult {
  status: 'unconfigured' | 'missing' | 'ready';
  path: string;
  documents: ObsidianDocument[];
  warnings: ObsidianScanWarning[];
  message?: string;
}

// ===== 数据库通用 =====
export interface PaginationParams {
  limit?: number;
  offset?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
}

// ===== IPC 响应 =====
export interface IpcResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

// ===== 窗口状态 =====
export type MainView = 'write' | 'chat' | 'canvas';

// ===== 关联引用 =====
export type EntityType = 'project' | 'character' | 'chapter' | 'world_entry' | 'outline_node' | 'conversation' | 'material';

export interface ReferenceLink {
  id: string;
  sourceType: EntityType;
  sourceId: string;
  targetType: EntityType;
  targetId: string;
  relationType: string;
  createdAt: string;
}

// ===== 后续模块占位类型 =====
export interface OutlineNode {
  id: string;
  projectId: string;
  parentId: string | null;
  title: string;
  summary: string;
  sortOrder: number;
  createdAt: string;
}

export interface Character {
  id: string;
  projectId: string;
  name: string;
  aliases: string;
  appearance: string;
  personality: string;
  background: string;
  arc: string;
  profileOutline: string;   // JSON 树 [{id, text, children}]
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorldEntry {
  id: string;
  projectId: string;
  parentId: string | null;
  category: 'place' | 'faction' | 'race' | 'law' | 'history' | 'culture';
  name: string;
  description: string;
  sortOrder: number;
  createdAt: string;
}

export interface Chapter {
  id: string;
  projectId: string;
  title: string;
  content: string;          // HTML (TipTap 输出)
  status: 'draft' | 'final';
  wordCount: number;
  sortOrder: number;
  summary: string;           // AI 生成的章节摘要（100-200字）
  planningOutline: ChapterOutline | null; // 创建正文时冻结的章纲快照
  createdAt: string;
  updatedAt: string;
}

export interface ConversationThread {
  id: string;
  projectId: string;
  title: string;
  category: 'character' | 'plot' | 'world' | 'general';
  createdAt: string;
  updatedAt: string;
}

export interface ConversationMessage {
  id: string;
  threadId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  providerId: string | null;
  contextType: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationSnapshot {
  threads: ConversationThread[];
  messages: Record<string, ConversationMessage[]>;
}

export interface CreateConversationThreadInput {
  projectId: string;
  title: string;
  category: ConversationThread['category'];
  id?: string;
  createdAt?: string;
}

export interface AppendConversationMessageInput {
  projectId: string;
  threadId: string;
  role: ConversationMessage['role'];
  content: string;
  providerId?: string | null;
  contextType: string;
  id?: string;
  createdAt?: string;
}

export interface LegacyConversationEntry {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface LegacyConversationThread {
  id: string;
  name: string;
  category: ConversationThread['category'];
  createdAt: string;
}

export interface LegacyConversationData {
  threads: LegacyConversationThread[];
  messages: Record<string, LegacyConversationEntry[]>;
}

export interface LegacyMigrationResult {
  status: 'imported' | 'already_migrated' | 'no_data';
  threadCount: number;
  messageCount: number;
}

export interface Material {
  id: string;
  projectId: string | null;  // null = 全局素材
  sourceLayer: 'public_domain' | 'history_military' | 'myth_fantasy' | 'dictionary' | 'user';
  title: string;
  content: string;
  url: string | null;
  tags: string[];
  createdAt: string;
}

export interface AIConfig {
  id: string;
  provider: string;
  apiKey: string;           // 加密存储
  model: string;
  baseUrl: string;
  isActive: boolean;
  createdAt: string;
}

/** 章节历史快照 */
export interface ChapterHistorySnapshot {
  id: string;
  chapterId: string;
  content: string;
  wordCount: number;
  savedAt: string;
}

// ===== AI 写章 =====
export interface WriteChapterConfig {
  outlineNodeId: string;
  targetWords: number;
  styleGuide: string;
  includeContext: boolean;
  includeCharacters: boolean;
  includeWorld: boolean;
  extraRequirement: string;
}

// ===== AI 审稿 =====
export interface AIReviewResult {
  totalScore: number;      // 0-100
  summary: string;
  criticalCount: number;
  warningCount: number;
  passedCount: number;
  dimensions: ReviewDimension[];
  issues: ReviewIssue[];
}

export interface ReviewDimension {
  id: number;
  name: string;
  score: number;          // 0-100
  passed: boolean;        // 60 分以上通过
}

export interface ReviewIssue {
  severity: 'critical' | 'warning' | 'info';
  dimensionId: number;
  location: string;       // 问题位置（段落文本片段）
  description: string;
  suggestion: string;
}

// ===== 反 AI 痕迹检测 =====
export interface AntiAICheckResult {
  totalScore: number;       // 0-100，越高越好（越不像AI）
  checks: AntiAICheckItem[];
}

export interface AntiAICheckItem {
  name: string;
  passed: boolean;
  score: number;            // 0-100
  detail: string;
  suggestions: string[];
}

// ===== 伏笔追踪 =====
export interface Foreshadowing {
  id: string;
  project_id: string;
  title: string;
  description: string;
  status: 'planted' | 'pending' | 'resolved';
  planted_chapter_id: string | null;
  resolved_chapter_id: string | null;
  related_characters: string;
  related_outline_nodes: string;
  note: string;
  created_at: string;
  updated_at: string;
}

// ===== 叙事事实层（P0 — 解决长篇一致性） =====
export interface StoryFact {
  id: string;
  projectId: string;
  chapterId: string | null;
  factType: 'location' | 'possession' | 'relationship' | 'knowledge' | 'event' | 'emotional_state' | 'hook';
  subject: string;       // 谁/什么
  predicate: string;     // 做了什么/发生了什么
  object: string;        // 对象/结果
  description: string;   // 完整描述
  status: 'active' | 'superseded' | 'resolved';
  supersededBy: string | null;
  sourceDecisionId: string | null;
  sourceKind: 'legacy' | 'chapter_extraction' | 'author_decision';
  createdAt: string;
}

export interface CharacterKnowledge {
  id: string;
  projectId: string;
  characterId: string | null;
  characterName: string;
  factDescription: string;
  source: string;              // 从哪知道的（章节标题或事件）
  learnedAtChapterId: string | null;
  sourceDecisionId: string | null;
  sourceKind: 'legacy' | 'chapter_extraction' | 'author_decision';
  status: 'active' | 'superseded';
  supersededBy: string | null;
  createdAt: string;
}

// ===== 叙事钩子（P1 — 网文追读力） =====
export interface NarrativeHook {
  id: string;
  projectId: string;
  chapterId: string | null;
  hookType: 'cliffhanger' | 'foreshadowing' | 'promise' | 'mystery' | 'emotional_hook';
  description: string;
  intensity: number;          // 1-5 强度
  status: 'open' | 'partially_resolved' | 'resolved' | 'abandoned';
  resolvedInChapterId: string | null;
  dueChapterId: string | null;  // 建议在哪章回收
  sourceDecisionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NarrativeDebt {
  id: string;
  projectId: string;
  chapterId: string | null;
  description: string;
  debtType: 'reveal' | 'payoff' | 'character_return' | 'mystery_answer' | 'power_up';
  promisedByChapter: number | null;
  status: 'unpaid' | 'paid' | 'overdue' | 'waived';
  paidInChapterId: string | null;
  sourceDecisionId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ===== 创作决策确认账本 =====
export interface StoryFactDecisionPayload {
  factType: 'location' | 'possession' | 'relationship' | 'knowledge' | 'event' | 'emotional_state';
  subject: string;
  predicate: string;
  object: string;
  description: string;
  chapterId?: string | null;
  targetId?: string | null;
}

export interface KnowledgeDecisionPayload {
  characterId?: string | null;
  characterName: string;
  factDescription: string;
  source: string;
  learnedAtChapterId?: string | null;
  targetId?: string | null;
}

export interface HookDecisionPayload {
  hookType: 'cliffhanger' | 'foreshadowing' | 'promise' | 'mystery' | 'emotional_hook';
  description: string;
  intensity: number;
  chapterId?: string | null;
  dueChapterId?: string | null;
  targetId?: string | null;
}

export interface DebtDecisionPayload {
  debtType: 'reveal' | 'payoff' | 'character_return' | 'mystery_answer' | 'power_up';
  description: string;
  chapterId?: string | null;
  promisedByChapter?: number | null;
  targetId?: string | null;
}

export type CreativeDecisionDraft =
  | { type: 'story_fact'; title: string; rationale: string; payload: StoryFactDecisionPayload }
  | { type: 'character_knowledge'; title: string; rationale: string; payload: KnowledgeDecisionPayload }
  | { type: 'narrative_hook'; title: string; rationale: string; payload: HookDecisionPayload }
  | { type: 'narrative_debt'; title: string; rationale: string; payload: DebtDecisionPayload };

export type CreativeDecision = CreativeDecisionDraft & {
  id: string;
  projectId: string;
  sourceThreadId: string | null;
  sourceMessageId: string | null;
  parentDecisionId: string | null;
  status: 'proposed' | 'confirmed' | 'rejected' | 'superseded';
  createdAt: string;
  confirmedAt: string | null;
  rejectedAt: string | null;
};

export interface CreativeDecisionEffect {
  id: string;
  decisionId: string;
  targetTable: 'story_facts' | 'character_knowledge' | 'narrative_hooks' | 'narrative_debts';
  targetId: string;
  operation: 'insert' | 'update' | 'supersede';
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  createdAt: string;
}

export interface CreateCreativeDecisionProposalsInput {
  projectId: string;
  sourceThreadId: string;
  sourceMessageId: string;
  drafts: CreativeDecisionDraft[];
}

export interface ConfirmCreativeDecisionsInput {
  projectId: string;
  decisionIds: string[];
}

export interface UpdateCreativeDecisionProposalInput {
  projectId: string;
  decisionId: string;
  draft: CreativeDecisionDraft;
}

export interface CreateCreativeDecisionRevisionInput {
  projectId: string;
  parentDecisionId: string;
  draft: CreativeDecisionDraft;
}

// ===== 风格指纹（P3 — 从 localStorage 迁移到主类型） =====
export interface StyleFingerprint {
  sentenceStyle: string;
  rhetoricStyle: string;
  dialogueStyle: string;
  moodTone: string;
  vocabTraits: string;
  chapterStructure: string;
  rawAnalysis: string;
  updatedAt: string;
}

// ===== 写作 Skill 引擎 =====
export interface WritingSkillSummary {
  id: string;
  name: string;
  description: string;
  tags: string;
}

export interface WritingSkill extends WritingSkillSummary {
  content: string;
}

// ===== 策划工作台 =====
export interface StoryOption {
  title: string;
  logline: string;
  targetReader: string;
  corePromise: string;
  protagonist: string;
  centralConflict: string;
  differentiator: string;
  endingDirection: string;
}

export interface PlanningIdea {
  id: string;
  projectId: string;
  idea: string;
  requirements: string;
  generatedOptions: StoryOption[];
  selectedOption: number | null;
  status: 'draft' | 'generated' | 'confirmed';
  masterOutline: MasterOutline | null;
  outlineStatus: 'empty' | 'generated' | 'locked';
  volumeOutlines: VolumeOutline[];
  volumeStatus: 'empty' | 'generated' | 'locked';
  chapterOutlines: ChapterOutline[];
  chapterOutlineStatus: 'empty' | 'generated' | 'locked';
  createdAt: string;
  updatedAt: string;
}

export interface VolumeOutline {
  title: string;
  chapterRange: string;
  volumeGoal: string;
  openingState: string;
  mainProgression: string;
  characterProgression: string;
  keyEvents: string[];
  climax: string;
  endingState: string;
  promisesOpened: string[];
  promisesPaid: string[];
}

export interface ChapterOutline {
  volumeIndex: number;
  chapterNumber: number;
  title: string;
  pov: string;
  chapterGoal: string;
  openingSituation: string;
  centralConflict: string;
  keyBeats: string[];
  reveal: string;
  characterChange: string;
  emotionalBeat: string;
  payoff: string;
  endingHook: string;
}

export interface OutlinePhase {
  title: string;
  purpose: string;
  chapterRange: string;
  keyEvents: string[];
  turningPoint: string;
  emotionTrend: string;
}

export interface MasterOutline {
  premise: string;
  ending: string;
  protagonistArc: string;
  centralConflict: string;
  structureModel: string;
  phases: OutlinePhase[];
  subplots: string[];
  storyPromises: string[];
}
