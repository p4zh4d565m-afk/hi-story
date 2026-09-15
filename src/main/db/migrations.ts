import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

type Migration = {
  version: number;
  sql: string;
  /** 同事务内 DDL 之后执行（如 JSON 补 id） */
  after?: (db: Database.Database) => void;
  /**
   * SQLite 在已开启的事务内无法切换 foreign_keys（静默 no-op）。
   * 需重建带外键父表时，必须在 BEGIN 之前关闭 FK。
   */
  rebuildsWithFkOff?: boolean;
};

const MIGRATIONS: Migration[] = [
  // 001: 核心表
  {
    version: 1,
    sql: `
      -- 小说项目
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type_tags TEXT NOT NULL DEFAULT '[]',  -- JSON array
        style TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- 大纲节点
      CREATE TABLE IF NOT EXISTS outline_nodes (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        parent_id TEXT,
        title TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (parent_id) REFERENCES outline_nodes(id) ON DELETE SET NULL
      );

      -- 角色
      CREATE TABLE IF NOT EXISTS characters (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        aliases TEXT NOT NULL DEFAULT '',
        appearance TEXT NOT NULL DEFAULT '',
        personality TEXT NOT NULL DEFAULT '',
        background TEXT NOT NULL DEFAULT '',
        arc TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      -- 世界观条目
      CREATE TABLE IF NOT EXISTS world_entries (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        parent_id TEXT,
        category TEXT NOT NULL CHECK(category IN ('place','faction','race','law','history','culture')),
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (parent_id) REFERENCES world_entries(id) ON DELETE SET NULL
      );

      -- 章节
      CREATE TABLE IF NOT EXISTS chapters (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '未命名章节',
        content TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','final')),
        word_count INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      -- 对话线程
      CREATE TABLE IF NOT EXISTS conversation_threads (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '新对话',
        category TEXT NOT NULL DEFAULT 'general' CHECK(category IN ('character','plot','world','general')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      -- 对话消息
      CREATE TABLE IF NOT EXISTS conversation_messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
        content TEXT NOT NULL DEFAULT '',
        provider_id TEXT,
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (thread_id) REFERENCES conversation_threads(id) ON DELETE CASCADE
      );

      -- 素材
      CREATE TABLE IF NOT EXISTS materials (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        source_layer TEXT NOT NULL CHECK(source_layer IN ('public_domain','history_military','myth_fantasy','dictionary','user')),
        title TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        url TEXT,
        tags TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
      );

      -- 通用关联表
      CREATE TABLE IF NOT EXISTS reference_links (
        id TEXT PRIMARY KEY,
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_rl_source ON reference_links(source_type, source_id);
      CREATE INDEX IF NOT EXISTS idx_rl_target ON reference_links(target_type, target_id);

      -- AI 配置
      CREATE TABLE IF NOT EXISTS ai_configs (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        api_key TEXT NOT NULL,
        model TEXT NOT NULL,
        base_url TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- 迁移版本表
      CREATE TABLE IF NOT EXISTS _migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },

  // 002: 关系箭头方向
  {
    version: 2,
    sql: `
      ALTER TABLE reference_links ADD COLUMN arrow_direction TEXT NOT NULL DEFAULT 'none';
      CREATE INDEX IF NOT EXISTS idx_rl_arrow ON reference_links(arrow_direction);
    `,
  },

  // 003: 角色幕布式大纲
  {
    version: 3,
    sql: `
      ALTER TABLE characters ADD COLUMN profile_outline TEXT NOT NULL DEFAULT '[]';
    `,
  },

  // 004: 章节历史版本
  {
    version: 4,
    sql: `
      CREATE TABLE IF NOT EXISTS chapter_history (
        id TEXT PRIMARY KEY,
        chapter_id TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        word_count INTEGER NOT NULL DEFAULT 0,
        saved_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_chapter_history_chapter ON chapter_history(chapter_id);
    `,
  },
  // 005: 参考文档库（导入小说作为写作参考）
  {
    version: 5,
    sql: `
      -- 参考文档元数据（全局共享，不关联项目）
      CREATE TABLE IF NOT EXISTS reference_docs (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        author TEXT,
        format TEXT NOT NULL CHECK(format IN ('txt','epub','markdown')),
        total_words INTEGER NOT NULL DEFAULT 0,
        source_file TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- 文档分块（用于相似度匹配）
      CREATE TABLE IF NOT EXISTS reference_chunks (
        id TEXT PRIMARY KEY,
        doc_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        word_count INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (doc_id) REFERENCES reference_docs(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_ref_chunks_doc ON reference_chunks(doc_id);

      -- FTS5 全文索引（加速候选召回）
      CREATE VIRTUAL TABLE IF NOT EXISTS reference_chunks_fts USING fts5(
        content,
        content='reference_chunks',
        content_rowid='rowid'
      );
    `,
  },

  // 006: 向量索引（语义搜索）
  {
    version: 6,
    sql: `
      -- reference_chunks 加向量列（text2vec-base-chinese: 768 维 × 4字节 = 3072 B）
      ALTER TABLE reference_chunks ADD COLUMN embedding BLOB;

      -- 文学库向量表（literary.db 为只读，向量存主库）
      CREATE TABLE IF NOT EXISTS lit_embeddings (
        lit_rowid INTEGER PRIMARY KEY,
        embedding BLOB NOT NULL
      );
    `,
  },

  // 007: 伏笔追踪系统
  {
    version: 7,
    sql: `
      CREATE TABLE IF NOT EXISTS foreshadowings (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'planted' CHECK(status IN ('planted','pending','resolved')),
        planted_chapter_id TEXT,
        resolved_chapter_id TEXT,
        related_characters TEXT NOT NULL DEFAULT '[]',
        related_outline_nodes TEXT NOT NULL DEFAULT '[]',
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_foreshadowings_project ON foreshadowings(project_id);
      CREATE INDEX IF NOT EXISTS idx_foreshadowings_status ON foreshadowings(status);
    `,
  },

  // 008: 章节 AI 摘要（支撑写章时注入前文事件上下文）
  {
    version: 8,
    sql: `
      ALTER TABLE chapters ADD COLUMN summary TEXT NOT NULL DEFAULT '';
    `,
  },

  // 009: 叙事事实层 — 解决长篇 AI "忘事/乱编"问题
  // 参考 inkos 的 truth files + Webnovel-Writer 的契约系统
  {
    version: 9,
    sql: `
      -- 每章的原子事实（角色在哪、拿了什么、关系变了没、知道了什么）
      CREATE TABLE IF NOT EXISTS story_facts (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        chapter_id TEXT,
        fact_type TEXT NOT NULL CHECK(fact_type IN ('location','possession','relationship','knowledge','event','emotional_state','hook')),
        subject TEXT NOT NULL DEFAULT '',
        predicate TEXT NOT NULL DEFAULT '',
        object TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','superseded','resolved')),
        superseded_by TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_story_facts_project ON story_facts(project_id);
      CREATE INDEX IF NOT EXISTS idx_story_facts_chapter ON story_facts(chapter_id);
      CREATE INDEX IF NOT EXISTS idx_story_facts_type ON story_facts(fact_type);
      CREATE INDEX IF NOT EXISTS idx_story_facts_subject ON story_facts(subject);

      -- 角色信息边界：角色A知道什么、从哪知道的（支撑审稿维度#15 信息越界）
      CREATE TABLE IF NOT EXISTS character_knowledge (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        character_id TEXT,
        character_name TEXT NOT NULL DEFAULT '',
        fact_description TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT '',
        learned_at_chapter_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE SET NULL,
        FOREIGN KEY (learned_at_chapter_id) REFERENCES chapters(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_char_knowledge_project ON character_knowledge(project_id);
      CREATE INDEX IF NOT EXISTS idx_char_knowledge_character ON character_knowledge(character_id);
    `,
  },

  // 010: 叙事钩子 + 叙事债务追踪（P1 — 网文追读力系统）
  {
    version: 10,
    sql: `
      -- 叙事钩子：结尾悬念、伏笔 hook、待回收的承诺
      CREATE TABLE IF NOT EXISTS narrative_hooks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        chapter_id TEXT,
        hook_type TEXT NOT NULL CHECK(hook_type IN ('cliffhanger','foreshadowing','promise','mystery','emotional_hook')),
        description TEXT NOT NULL DEFAULT '',
        intensity INTEGER NOT NULL DEFAULT 3 CHECK(intensity BETWEEN 1 AND 5),
        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','partially_resolved','resolved','abandoned')),
        resolved_in_chapter_id TEXT,
        due_chapter_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_narrative_hooks_project ON narrative_hooks(project_id);
      CREATE INDEX IF NOT EXISTS idx_narrative_hooks_status ON narrative_hooks(status);

      -- 叙事债务：作者对读者的承诺（"下章揭晓真相"类型的待兑现承诺）
      CREATE TABLE IF NOT EXISTS narrative_debts (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        chapter_id TEXT,
        description TEXT NOT NULL DEFAULT '',
        debt_type TEXT NOT NULL CHECK(debt_type IN ('reveal','payoff','character_return','mystery_answer','power_up')),
        promised_by_chapter INTEGER,
        status TEXT NOT NULL DEFAULT 'unpaid' CHECK(status IN ('unpaid','paid','overdue','waived')),
        paid_in_chapter_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_narrative_debts_project ON narrative_debts(project_id);
      CREATE INDEX IF NOT EXISTS idx_narrative_debts_status ON narrative_debts(status);
    `,
  },
  // 011: 策划工作台 — 保存创意、AI 候选方案与确认结果
  {
    version: 11,
    sql: `
      CREATE TABLE IF NOT EXISTS planning_ideas (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        idea TEXT NOT NULL DEFAULT '',
        requirements TEXT NOT NULL DEFAULT '',
        generated_options TEXT NOT NULL DEFAULT '[]',
        selected_option INTEGER,
        status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','generated','confirmed')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_planning_ideas_project ON planning_ideas(project_id);
    `,
  },
  // 012: 策划工作台 — 结构化全书总纲与锁定状态
  {
    version: 12,
    sql: `
      ALTER TABLE planning_ideas ADD COLUMN master_outline TEXT NOT NULL DEFAULT '';
      ALTER TABLE planning_ideas ADD COLUMN outline_status TEXT NOT NULL DEFAULT 'empty'
        CHECK(outline_status IN ('empty','generated','locked'));
    `,
  },
  // 013: 策划工作台 — 结构化分卷纲与锁定状态
  {
    version: 13,
    sql: `
      ALTER TABLE planning_ideas ADD COLUMN volume_outlines TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE planning_ideas ADD COLUMN volume_status TEXT NOT NULL DEFAULT 'empty'
        CHECK(volume_status IN ('empty','generated','locked'));
    `,
  },
  // 014: 策划工作台 — 可编辑的逐章章纲
  {
    version: 14,
    sql: `
      ALTER TABLE planning_ideas ADD COLUMN chapter_outlines TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE planning_ideas ADD COLUMN chapter_outline_status TEXT NOT NULL DEFAULT 'empty'
        CHECK(chapter_outline_status IN ('empty','generated','locked'));
    `,
  },
  // 015: 正文章节关联创建时的章纲快照
  {
    version: 15,
    sql: `
      ALTER TABLE chapters ADD COLUMN planning_outline TEXT NOT NULL DEFAULT '';
    `,
  },
  // 016: 每个项目可选的 Obsidian 只读资料目录
  {
    version: 16,
    sql: `
      ALTER TABLE projects ADD COLUMN obsidian_path TEXT NOT NULL DEFAULT '';
    `,
  },
  // 017: AI 会话正式持久化与 localStorage 一次性迁移标记
  {
    version: 17,
    sql: `
      ALTER TABLE conversation_threads ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
      UPDATE conversation_threads SET updated_at = created_at WHERE updated_at = '';

      ALTER TABLE conversation_messages ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
      ALTER TABLE conversation_messages ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE conversation_messages ADD COLUMN context_type TEXT NOT NULL DEFAULT 'chat';
      UPDATE conversation_messages SET updated_at = timestamp WHERE updated_at = '';

      WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY thread_id ORDER BY timestamp, id) - 1 AS position
        FROM conversation_messages
      )
      UPDATE conversation_messages
      SET sort_order = (SELECT position FROM ranked WHERE ranked.id = conversation_messages.id);

      CREATE INDEX IF NOT EXISTS idx_conversation_threads_project
        ON conversation_threads(project_id, updated_at);
      CREATE INDEX IF NOT EXISTS idx_conversation_messages_thread_order
        ON conversation_messages(thread_id, sort_order);

      CREATE TABLE IF NOT EXISTS data_migration_state (
        project_id TEXT NOT NULL,
        migration_key TEXT NOT NULL,
        completed_at TEXT NOT NULL,
        PRIMARY KEY (project_id, migration_key),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
    `,
  },
  // 018: 创作决策确认账本及运行时投影来源
  {
    version: 18,
    sql: `
      CREATE TABLE creative_decisions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        source_thread_id TEXT,
        source_message_id TEXT,
        parent_decision_id TEXT,
        decision_type TEXT NOT NULL CHECK(decision_type IN (
          'story_fact','character_knowledge','narrative_hook','narrative_debt'
        )),
        title TEXT NOT NULL DEFAULT '',
        rationale TEXT NOT NULL DEFAULT '',
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN (
          'proposed','confirmed','rejected','superseded'
        )),
        created_at TEXT NOT NULL,
        confirmed_at TEXT,
        rejected_at TEXT,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (source_thread_id) REFERENCES conversation_threads(id) ON DELETE SET NULL,
        FOREIGN KEY (source_message_id) REFERENCES conversation_messages(id) ON DELETE SET NULL,
        FOREIGN KEY (parent_decision_id) REFERENCES creative_decisions(id) ON DELETE SET NULL
      );

      CREATE TABLE creative_decision_effects (
        id TEXT PRIMARY KEY,
        decision_id TEXT NOT NULL,
        target_table TEXT NOT NULL CHECK(target_table IN (
          'story_facts','character_knowledge','narrative_hooks','narrative_debts'
        )),
        target_id TEXT NOT NULL,
        operation TEXT NOT NULL CHECK(operation IN ('insert','update','supersede')),
        before_json TEXT,
        after_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (decision_id) REFERENCES creative_decisions(id) ON DELETE CASCADE
      );

      ALTER TABLE story_facts ADD COLUMN source_decision_id TEXT
        REFERENCES creative_decisions(id) ON DELETE SET NULL;
      ALTER TABLE story_facts ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'legacy'
        CHECK(source_kind IN ('legacy','chapter_extraction','author_decision'));

      ALTER TABLE character_knowledge ADD COLUMN source_decision_id TEXT
        REFERENCES creative_decisions(id) ON DELETE SET NULL;
      ALTER TABLE character_knowledge ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'legacy'
        CHECK(source_kind IN ('legacy','chapter_extraction','author_decision'));
      ALTER TABLE character_knowledge ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
        CHECK(status IN ('active','superseded'));
      ALTER TABLE character_knowledge ADD COLUMN superseded_by TEXT;

      ALTER TABLE narrative_hooks ADD COLUMN source_decision_id TEXT
        REFERENCES creative_decisions(id) ON DELETE SET NULL;
      ALTER TABLE narrative_debts ADD COLUMN source_decision_id TEXT
        REFERENCES creative_decisions(id) ON DELETE SET NULL;

      CREATE INDEX idx_creative_decisions_project_status
        ON creative_decisions(project_id, status);
      CREATE INDEX idx_creative_decisions_source_thread
        ON creative_decisions(source_thread_id);
      CREATE INDEX idx_creative_decisions_source_message
        ON creative_decisions(source_message_id);
      CREATE INDEX idx_creative_decisions_parent
        ON creative_decisions(parent_decision_id);
      CREATE INDEX idx_creative_decision_effects_decision
        ON creative_decision_effects(decision_id);
      CREATE INDEX idx_story_facts_source_decision
        ON story_facts(source_decision_id);
      CREATE INDEX idx_character_knowledge_source_decision
        ON character_knowledge(source_decision_id);
      CREATE INDEX idx_narrative_hooks_source_decision
        ON narrative_hooks(source_decision_id);
      CREATE INDEX idx_narrative_debts_source_decision
        ON narrative_debts(source_decision_id);
    `,
  },
  {
    version: 19,
    sql: `
      ALTER TABLE narrative_hooks ADD COLUMN subject TEXT NOT NULL DEFAULT '';
      ALTER TABLE narrative_debts ADD COLUMN subject TEXT NOT NULL DEFAULT '';
    `,
  },
  // 020: planning_ideas 一项目一行（去重 + 唯一索引）
  {
    version: 20,
    sql: `
      -- 每个 project_id 只留 updated_at 最新（并列时 id 最大）的一行，其余删除
      DELETE FROM planning_ideas
      WHERE id NOT IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY project_id ORDER BY updated_at DESC, id DESC
          ) AS rn
          FROM planning_ideas
        ) WHERE rn = 1
      );

      DROP INDEX IF EXISTS idx_planning_ideas_project;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_planning_ideas_project_id
        ON planning_ideas(project_id);
    `,
  },

  // 021: 叙事时间接入 — 转换日志、别名表（空）、章节墓碑、状态键、章纲稳定 id
  {
    version: 21,
    rebuildsWithFkOff: true,
    sql: `
      CREATE TABLE IF NOT EXISTS narrative_transitions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        target_table TEXT NOT NULL CHECK(target_table IN (
          'story_facts','character_knowledge','narrative_hooks','narrative_debts'
        )),
        target_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN (
          'created','superseded','resolved','paid','abandoned','waived','partially_resolved'
        )),
        at_chapter_id TEXT NOT NULL,
        at_chapter_ordinal INTEGER NOT NULL DEFAULT 0,
        transition_seq INTEGER NOT NULL DEFAULT 0,
        after_snapshot TEXT NOT NULL,
        decision_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_narrative_transitions_target
        ON narrative_transitions(project_id, target_table, target_id);
      CREATE INDEX IF NOT EXISTS idx_narrative_transitions_chapter
        ON narrative_transitions(project_id, at_chapter_id);
    `,
    after(db) {
      const hasTable = (name: string) => Boolean(
        db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name),
      );
      const columnNames = (table: string) => new Set(
        (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name),
      );
      const addColumnIfMissing = (table: string, column: string, ddl: string) => {
        if (!hasTable(table)) return;
        if (columnNames(table).has(column)) return;
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
      };

      if (hasTable('story_facts')) {
        addColumnIfMissing('story_facts', 'state_key', 'state_key TEXT');
        addColumnIfMissing('story_facts', 'state_key_version', 'state_key_version INTEGER NOT NULL DEFAULT 1');
        addColumnIfMissing('story_facts', 'archived', 'archived INTEGER NOT NULL DEFAULT 0');
        db.exec(`
          CREATE INDEX IF NOT EXISTS idx_story_facts_state_key
            ON story_facts(project_id, state_key) WHERE archived = 0;
          UPDATE story_facts SET archived = 1 WHERE fact_type = 'hook';
        `);
      }

      if (hasTable('chapters')) {
        addColumnIfMissing('chapters', 'deleted_at', 'deleted_at TEXT');
        addColumnIfMissing('chapters', 'deleted_sort_order', 'deleted_sort_order INTEGER');
        addColumnIfMissing('chapters', 'planning_outline_id', 'planning_outline_id TEXT');

        db.exec(`
          CREATE TABLE IF NOT EXISTS chapter_alias (
            from_chapter_id TEXT PRIMARY KEY,
            to_chapter_id TEXT NOT NULL,
            ordinal_offset INTEGER NOT NULL CHECK(ordinal_offset >= 0),
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (from_chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
            FOREIGN KEY (to_chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
          );
        `);

        // 完整章表才重建（使 sort_order 可空）；迁移桩仅有 id/project_id 时跳过
        const cols = columnNames('chapters');
        const canRebuild = ['title', 'content', 'status', 'word_count', 'sort_order', 'summary', 'planning_outline', 'created_at', 'updated_at']
          .every((c) => cols.has(c));
        if (canRebuild) {
          // FK 必须在本迁移事务开始前关闭；此处不可再 pragma 切换
          db.exec(`
            CREATE TABLE chapters_v21 (
              id TEXT PRIMARY KEY,
              project_id TEXT NOT NULL,
              title TEXT NOT NULL DEFAULT '未命名章节',
              content TEXT NOT NULL DEFAULT '',
              status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','final')),
              word_count INTEGER NOT NULL DEFAULT 0,
              sort_order INTEGER,
              summary TEXT NOT NULL DEFAULT '',
              planning_outline TEXT NOT NULL DEFAULT '',
              planning_outline_id TEXT,
              deleted_at TEXT,
              deleted_sort_order INTEGER,
              created_at TEXT NOT NULL DEFAULT (datetime('now')),
              updated_at TEXT NOT NULL DEFAULT (datetime('now')),
              FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            );
            INSERT INTO chapters_v21 (
              id, project_id, title, content, status, word_count, sort_order, summary,
              planning_outline, planning_outline_id, deleted_at, deleted_sort_order, created_at, updated_at
            )
            SELECT id, project_id, title, content, status, word_count, sort_order,
                   COALESCE(summary, ''), COALESCE(planning_outline, ''), planning_outline_id,
                   deleted_at, deleted_sort_order, created_at, updated_at
            FROM chapters;
            DROP TABLE chapters;
            ALTER TABLE chapters_v21 RENAME TO chapters;
            CREATE INDEX IF NOT EXISTS idx_chapters_project_active
              ON chapters(project_id, sort_order) WHERE deleted_at IS NULL;
          `);
        }
      }

      if (hasTable('planning_ideas') && columnNames('planning_ideas').has('chapter_outlines')) {
        backfillChapterOutlineIds(db);
      }
    },
  },
  // 022: AI 对话消息软删除列（应用层保证 deleted_at / deletion_batch_id 成对）
  {
    version: 22,
    sql: `
      ALTER TABLE conversation_messages ADD COLUMN deleted_at TEXT;
      ALTER TABLE conversation_messages ADD COLUMN deletion_batch_id TEXT;
      CREATE INDEX IF NOT EXISTS idx_conversation_messages_deletion_batch
        ON conversation_messages(deletion_batch_id);
    `,
  },
  // 023: 审稿版本账本（chapter-run 二期）—— 正文世代 + 审稿账本 + 修订提案
  {
    version: 23,
    sql: `
      ALTER TABLE chapters ADD COLUMN content_generation INTEGER NOT NULL DEFAULT 1;

      CREATE TABLE IF NOT EXISTS chapter_reviews (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        chapter_id TEXT NOT NULL,
        run_id TEXT,
        source_generation INTEGER NOT NULL,
        prompt_version TEXT NOT NULL,
        provider_name TEXT NOT NULL DEFAULT '',
        model_name TEXT NOT NULL DEFAULT '',
        execution_status TEXT NOT NULL CHECK(execution_status IN (
          'completed','failed','cancelled'
        )),
        quality_score REAL,
        coverage REAL NOT NULL DEFAULT 0 CHECK(coverage >= 0 AND coverage <= 1),
        gate_status TEXT NOT NULL CHECK(gate_status IN (
          'pass','blocked','inconclusive'
        )),
        delivery_status TEXT NOT NULL CHECK(delivery_status IN (
          'pass','revise','blocked','inconclusive'
        )),
        summary TEXT NOT NULL DEFAULT '',
        dimensions_json TEXT NOT NULL DEFAULT '[]',
        issues_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_chapter_reviews_chapter_created
        ON chapter_reviews(chapter_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS chapter_revision_proposals (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        chapter_id TEXT NOT NULL,
        review_id TEXT NOT NULL,
        source_generation INTEGER NOT NULL,
        proposed_content TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN (
          'proposed','applied','rejected','stale'
        )),
        applied_generation INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        applied_at TEXT,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
        FOREIGN KEY (review_id) REFERENCES chapter_reviews(id) ON DELETE CASCADE
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_chapter_revision_one_pending
        ON chapter_revision_proposals(chapter_id)
        WHERE status = 'proposed';
    `,
  },
];

/** 为 planning_ideas.chapter_outlines JSON 中缺 id 的项补 UUID（同事务调用） */
export function backfillChapterOutlineIds(db: Database.Database): void {
  const rows = db.prepare(
    `SELECT id, chapter_outlines FROM planning_ideas WHERE chapter_outlines IS NOT NULL AND chapter_outlines != ''`,
  ).all() as Array<{ id: string; chapter_outlines: string }>;

  const update = db.prepare(`UPDATE planning_ideas SET chapter_outlines = ? WHERE id = ?`);
  for (const row of rows) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.chapter_outlines);
    } catch {
      continue;
    }
    if (!Array.isArray(parsed)) continue;
    let changed = false;
    const next = parsed.map((item) => {
      if (!item || typeof item !== 'object') return item;
      const outline = item as Record<string, unknown>;
      if (typeof outline.id === 'string' && outline.id.length > 0) return outline;
      changed = true;
      return { ...outline, id: randomUUID() };
    });
    if (changed) update.run(JSON.stringify(next), row.id);
  }
}

export function runMigrations(db: Database.Database, untilVersion?: number): void {
  // 确保迁移表存在
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set(
    db.prepare('SELECT version FROM _migrations').all()
      .map((row: unknown) => (row as { version: number }).version)
  );

  const cap = untilVersion ?? Number.POSITIVE_INFINITY;
  for (const migration of MIGRATIONS) {
    if (migration.version > cap) continue;
    if (!applied.has(migration.version)) {
      const needFkOff = !!migration.rebuildsWithFkOff;
      const fkWasOn = db.pragma('foreign_keys', { simple: true }) === 1;
      if (needFkOff) db.pragma('foreign_keys = OFF');
      try {
        db.transaction(() => {
          db.exec(migration.sql);
          migration.after?.(db);
          const violations = db.pragma('foreign_key_check') as unknown[];
          if (violations.length > 0) {
            throw new Error(`迁移 v${migration.version} 外键检查失败: ${JSON.stringify(violations)}`);
          }
          db.prepare('INSERT INTO _migrations (version) VALUES (?)').run(migration.version);
        })();
      } finally {
        if (needFkOff && fkWasOn) db.pragma('foreign_keys = ON');
      }
      console.log(`Migration v${migration.version} applied.`);
    }
  }
}

export function getLatestMigrationVersion(): number {
  return MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 0);
}
