// ===== 小说项目 =====
export interface Project {
  id: string;
  name: string;
  typeTags: string[];       // 类型标签: ["仙侠", "宫斗"]
  style: string;             // 风格描述
  summary: string;           // 简介
  createdAt: string;         // ISO 8601
  updatedAt: string;         // ISO 8601
}

export interface CreateProjectInput {
  name: string;
  typeTags?: string[];
  style?: string;
  summary?: string;
}

export interface UpdateProjectInput {
  id: string;
  name?: string;
  typeTags?: string[];
  style?: string;
  summary?: string;
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
  createdAt: string;
  updatedAt: string;
}

export interface ConversationThread {
  id: string;
  projectId: string;
  title: string;
  category: 'character' | 'plot' | 'world' | 'general';
  createdAt: string;
}

export interface ConversationMessage {
  id: string;
  threadId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  providerId?: string;
  timestamp: string;
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
