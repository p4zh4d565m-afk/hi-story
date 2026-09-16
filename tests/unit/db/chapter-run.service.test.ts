import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../../src/main/db/migrations';
import { ChapterRunRepo } from '../../../src/main/db/repositories/chapter-run.repo';
import {
  ChapterRunService,
  ERR_RUN_ALREADY_COMMITTED,
  ERR_RUN_PROJECT_MISMATCH,
  ERR_RUN_NOT_FOUND,
  ERR_EMPTY_DRAFT,
} from '../../../src/main/db/repositories/chapter-run.service';

describe('ChapterRunService — commit 幂等 + 启动恢复', () => {
  let db: Database.Database;
  let repo: ChapterRunRepo;
  let service: ChapterRunService;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO projects (id, name, type_tags, style, summary, created_at, updated_at) VALUES ('p1','t','[]','','',?,?)`,
    ).run(now, now);
    repo = new ChapterRunRepo(db);
    service = new ChapterRunService(db);
  });

  afterEach(() => {
    db.close();
  });

  function seedRun(status: string, draftContent: string | null, targetChapterId?: string): string {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO chapter_runs (id, project_id, requested_title, status, draft_content, target_chapter_id, created_at, updated_at)
      VALUES ('r1','p1','章',?,?,?,?,?)
    `).run(status, draftContent, targetChapterId ?? null, now, now);
    return 'r1';
  }

  it('drafted 提交成功 → committed + 建章节 + 绑定 target', () => {
    seedRun('drafted', '<p>正文</p>');
    const res = service.commit('r1', 'p1', null);
    expect(res.success).toBe(true);
    expect(res.data?.chapter.id).toBeTruthy();
    const run = repo.findById('r1')!;
    expect(run.status).toBe('committed');
    expect(run.targetChapterId).toBe(res.data!.chapter.id);
    const chapter = db.prepare(`SELECT content FROM chapters WHERE id = ?`).get(res.data!.chapter.id) as { content: string };
    expect(chapter.content).toBe('<p>正文</p>');
  });

  it('重复 commit 返回原章节 id（幂等）', () => {
    seedRun('drafted', '<p>正文</p>');
    const first = service.commit('r1', 'p1', null);
    expect(first.success).toBe(true);
    const second = service.commit('r1', 'p1', null);
    expect(second.success).toBe(true);
    expect(second.data?.chapter.id).toBe(first.data!.chapter.id);
    // 章节只建了一条
    const count = db.prepare(`SELECT COUNT(*) as n FROM chapters WHERE project_id = 'p1'`).get() as { n: number };
    expect(count.n).toBe(1);
  });

  it('非 drafted 状态不可提交（running/cancelled）', () => {
    seedRun('running', '<p>正文</p>');
    const res = service.commit('r1', 'p1', null);
    expect(res.success).toBe(false);
    expect(res.error).toContain('不可提交');
  });

  it('空草稿不可提交', () => {
    seedRun('drafted', '');
    const res = service.commit('r1', 'p1', null);
    expect(res.success).toBe(false);
    expect(res.error).toBe(ERR_EMPTY_DRAFT);
  });

  it('run 不存在 → RUN_NOT_FOUND', () => {
    const res = service.commit('nonexistent', 'p1', null);
    expect(res.success).toBe(false);
    expect(res.error).toBe(ERR_RUN_NOT_FOUND);
  });

  it('项目不匹配 → RUN_PROJECT_MISMATCH', () => {
    seedRun('drafted', '<p>正文</p>');
    const res = service.commit('r1', 'other-project', null);
    expect(res.success).toBe(false);
    expect(res.error).toBe(ERR_RUN_PROJECT_MISMATCH);
  });

  it('启动恢复：running → failed/PROCESS_INTERRUPTED，不自动重放', () => {
    seedRun('running', null);
    const recovered = service.recoverInterruptedAll();
    expect(recovered).toBe(1);
    const run = repo.findById('r1')!;
    expect(run.status).toBe('failed');
    expect(run.errorCode).toBe('PROCESS_INTERRUPTED');
    // 未触发任何模型请求（这里只验证状态，模型调用在 IPC 层，不在此路径）
  });

  it('启动恢复只处理 running，不动 drafted/committed', () => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO chapter_runs (id, project_id, requested_title, status, draft_content, created_at, updated_at)
       VALUES ('d1','p1','草稿','drafted','<p>x</p>',?,?)`,
    ).run(now, now);
    db.prepare(
      `INSERT INTO chapter_runs (id, project_id, requested_title, status, draft_content, created_at, updated_at)
       VALUES ('c1','p1','已提交','committed','<p>x</p>',?,?)`,
    ).run(now, now);

    const recovered = service.recoverInterruptedAll();
    expect(recovered).toBe(0);
    expect(repo.findById('d1')!.status).toBe('drafted');
    expect(repo.findById('c1')!.status).toBe('committed');
  });
});
