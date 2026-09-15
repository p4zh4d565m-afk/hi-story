import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../../src/main/db/migrations';
import { NarrativeHooksRepo } from '../../../src/main/db/repositories/narrative-hooks.repo';

const databases: Database.Database[] = [];
afterEach(() => databases.splice(0).forEach(db => db.close()));
function database() {
  const db = new Database(':memory:');
  databases.push(db);
  return db;
}
function v18(db: Database.Database) {
  db.exec(`CREATE TABLE _migrations (version INTEGER PRIMARY KEY);
    CREATE TABLE narrative_hooks (id TEXT PRIMARY KEY);
    CREATE TABLE narrative_debts (id TEXT PRIMARY KEY);
    CREATE TABLE planning_ideas (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT '');
    INSERT INTO narrative_hooks VALUES ('旧钩子');
    INSERT INTO narrative_debts VALUES ('旧债务');`);
  for (let i = 1; i <= 18; i++) db.prepare('INSERT INTO _migrations VALUES (?)').run(i);
}
describe('v19 主体兼容', () => {
  it('旧行升级为空主体且新列非 NULL 并有空默认值', () => {
    const db = database(); v18(db); runMigrations(db, 19);
    for (const table of ['narrative_hooks', 'narrative_debts']) {
      expect(db.prepare(`PRAGMA table_info(${table})`).all()).toContainEqual(
        expect.objectContaining({ name: 'subject', notnull: 1, dflt_value: "''" }),
      );
      expect(db.prepare(`SELECT subject FROM ${table}`).get()).toEqual({ subject: '' });
    }
    expect(db.prepare('SELECT version FROM _migrations WHERE version=19').get()).toEqual({ version: 19 });
  });
  it('版本登记失败也回滚两条 DDL', () => {
    const db = database(); v18(db);
    db.exec(`CREATE TRIGGER fail_version BEFORE INSERT ON _migrations
      WHEN NEW.version = 19 BEGIN SELECT RAISE(ABORT, '登记失败'); END;`);
    expect(() => runMigrations(db)).toThrow('登记失败');
    for (const table of ['narrative_hooks', 'narrative_debts']) {
      expect(db.prepare(`PRAGMA table_info(${table})`).all().map((x: any) => x.name)).not.toContain('subject');
    }
  });
  it('创建和更新映射主体，自动抽取缺省主体保留为空', () => {
    const db = database(); runMigrations(db);
    db.prepare("INSERT INTO projects (id,name,created_at,updated_at) VALUES ('p','项目','t','t')").run();
    const repo = new NarrativeHooksRepo(db);
    const hook = repo.create({ projectId: 'p', hookType: 'mystery', description: '线索' }).data!;
    const debt = repo.createDebt({ projectId: 'p', debtType: 'reveal', description: '揭晓', subject: '旧站长' } as any).data!;
    expect(hook.subject).toBe('');
    expect(debt.subject).toBe('旧站长');
    expect(repo.update(hook.id, { subject: '车票' } as any).data?.subject).toBe('车票');
    expect(repo.update(hook.id, { description: '新线索' }).data?.subject).toBe('车票');
    expect(repo.updateDebt(debt.id, { subject: '新站长' } as any).data?.subject).toBe('新站长');
    expect(repo.updateDebt(debt.id, { description: '新谜底' }).data?.subject).toBe('新站长');
    expect(repo.createDebt({ projectId: 'p', debtType: 'reveal', description: '自动抽取' }).data?.subject).toBe('');
  });
});
