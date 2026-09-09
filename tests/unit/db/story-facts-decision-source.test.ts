import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../../src/main/db/migrations';
import { StoryFactsRepo } from '../../../src/main/db/repositories/story-facts.repo';

describe('StoryFactsRepo 决策来源保护', () => {
  let db: Database.Database;
  let repo: StoryFactsRepo;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    db.prepare(`
      INSERT INTO projects (id, name, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `).run('project-a', '项目 A', '2026-09-09T00:00:00.000Z', '2026-09-09T00:00:00.000Z');
    db.prepare(`
      INSERT INTO chapters (id, project_id, title, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('chapter-a', 'project-a', '第一章', '2026-09-09T00:00:00.000Z', '2026-09-09T00:00:00.000Z');
    db.prepare(`
      INSERT INTO creative_decisions (
        id, project_id, decision_type, title, rationale, payload_json,
        status, created_at, confirmed_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'confirmed', ?, ?)
    `).run(
      'decision-a', 'project-a', 'story_fact', '作者确认', '必须保留', '{}',
      '2026-09-09T00:00:00.000Z', '2026-09-09T00:00:00.000Z',
    );
    repo = new StoryFactsRepo(db);
  });

  afterEach(() => db.close());

  it('章节重新抽取只替换非决策事实', () => {
    const insert = db.prepare(`
      INSERT INTO story_facts (
        id, project_id, chapter_id, fact_type, subject, predicate, object,
        description, status, source_decision_id, source_kind, created_at
      ) VALUES (?, 'project-a', 'chapter-a', 'event', '主角', '发现', '线索', ?,
        'active', ?, ?, ?)
    `);
    insert.run(
      'extracted-old', '上次抽取的事实', null, 'chapter_extraction',
      '2026-09-09T01:00:00.000Z',
    );
    insert.run(
      'confirmed-fact', '作者确认保留的事实', 'decision-a', 'author_decision',
      '9999-01-01T00:00:00.000Z',
    );

    repo.batchUpsert({
      projectId: 'project-a',
      chapterId: 'chapter-a',
      facts: [{
        projectId: 'project-a',
        chapterId: 'chapter-a',
        factType: 'event',
        subject: '主角',
        predicate: '获得',
        object: '钥匙',
        description: '本次重新抽取的事实',
      }],
    });

    const activeFacts = repo.findActiveByProject('project-a').data!;
    expect(activeFacts.map(item => item.description)).toEqual([
      '作者确认保留的事实', '本次重新抽取的事实',
    ]);
    expect(activeFacts.map(item => item.sourceKind)).toEqual([
      'author_decision', 'chapter_extraction',
    ]);
  });

  it('章节重新抽取保护决策知识且查询排除已被取代的知识', () => {
    const insert = db.prepare(`
      INSERT INTO character_knowledge (
        id, project_id, character_name, fact_description, source,
        learned_at_chapter_id, source_decision_id, source_kind, status,
        superseded_by, created_at
      ) VALUES (?, 'project-a', '林岚', ?, '第一章', 'chapter-a', ?, ?, ?, ?, ?)
    `);
    insert.run(
      'knowledge-old', '上次抽取的知识', null, 'chapter_extraction', 'active', null,
      '2026-09-09T01:00:00.000Z',
    );
    insert.run(
      'knowledge-confirmed', '作者确认保留的知识', 'decision-a', 'author_decision', 'active', null,
      '9999-01-01T00:00:00.000Z',
    );
    insert.run(
      'knowledge-superseded', '已被取代的知识', 'decision-a', 'author_decision', 'superseded',
      'knowledge-confirmed', '2026-09-09T02:00:00.000Z',
    );

    repo.batchUpsertKnowledge({
      projectId: 'project-a',
      chapterId: 'chapter-a',
      knowledge: [{
        projectId: 'project-a',
        characterName: '林岚',
        factDescription: '本次重新抽取的知识',
        source: '第一章',
        learnedAtChapterId: 'chapter-a',
      }],
    });

    const activeKnowledge = repo.findAllKnowledgeByProject('project-a').data!;
    expect(activeKnowledge.map(item => item.factDescription)).toEqual([
      '作者确认保留的知识', '本次重新抽取的知识',
    ]);
    expect(activeKnowledge.map(item => item.factDescription)).not.toContain('已被取代的知识');
    expect(activeKnowledge.map(item => item.sourceKind)).toEqual([
      'author_decision', 'chapter_extraction',
    ]);
  });
});
