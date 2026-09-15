import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // 在 vitest 默认排除（node_modules/dist/.git 等）基础上，额外排除 git worktree 副本，
    // 避免全量跑时重复扫描旧树、稀释主树真实规模。
    exclude: ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/.worktrees/**'],
  },
});
