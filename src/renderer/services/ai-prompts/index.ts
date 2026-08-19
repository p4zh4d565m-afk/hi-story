// ============================================================
// AI Prompt 模板 + 工具函数 barrel 入口
// 原 ai-prompts.ts 已按职责拆分到各子文件，此文件统一 re-export，
// 保证外部引用 `from '../services/ai-prompts'` 零改动。
// ============================================================

export * from './write';
export * from './review';
export * from './summary';
export * from './revise';
export * from './anti-ai';
export * from './polish';
export * from './style-stats';
export * from './utils';
