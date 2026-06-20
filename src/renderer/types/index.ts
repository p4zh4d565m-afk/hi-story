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
