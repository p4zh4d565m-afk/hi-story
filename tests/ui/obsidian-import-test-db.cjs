const Database = require('better-sqlite3');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runMigrations } = require('../../dist/main/main/db/migrations');
const { ObsidianImportRepo } = require('../../dist/main/main/db/repositories/obsidian-import.repo');
const { PlanningRepo } = require('../../dist/main/main/db/repositories/planning.repo');

// 为 obsidian 导入真实 UI 回归提供内存数据库 + 主进程侧仓储 + 真实临时 Obsidian 目录。
// 支持多场景 fixture、三层 JSON 快照、commit/reparse 调用计数、可控延迟。
module.exports = function registerObsidianImportTestDb(ipcMain) {
  let db;
  let repo;
  let vault;
  let commitCalls = 0;
  let reparseCalls = 0;
  let reparseDelayMs = 0;
  let commitDelayMs = 0;
  let currentScenario = '';
  let failNextReparse = false;  // 控制下一次 reparse 返回失败，用于验证失败重试闭环
  let failNextPlanningRefresh = false;  // 控制下一次策划刷新返回失败（R1 集成测试）
  let failNextEntityRefresh = false;    // 控制下一次人物/世界观刷新返回失败（R1 集成测试）
  let refreshDelayMs = 0;               // 策划/实体刷新的可控延迟（并发门禁测试）
  let planningRefreshCalls = 0;
  let entityRefreshCalls = 0;           // 人物/世界观刷新调用次数（一次 onRefreshImportedEntities = 2 次 IPC）

  const write = (rel, content) => {
    const f = path.join(vault, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, content);
  };

  const seedPlanning = (over = {}) => {
    const master = over.master ?? '';
    const masterStatus = over.masterStatus ?? 'empty';
    const volumes = over.volumes ?? '[]';
    const volumeStatus = over.volumeStatus ?? 'empty';
    const chapters = over.chapters ?? '[]';
    const chapterStatus = over.chapterStatus ?? 'empty';
    const status = over.status ?? 'confirmed';
    const selectedOption = over.selectedOption ?? null;
    db.prepare(`INSERT INTO planning_ideas (id, project_id, generated_options, selected_option, status, master_outline, outline_status, volume_outlines, volume_status, chapter_outlines, chapter_outline_status)
      VALUES ('pl1','project-a','[]',?,?,?,?,?,?,?,?)`)
      .run(selectedOption, status, master, masterStatus, volumes, volumeStatus, chapters, chapterStatus);
  };

  // 场景化 fixture
  const setupFixture = (scenario) => {
    // 基础五类源文件（各场景按需写）
    const base = () => {
      write('完整大纲.md', [
        '# 完整大纲',
        '## 一、作品定位',
        '- 类型：BL',
        '- 结局：开放式结局',
        '完整设定：沈屿伪装沈悦接近陆昭，展开一段错位复仇。',
        '## 二、三卷大纲索引',
        '1. [卷 1 陆昭线（第 1-50 章）](卷1.md)',
      ].join('\n'));
      write('大纲_卷1.md', [
        '# 卷 1 陆昭线（第 1-50 章）',
        '## 核心冲突',
        '沈屿伪装沈悦接近陆昭。',
        '## 阶段拆解',
        '- 第 1-15 章：黄金三章',
      ].join('\n'));
      write('章节细纲.md', [
        '## 卷 1（第 1-50 章）',
        '| 章 | 标题 | 核心事件 |',
        '|---|---|---|',
        '| 1 | 初见 | 游轮宴会。 |',
        '| 2 | 对峙 | 身份暴露。 |',
      ].join('\n'));
      write('人物/沈屿.md', [
        '# 沈屿',
        '## 性格层次',
        '- 表面：高智商。',
      ].join('\n'));
      write('世界观/主要场景.md', [
        '---',
        'category: place',
        '---',
        '# 主要场景',
        '## 星海游轮',
        '- 第一卷开场地点。',
      ].join('\n'));
    };

    if (scenario === 'basic') {
      base();
    } else if (scenario === 'locked') {
      // 预置 locked 总纲 + locked 分卷 + 空章纲，源文件提供 master 供 replace
      seedPlanning({
        master: '{"premise":"旧前提"}', masterStatus: 'locked',
        volumes: '[{"title":"旧卷","chapterRange":"第 1-10 章"}]', volumeStatus: 'locked',
        chapters: '[]', chapterStatus: 'empty', status: 'confirmed', selectedOption: 0,
      });
      write('完整大纲.md', ['# 完整大纲', '## 一、作品定位', '- 类型：BL', '- 结局：新结局'].join('\n'));
    } else if (scenario === 'no-category-world') {
      // 世界观无 frontmatter category，要求 DOM 手动选分类
      write('完整大纲.md', ['# 完整大纲', '## 一、作品定位', '- 类型：BL'].join('\n'));
      write('世界观/无分类场景.md', ['# 无分类场景', '## 某地', '- 描述。'].join('\n'));
    } else if (scenario === 'upstream-conflict') {
      // 数据库已有分卷（generated），源文件有 master；用于「替换总纲但分卷 keep」非法组合
      seedPlanning({
        master: '{"premise":"旧"}', masterStatus: 'generated',
        volumes: '[{"title":"旧卷","chapterRange":"第 1-10 章"}]', volumeStatus: 'generated',
        chapters: '[]', chapterStatus: 'empty', status: 'confirmed', selectedOption: 0,
      });
      write('完整大纲.md', ['# 完整大纲', '## 一、作品定位', '- 类型：BL'].join('\n'));
    } else if (scenario === 'overwrite') {
      // 数据库预置同名人物（带 profileOutline），源文件同名，用于覆盖保留 id 测试（单候选，默认选中+查看）
      db.prepare(`INSERT INTO characters (id, project_id, name, aliases, appearance, personality, background, arc, profile_outline, sort_order, created_at, updated_at)
        VALUES ('c1','project-a','沈屿','','','','','','[{"id":"node-a"}]',0,'t','t')`).run();
      write('人物/沈屿.md', ['# 沈屿', '## 性格层次', '- 表面：高智商。'].join('\n'));
    } else if (scenario === 'overwrite-world') {
      // 数据库预置同名世界观（带 parentId），源文件同名，用于覆盖保留 id 测试（单候选）
      db.prepare(`INSERT INTO world_entries (id, project_id, parent_id, category, name, description, sort_order, created_at, updated_at)
        VALUES ('parent-w','project-a',NULL,'place','父场景','父描述',0,'t','t')`).run();
      db.prepare(`INSERT INTO world_entries (id, project_id, parent_id, category, name, description, sort_order, created_at, updated_at)
        VALUES ('w1','project-a','parent-w','place','主要场景','旧描述',1,'t','t')`).run();
      write('世界观/主要场景.md', ['---', 'category: place', '---', '# 主要场景', '## 星海游轮', '- 新描述。'].join('\n'));
    } else if (scenario === 'two-volumes') {
      // 两个卷 + 章纲表格不含卷标题（volumeIndex=null），用于手动选择卷归属
      write('完整大纲.md', ['# 完整大纲', '## 一、作品定位', '- 类型：BL', '完整设定：设定。'].join('\n'));
      write('大纲_卷1.md', ['# 卷 1（第 1-10 章）', '## 本卷目标', '开端'].join('\n'));
      write('大纲_卷2.md', ['# 卷 2（第 11-20 章）', '## 本卷目标', '发展'].join('\n'));
      write('章节细纲.md', ['| 章 | 标题 | 核心事件 |', '|---|---|---|', '| 1 | 起点 | 开场。 |', '| 2 | 转折 | 冲突。 |'].join('\n'));
    } else if (scenario === 'many-chapters') {
      // 60 章 + 1 卷，用于分页预览到达最后一条
      write('完整大纲.md', ['# 完整大纲', '## 一、作品定位', '- 类型：BL', '完整设定：设定。'].join('\n'));
      write('大纲_卷1.md', ['# 卷 1（第 1-60 章）', '## 本卷目标', '开端'].join('\n'));
      const rows = ['| 章 | 标题 | 核心事件 |', '|---|---|---|'];
      for (let i = 1; i <= 60; i++) rows.push(`| ${i} | 第${i}章 | 事件${i}。 |`);
      write('章节细纲.md', rows.join('\n'));
    } else if (scenario === 'stage') {
      // 预置总纲 + 2 卷（generated），源文件只有阶段文件（卷一目录下）。
      // 用于「勾阶段 + keep 分卷」归堆断言：阶段 overlay 到已有卷，不改卷字段。
      seedPlanning({
        master: '{"premise":"旧前提"}', masterStatus: 'generated',
        volumes: '[{"title":"数据库卷A","chapterRange":"第 1-10 章"},{"title":"数据库卷B","chapterRange":"第 11-20 章"}]', volumeStatus: 'generated',
        chapters: '[]', chapterStatus: 'empty', status: 'confirmed', selectedOption: 0,
      });
      write('分卷大纲/卷一/阶段1.md', ['# 阶段1：订婚与身份暴露（第1—5章）', '## 这一阶段做什么', '订婚。', '## 关键推进', '- a', '## 主要人物', '- b', '## 调用的世界观', '- c', '## 阶段出口', '出口。'].join('\n'));
      write('分卷大纲/卷一/阶段2.md', ['# 阶段2：绑架与逃离（第6—10章）', '## 这一阶段做什么', '逃离。', '## 关键推进', '- d', '## 主要人物', '- e', '## 调用的世界观', '- f', '## 阶段出口', '出口2。'].join('\n'));
    } else if (scenario === 'stage-locked') {
      // 与 stage 相同，但分卷纲 volumeStatus = locked：用于「锁定分卷 + keep + 勾阶段 → 解锁勾选可见」断言
      seedPlanning({
        master: '{"premise":"旧前提"}', masterStatus: 'generated',
        volumes: '[{"title":"数据库卷A","chapterRange":"第 1-10 章"},{"title":"数据库卷B","chapterRange":"第 11-20 章"}]', volumeStatus: 'locked',
        chapters: '[]', chapterStatus: 'empty', status: 'confirmed', selectedOption: 0,
      });
      write('分卷大纲/卷一/阶段1.md', ['# 阶段1：订婚与身份暴露（第1—5章）', '## 这一阶段做什么', '订婚。', '## 关键推进', '- a', '## 主要人物', '- b', '## 调用的世界观', '- c', '## 阶段出口', '出口。'].join('\n'));
    } else if (scenario === 'stage-planning-render') {
      // 策划页可渲染的完整总纲 + 带 stages 的分卷：用于「改总纲清空阶段提示」断言。
      // master_outline 必须含 phases 数组（PlanningWorkspace 会 masterOutline.phases.map）。
      seedPlanning({
        master: JSON.stringify({
          premise: '核心前提', ending: '结局', protagonistArc: '人物弧', centralConflict: '冲突',
          structureModel: '结构', phases: [{ title: '阶段1', purpose: '目的', chapterRange: '第 1-10 章', keyEvents: ['事件'], turningPoint: '转折', emotionTrend: '趋势' }],
          subplots: ['副线'], storyPromises: ['承诺'],
        }), masterStatus: 'generated',
        volumes: JSON.stringify([{
          title: '数据库卷A', chapterRange: '第 1-10 章', volumeGoal: '目标', openingState: '起态',
          mainProgression: '主线', characterProgression: '人物', keyEvents: ['事件'], climax: '高潮', endingState: '终态',
          promisesOpened: [], promisesPaid: [],
          stages: [{ title: '阶段1', chapterRange: '第 1-5 章', goal: '目标', keyProgressions: ['推进'], characters: [], worldRefs: [], exit: '出口', endingHook: '' }],
        }]), volumeStatus: 'generated',
        chapters: '[]', chapterStatus: 'empty', status: 'confirmed', selectedOption: 0,
      });
    } else if (scenario === 'stage-planning-no-stages') {
      // 同上但分卷无 stages：用于「改总纲无 stages 不提示」回归断言。
      seedPlanning({
        master: JSON.stringify({
          premise: '核心前提', ending: '结局', protagonistArc: '人物弧', centralConflict: '冲突',
          structureModel: '结构', phases: [{ title: '阶段1', purpose: '目的', chapterRange: '第 1-10 章', keyEvents: ['事件'], turningPoint: '转折', emotionTrend: '趋势' }],
          subplots: ['副线'], storyPromises: ['承诺'],
        }), masterStatus: 'generated',
        volumes: JSON.stringify([{
          title: '数据库卷A', chapterRange: '第 1-10 章', volumeGoal: '目标', openingState: '起态',
          mainProgression: '主线', characterProgression: '人物', keyEvents: ['事件'], climax: '高潮', endingState: '终态',
          promisesOpened: [], promisesPaid: [],
        }]), volumeStatus: 'generated',
        chapters: '[]', chapterStatus: 'empty', status: 'confirmed', selectedOption: 0,
      });
    } else {
      base();
    }
  };

  ipcMain.handle('test:obsidian-import-db', async (_event, channel, ...args) => {
    if (channel === 'reset') {
      if (db) db.close();
      if (vault) fs.rmSync(vault, { recursive: true, force: true });
      db = new Database(':memory:');
      db.pragma('foreign_keys = ON');
      runMigrations(db);
      db.exec(`INSERT INTO projects(id,name,created_at,updated_at) VALUES ('project-a','测试项目','t','t');`);
      vault = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-import-ui-'));
      currentScenario = args[0] ?? 'basic';
      commitCalls = 0;
      reparseCalls = 0;
      reparseDelayMs = 0;
      commitDelayMs = 0;
      failNextReparse = false;
      failNextPlanningRefresh = false;
      failNextEntityRefresh = false;
      refreshDelayMs = 0;
      planningRefreshCalls = 0;
      entityRefreshCalls = 0;
      setupFixture(currentScenario);
      db.prepare('UPDATE projects SET obsidian_path = ? WHERE id = ?').run(vault, 'project-a');
      repo = new ObsidianImportRepo(db);
      return { success: true, scenario: currentScenario };
    }
    if (channel === 'snapshot') {
      const rows = db.prepare('SELECT * FROM planning_ideas').all();
      return {
        planning: rows,
        // 三层 JSON 解析快照
        masterOutlines: rows.map(r => (r.master_outline ? JSON.parse(r.master_outline) : null)),
        volumeOutlines: rows.map(r => (r.volume_outlines ? JSON.parse(r.volume_outlines) : [])),
        chapterOutlines: rows.map(r => (r.chapter_outlines ? JSON.parse(r.chapter_outlines) : [])),
        characters: db.prepare('SELECT * FROM characters ORDER BY id').all(),
        worlds: db.prepare('SELECT * FROM world_entries ORDER BY id').all(),
      };
    }
    if (channel === 'counts') {
      return { commitCalls, reparseCalls, planningRefreshCalls, entityRefreshCalls };
    }
    if (channel === 'setDelays') {
      reparseDelayMs = args[0]?.reparse ?? 0;
      commitDelayMs = args[0]?.commit ?? 0;
      refreshDelayMs = args[0]?.refresh ?? 0;
      return { success: true };
    }
    if (channel === 'failNextReparse') {
      failNextReparse = true;
      return { success: true };
    }
    if (channel === 'failNextPlanningRefresh') {
      failNextPlanningRefresh = true;
      return { success: true };
    }
    if (channel === 'failNextEntityRefresh') {
      failNextEntityRefresh = true;
      return { success: true };
    }
    if (channel === 'prepare' || channel === 'obsidian:preparePlanningImport') return repo.prepare(args[0]);
    if (channel === 'reparse' || channel === 'obsidian:reparsePlanningImport') {
      reparseCalls++;
      if (reparseDelayMs) await new Promise(res => setTimeout(res, reparseDelayMs));
      if (failNextReparse) { failNextReparse = false; return { success: false, error: '模拟 reparse 失败' }; }
      return repo.reparse(args[0]);
    }
    if (channel === 'commit' || channel === 'obsidian:commitPlanningImport') {
      commitCalls++;
      if (commitDelayMs) await new Promise(res => setTimeout(res, commitDelayMs));
      return repo.commit(args[0]);
    }
    if (channel === 'db:planning:findByProject') {
      planningRefreshCalls++;
      if (refreshDelayMs) await new Promise(res => setTimeout(res, refreshDelayMs));
      // R1 集成测试：可控让策划刷新失败一次，验证面板停留 refreshPending
      if (failNextPlanningRefresh) { failNextPlanningRefresh = false; return { success: false, error: '模拟策划刷新失败' }; }
      return new PlanningRepo(db).findByProject(args[0]);
    }
    if (channel === 'db:character:findByProject') {
      entityRefreshCalls++;
      if (refreshDelayMs) await new Promise(res => setTimeout(res, refreshDelayMs));
      // 消费一次失败标记：人物通道失败即让整个实体刷新返回 false（world 通道不受影响）
      if (failNextEntityRefresh) { failNextEntityRefresh = false; return { success: false, error: '模拟实体刷新失败' }; }
      return { success: true, data: db.prepare('SELECT * FROM characters WHERE project_id = ? ORDER BY sort_order ASC').all(args[0]) };
    }
    if (channel === 'db:worldEntry:findByProject') {
      if (refreshDelayMs) await new Promise(res => setTimeout(res, refreshDelayMs));
      return { success: true, data: db.prepare('SELECT * FROM world_entries WHERE project_id = ? ORDER BY sort_order ASC').all(args[0]) };
    }
    throw new Error('未知测试请求: ' + channel);
  });
};
