const path = require('node:path');
const { spawnSync } = require('node:child_process');

const electronPath = require('electron');
const vitestPath = path.join(
  path.dirname(require.resolve('vitest/package.json')),
  'vitest.mjs',
);

// 使用 Electron 的 Node 模式运行测试，避免反复改写 better-sqlite3 的应用 ABI。
// 默认 threads 池会在 Windows + Electron 下把 native sqlite 打成 0xC0000409，改 forks 隔离每个文件。
const result = spawnSync(electronPath, [vitestPath, 'run', '--pool=forks'], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  stdio: 'inherit',
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
