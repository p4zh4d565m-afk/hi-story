const Database = require('better-sqlite3');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runMigrations } = require('../../dist/main/main/db/migrations');
const { ObsidianImportRepo } = require('../../dist/main/main/db/repositories/obsidian-import.repo');

// 为 obsidian 导入真实 UI 回归提供内存数据库 + 主进程侧仓储 + 真实临时 Obsidian 目录。
module.exports = function registerObsidianImportTestDb(ipcMain) {
  let db;
  let repo;
  let vault;

  ipcMain.handle('test:obsidian-import-db', (_event, channel, ...args) => {
    if (channel === 'reset') {
      if (db) db.close();
      if (vault) fs.rmSync(vault, { recursive: true, force: true });
      db = new Database(':memory:');
      db.pragma('foreign_keys = ON');
      runMigrations(db);
      db.exec(`INSERT INTO projects(id,name,created_at,updated_at) VALUES ('project-a','测试项目','t','t');`);

      // 准备真实临时 Obsidian 目录
      vault = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-import-ui-'));
      fs.mkdirSync(path.join(vault, '人物'), { recursive: true });
      fs.writeFileSync(path.join(vault, '完整大纲.md'), [
        '# 完整大纲',
        '## 一、作品定位',
        '- 类型：BL',
        '- 结局：开放式结局',
        '## 二、三卷大纲索引',
        '1. [卷 1 陆昭线（第 1-50 章）](卷1.md)',
      ].join('\n'));
      fs.writeFileSync(path.join(vault, '人物', '沈屿.md'), [
        '# 沈屿',
        '## 性格层次',
        '- 表面：高智商。',
      ].join('\n'));
      db.prepare('UPDATE projects SET obsidian_path = ? WHERE id = ?').run(vault, 'project-a');

      repo = new ObsidianImportRepo(db);
      return { success: true };
    }
    if (channel === 'snapshot') {
      return {
        planning: db.prepare('SELECT * FROM planning_ideas').all(),
        characters: db.prepare('SELECT * FROM characters ORDER BY id').all(),
        worlds: db.prepare('SELECT * FROM world_entries ORDER BY id').all(),
      };
    }
    // 兼容真实 IPC 通道名（面板实际调用）与测试便捷名
    if (channel === 'obsidian:preparePlanningImport' || channel === 'prepare') return repo.prepare(args[0]);
    if (channel === 'obsidian:commitPlanningImport' || channel === 'commit') return repo.commit(args[0]);
    if (channel === 'obsidian:reparsePlanningImport' || channel === 'reparse') return repo.reparse(args[0]);
    throw new Error('未知测试请求: ' + channel);
  });
};
