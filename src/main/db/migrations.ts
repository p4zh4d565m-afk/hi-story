import Database from 'better-sqlite3';

const MIGRATIONS = [
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
];

export function runMigrations(db: Database.Database): void {
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

  for (const migration of MIGRATIONS) {
    if (!applied.has(migration.version)) {
      db.exec(migration.sql);
      db.prepare('INSERT INTO _migrations (version) VALUES (?)').run(migration.version);
      console.log(`Migration v${migration.version} applied.`);
    }
  }
}
