const Database = require('better-sqlite3');
const { runMigrations } = require('../../dist/main/main/db/migrations');
const { CreativeDecisionRepo } = require('../../dist/main/main/db/repositories/creative-decision.repo');

module.exports = function registerDecisionTestDb(ipcMain) {
  let db;
  let repo;
  ipcMain.handle('test:decision-db', (_event, channel, ...args) => {
    if (channel === 'reset') {
      if (db) db.close();
      db = new Database(':memory:');
      db.pragma('foreign_keys = ON');
      runMigrations(db);
      db.exec(`INSERT INTO projects(id,name,created_at,updated_at) VALUES ('project-a','测试项目','t','t');
        INSERT INTO conversation_threads(id,project_id,title,category,created_at,updated_at) VALUES ('thread-a','project-a','测试','general','t','t');
        INSERT INTO conversation_messages(id,thread_id,role,content,timestamp,updated_at,sort_order,context_type)
        VALUES ('assistant-message','thread-a','assistant','测试回复','t','t',0,'chat');`);
      repo = new CreativeDecisionRepo(db);
      return { success: true };
    }
    if (channel === 'snapshot') {
      return Object.fromEntries(['story_facts','character_knowledge','narrative_hooks','narrative_debts','creative_decisions','creative_decision_effects']
        .map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()]));
    }
    if (channel === 'failure') {
      db.exec(args[0] ? "CREATE TRIGGER fail_effect BEFORE INSERT ON creative_decision_effects BEGIN SELECT RAISE(ABORT, '模拟事务失败'); END;"
        : 'DROP TRIGGER fail_effect');
      return { success: true };
    }
    const method = channel.replace('db:creativeDecisions:', '');
    if (!['createProposals','findByProject','findRelatedItems','updateProposal','confirmMany','prepareRevision','createRevision','reject'].includes(method)) throw new Error('未知测试请求');
    return repo[method](...args);
  });
};
