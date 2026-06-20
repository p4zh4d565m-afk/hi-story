import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { ProjectRepo } from '../../src/main/db/repositories/project.repo';
import { runMigrations } from '../../src/main/db/migrations';

describe('Project CRUD E2E', () => {
  let db: Database.Database;
  let repo: ProjectRepo;

  beforeAll(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    repo = new ProjectRepo(db);
  });

  afterAll(() => {
    db.close();
  });

  it('should create, read, update, and delete a project', () => {
    // Create
    const createResult = repo.create({
      name: '苍云传',
      typeTags: ['仙侠', '武侠'],
      style: '古风',
      summary: '少年背负古剑，踏上寻找真相的旅途。',
    });
    expect(createResult.success).toBe(true);
    const projectId = createResult.data!.id;

    // Read
    const readResult = repo.findById(projectId);
    expect(readResult.success).toBe(true);
    expect(readResult.data!.name).toBe('苍云传');

    // Update
    const updateResult = repo.update({
      id: projectId,
      name: '苍云传·修订版',
    });
    expect(updateResult.success).toBe(true);
    expect(updateResult.data!.name).toBe('苍云传·修订版');

    // Delete
    const deleteResult = repo.remove(projectId);
    expect(deleteResult.success).toBe(true);

    // Verify deleted
    const notFound = repo.findById(projectId);
    expect(notFound.success).toBe(false);
  });

  it('should list projects sorted by updated_at desc', async () => {
    repo.create({ name: '最早' });
    // Small delay to ensure different timestamps
    await new Promise(resolve => setTimeout(resolve, 10));
    repo.create({ name: '最新' });

    const result = repo.findAll();
    expect(result.success).toBe(true);
    expect(result.data!.total).toBeGreaterThanOrEqual(2);
    expect(result.data!.items[0].name).toBe('最新');
  });
});
