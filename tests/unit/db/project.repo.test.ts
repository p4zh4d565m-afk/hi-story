import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { ProjectRepo } from '../../../src/main/db/repositories/project.repo';

describe('ProjectRepo', () => {
  let db: Database.Database;
  let repo: ProjectRepo;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type_tags TEXT NOT NULL DEFAULT '[]',
        style TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        obsidian_path TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    repo = new ProjectRepo(db);
  });

  afterEach(() => {
    db.close();
  });

  it('should create a project', () => {
    const result = repo.create({
      name: '测试小说',
      typeTags: ['仙侠'],
      style: '古风',
      summary: '一部测试小说',
    });

    if (!result.success || !result.data) {
      throw new Error('Expected success');
    }
    expect(result.data.name).toBe('测试小说');
    expect(result.data.typeTags).toEqual(['仙侠']);
    expect(result.data.id).toBeTruthy();
  });

  it('should find a project by id', () => {
    const created = repo.create({ name: '测试小说' });
    if (!created.success || !created.data) throw new Error('Expected success');

    const found = repo.findById(created.data.id);
    if (!found.success || !found.data) throw new Error('Expected success');
    expect(found.data.name).toBe('测试小说');
  });

  it('should return error for non-existent project', () => {
    const result = repo.findById('non-existent-id');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Project not found');
  });

  it('should find all projects ordered by updated_at desc', async () => {
    repo.create({ name: '项目A' });
    // Small delay to ensure different timestamps
    await new Promise(resolve => setTimeout(resolve, 10));
    repo.create({ name: '项目B' });

    const result = repo.findAll();
    if (!result.success || !result.data) throw new Error('Expected success');
    expect(result.data.total).toBe(2);
    expect(result.data.items[0].name).toBe('项目B'); // 最新的在前
  });

  it('should update a project', () => {
    const created = repo.create({ name: '旧名称' });
    if (!created.success || !created.data) throw new Error('Expected success');

    const updated = repo.update({
      id: created.data.id,
      name: '新名称',
      typeTags: ['武侠'],
    });
    if (!updated.success || !updated.data) throw new Error('Expected success');
    expect(updated.data.name).toBe('新名称');
    expect(updated.data.typeTags).toEqual(['武侠']);
  });

  it('创建项目时默认不配置 Obsidian 目录', () => {
    const created = repo.create({ name: '无外部目录' });
    if (!created.success || !created.data) throw new Error('Expected success');

    expect(created.data.obsidianPath).toBe('');
  });

  it('保存并读取项目的 Obsidian 目录', () => {
    const created = repo.create({ name: '外部资料项目' });
    if (!created.success || !created.data) throw new Error('Expected success');

    const updated = repo.update({ id: created.data.id, obsidianPath: 'D:\\小说库\\测试项目' });
    if (!updated.success || !updated.data) throw new Error('Expected success');

    expect(updated.data.obsidianPath).toBe('D:\\小说库\\测试项目');
    expect(repo.findById(created.data.id).data?.obsidianPath).toBe('D:\\小说库\\测试项目');
  });

  it('should delete a project', () => {
    const created = repo.create({ name: '待删除' });
    if (!created.success || !created.data) throw new Error('Expected success');

    const removed = repo.remove(created.data.id);
    expect(removed.success).toBe(true);

    const found = repo.findById(created.data.id);
    expect(found.success).toBe(false);
  });
});
