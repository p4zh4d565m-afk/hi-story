/**
 * 可见 UI 联合验收：真实窗口点击，不调用 electronAPI.invoke 代替界面。
 * 隔离 userData，不打开、不写入生活库。
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const LIVE_USER_DATA = path.join(os.homedir(), 'AppData', 'Roaming', 'hi-story');
const LIVE_DB = path.join(LIVE_USER_DATA, 'hi-story.db');
const WORK = path.join(os.tmpdir(), 'hi-story-ui-admission');
const ISOLATED = path.join(WORK, 'user-data');
const VAULT_SRC = 'D:\\obsidian\\我的基础库\\02 项目\\我有一个妹妹';
const VAULT_COPY = path.join(WORK, 'obsidian-copy');
const STATE_PATH = path.join(WORK, 'ui-admission-state.json');
const LOG_PATH = path.join(WORK, 'ui-admission.log');
const SHOTS = path.join(WORK, 'screenshots');
const ELECTRON_EXE = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const TEST_PROJECT = '我有一个妹妹';
const IMPORT_PROJECT = 'UI验收-Obsidian导入';
const MARK = {
  write: '青梧驿站',
  revise: '修订印记：赤铜铃',
  chatA: '对话印记甲',
  chatB: '对话印记乙',
  chatC: '对话印记丙',
};

function log(line) {
  const s = `[${new Date().toISOString()}] ${line}`;
  console.log(s);
  fs.mkdirSync(WORK, { recursive: true });
  fs.appendFileSync(LOG_PATH, s + '\n');
}

function readState() {
  if (!fs.existsSync(STATE_PATH)) return {};
  return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
}

function writeState(patch) {
  const next = { ...readState(), ...patch, updatedAt: new Date().toISOString() };
  fs.writeFileSync(STATE_PATH, JSON.stringify(next, null, 2));
  return next;
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function fileMeta(file) {
  if (!fs.existsSync(file)) return null;
  const st = fs.statSync(file);
  return { path: file, bytes: st.size, mtimeMs: st.mtimeMs, sha256: sha256File(file) };
}

function hashVault(rootDir) {
  const files = [];
  function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.isFile() && ent.name.toLowerCase().endsWith('.md')) {
        const rel = path.relative(rootDir, full).replace(/\\/g, '/');
        const buf = fs.readFileSync(full);
        files.push({
          rel,
          sha256: crypto.createHash('sha256').update(buf).digest('hex'),
          bytes: buf.length,
        });
      }
    }
  }
  walk(rootDir);
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  return files;
}

function hashesEqual(a, b) {
  if (a.length !== b.length) return false;
  return a.every((x, i) => x.rel === b[i].rel && x.sha256 === b[i].sha256);
}

function prepareIsolated() {
  fs.rmSync(ISOLATED, { recursive: true, force: true });
  fs.rmSync(VAULT_COPY, { recursive: true, force: true });
  fs.mkdirSync(ISOLATED, { recursive: true });
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.copyFileSync(LIVE_DB, path.join(ISOLATED, 'hi-story.db'));
  for (const extra of ['hi-story.db-wal', 'hi-story.db-shm']) {
    const src = path.join(LIVE_USER_DATA, extra);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(ISOLATED, extra));
  }
  for (const name of ['Local Storage', 'Session Storage']) {
    const src = path.join(LIVE_USER_DATA, name);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(ISOLATED, name), { recursive: true });
  }
  for (const name of ['Local State', 'Preferences']) {
    const src = path.join(LIVE_USER_DATA, name);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(ISOLATED, name));
  }
  const dataDir = path.join(LIVE_USER_DATA, 'data');
  if (fs.existsSync(dataDir)) fs.cpSync(dataDir, path.join(ISOLATED, 'data'), { recursive: true });
  fs.cpSync(VAULT_SRC, VAULT_COPY, { recursive: true });
  const vaultHashes = hashVault(VAULT_SRC);
  const live = fileMeta(LIVE_DB);
  writeState({
    liveBefore: live,
    vaultBefore: vaultHashes,
    isolatedDb: path.join(ISOLATED, 'hi-story.db'),
    vaultCopy: VAULT_COPY,
  });
  return vaultHashes.length;
}

function spawnElectron(phase) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    env.HI_STORY_USER_DATA = ISOLATED;
    env.HI_STORY_UI_PHASE = String(phase);
    env.HI_STORY_WORK = WORK;
    env.NODE_ENV = 'production';
    const child = spawn(ELECTRON_EXE, [__filename], {
      cwd: ROOT,
      env,
      windowsHide: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', d => {
      const s = d.toString();
      process.stdout.write(s);
      fs.appendFileSync(LOG_PATH, s);
    });
    child.stderr.on('data', d => {
      const s = d.toString();
      process.stderr.write(s);
      fs.appendFileSync(LOG_PATH, s);
    });
    child.on('error', reject);
    child.on('exit', code => resolve({ code: code ?? 1 }));
  });
}

function sqliteQuery(sql) {
  const code = `
    const Database = require(${JSON.stringify(path.join(ROOT, 'node_modules/better-sqlite3'))});
    const db = new Database(${JSON.stringify(path.join(ISOLATED, 'hi-story.db'))}, { readonly: true, fileMustExist: true });
    db.pragma('busy_timeout = 5000');
    const sql = ${JSON.stringify(sql)};
    const rows = db.prepare(sql).all();
    process.stdout.write(JSON.stringify(rows));
    db.close();
  `;
  const r = spawnSync(ELECTRON_EXE, ['-e', code], {
    cwd: ROOT,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
    timeout: 30000,
  });
  if (r.status !== 0) {
    throw new Error(`sqlite 查询失败: ${(r.stderr || r.stdout || '').slice(0, 800)}`);
  }
  return JSON.parse(r.stdout || '[]');
}

const HELPERS = `(() => {
  const norm = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
  const visible = (el) => {
    if (!el) return false;
    const st = window.getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const setValue = (el, value) => {
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    desc.set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  window.__ui = {
    body: () => document.body ? document.body.innerText.slice(0, 8000) : '',
    hasText: (t) => (document.body?.innerText || '').includes(t),
    buttons: () => [...document.querySelectorAll('button')].filter(visible).map(b => ({
      text: norm(b.textContent), disabled: b.disabled,
    })),
    clickExact: (text) => {
      const want = norm(text);
      const btn = [...document.querySelectorAll('button')].find(b => visible(b) && norm(b.textContent) === want);
      if (!btn) return { ok: false, reason: 'not-found' };
      if (btn.disabled) return { ok: false, reason: 'disabled' };
      btn.click();
      return { ok: true };
    },
    clickContains: (text) => {
      const btn = [...document.querySelectorAll('button')].find(b => visible(b) && !b.disabled && norm(b.textContent).includes(text));
      if (!btn) return { ok: false, reason: 'not-found' };
      btn.click();
      return { ok: true, text: norm(btn.textContent) };
    },
    ensureCandidateOpen: (name) => {
      const want = norm(name);
      const span = [...document.querySelectorAll('span')].find(s => visible(s) && norm(s.textContent) === want);
      if (!span) return { ok: false, reason: 'not-found' };
      const label = span.closest('label');
      const input = label ? label.querySelector('input[type="checkbox"]') : null;
      span.click();
      if (input && !input.checked) input.click();
      return { ok: true, checked: input ? !!input.checked : null };
    },
    countText: (t) => (document.body.innerText.split(t).length - 1),
    blockReasons: () => [...document.querySelectorAll('p')].filter(p => (p.textContent || '').includes('⛔')).map(p => p.textContent.trim()),
    fixVisibleImportSelects: () => {
      const changed = [];
      for (const sel of document.querySelectorAll('select')) {
        if (!visible(sel)) continue;
        const opts = [...sel.options];
        const place = opts.find(o => o.value === 'place' || o.text === '地点');
        if (place && !sel.value) {
          sel.value = place.value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          changed.push('category:' + place.value);
        }
        const vol = opts.find(o => o.value === '0' || /^第\\s*1\\s*卷/.test(o.text));
        const emptyVol = opts.some(o => o.text.includes('选择卷'));
        if (emptyVol && vol && (sel.value === '' || sel.value == null)) {
          sel.value = vol.value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          changed.push('volume:' + vol.value);
        }
      }
      return { changed };
    },
    clickSidebarName: (name) => {
      const span = [...document.querySelectorAll('span')].find(s => visible(s) && norm(s.textContent) === name);
      if (!span) return { ok: false, reason: 'not-found' };
      const hit = span.closest('.cursor-pointer') || span.parentElement;
      (hit || span).click();
      return { ok: true };
    },
    chapterTitles: () => {
      const header = [...document.querySelectorAll('span')].find(s => norm(s.textContent) === '章节');
      if (!header) return [];
      const root = header.closest('.py-1') || header.parentElement?.parentElement;
      return [...(root || document).querySelectorAll('span.flex-1.truncate')].map(s => norm(s.textContent)).filter(Boolean);
    },
    clickChapter: (title) => {
      const header = [...document.querySelectorAll('span')].find(s => norm(s.textContent) === '章节');
      const root = header ? (header.closest('.py-1') || header.parentElement?.parentElement) : document;
      const span = [...root.querySelectorAll('span.flex-1.truncate')].find(s => norm(s.textContent) === title);
      if (!span) return { ok: false, reason: 'not-found' };
      const hit = span.closest('.cursor-pointer') || span.parentElement;
      (hit || span).click();
      return { ok: true };
    },
    fillPlaceholder: (hint, value) => {
      const el = [...document.querySelectorAll('input,textarea')].find(e => visible(e) && String(e.placeholder || '').includes(hint));
      if (!el) return { ok: false, reason: 'not-found' };
      setValue(el, value);
      return { ok: true, tag: el.tagName };
    },
    fillByLabel: (labelText, value) => {
      const label = [...document.querySelectorAll('label')].find(l => visible(l) && norm(l.textContent).includes(labelText));
      if (!label) return { ok: false, reason: 'not-found' };
      const el = label.querySelector('input,textarea,select') || label.parentElement.querySelector('input,textarea,select');
      if (!el) return { ok: false, reason: 'no-control' };
      if (el.tagName === 'SELECT') {
        el.value = value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else setValue(el, value);
      return { ok: true, tag: el.tagName };
    },
    selectOptionByLabel: (labelText, matcher) => {
      const label = [...document.querySelectorAll('label')].find(l => visible(l) && norm(l.textContent).includes(labelText));
      if (!label) return { ok: false, reason: 'not-found' };
      const sel = label.parentElement.querySelector('select');
      if (!sel) return { ok: false, reason: 'no-select' };
      const opt = [...sel.options].find(o => matcher(o.text, o.value));
      if (!opt) return { ok: false, reason: 'no-option', options: [...sel.options].map(o => o.text) };
      sel.value = opt.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, text: opt.text, value: opt.value };
    },
    setLayerFill: () => {
      const changed = [];
      for (const sel of document.querySelectorAll('select')) {
        if (!visible(sel)) continue;
        const texts = [...sel.options].map(o => o.text).join(' ');
        if (!/总纲|分卷纲|章纲/.test(texts)) continue;
        const fill = [...sel.options].find(o => o.value === 'fill' || o.text.includes('填空'));
        if (!fill) continue;
        sel.value = fill.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        changed.push(fill.text);
      }
      return { ok: changed.length > 0, changed };
    },
    previewStats: () => {
      const text = document.body.innerText;
      const m = text.match(/候选文件（(\\d+)）/);
      const plan = text.match(/预计：新建\\s*(\\d+)\\s*·\\s*覆盖\\s*(\\d+)\\s*·\\s*跳过\\s*(\\d+)/);
      return {
        hasPanel: text.includes('从 Obsidian 导入') || text.includes('候选文件'),
        candidateCount: m ? Number(m[1]) : 0,
        plan: plan ? { create: Number(plan[1]), update: Number(plan[2]), skip: Number(plan[3]) } : null,
        hasMaster: text.includes('总纲'),
        hasVolume: text.includes('分卷纲'),
        hasChapter: text.includes('章纲'),
      };
    },
    lastDeleteTurn: () => {
      const btns = [...document.querySelectorAll('button')].filter(b => visible(b) && !b.disabled && norm(b.textContent) === '删除本轮');
      if (!btns.length) return { ok: false, reason: 'not-found', count: 0 };
      btns[btns.length - 1].click();
      return { ok: true, count: btns.length };
    },
    closeNearest: (title) => {
      const span = [...document.querySelectorAll('span,h2,h3')].find(s => visible(s) && norm(s.textContent).includes(title));
      if (!span) return { ok: false, reason: 'not-found' };
      const panel = span.closest('.pointer-events-auto') || span.closest('.fixed') || span.parentElement?.parentElement;
      const btn = [...(panel || document).querySelectorAll('button')].find(b => visible(b) && (norm(b.textContent) === '✕' || norm(b.textContent) === '×'));
      if (!btn) return { ok: false, reason: 'no-close' };
      btn.click();
      return { ok: true };
    },
    editorText: () => {
      const pm = document.querySelector('.ProseMirror');
      return pm ? norm(pm.innerText) : '';
    },
    blockLines: () => [...document.querySelectorAll('p,div,span')].filter(e => visible(e) && (e.textContent || '').includes('⛔')).map(e => norm(e.textContent)).slice(0, 20),
    clickNamedSpan: (name) => {
      const span = [...document.querySelectorAll('span')].find(s => visible(s) && norm(s.textContent) === name);
      if (!span) return { ok: false, reason: 'not-found' };
      span.click();
      return { ok: true };
    },
    setVisibleSelectValue: (optionHint, value) => {
      const sel = [...document.querySelectorAll('select')].find(s => visible(s) && [...s.options].some(o => o.text.includes(optionHint) || o.value === value));
      if (!sel) return { ok: false, reason: 'not-found' };
      const opt = [...sel.options].find(o => o.value === value || o.text.includes(optionHint));
      if (!opt) return { ok: false, reason: 'no-option' };
      sel.value = opt.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, text: opt.text, value: sel.value };
    },
    countText: (t) => (document.body.innerText.split(t).length - 1),
    confirmTrue: () => { window.confirm = () => true; window.alert = () => {}; return true; },
  };
  window.__ui.confirmTrue();
  return true;
})()`;

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function waitWin(BrowserWindow, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const wins = BrowserWindow.getAllWindows().filter(w => !w.isDestroyed());
    if (wins.length) return wins[0];
    await sleep(200);
  }
  throw new Error('等待主窗口超时');
}

async function shot(win, name) {
  try {
    const img = await win.capturePage();
    fs.writeFileSync(path.join(SHOTS, `${name}.png`), img.toPNG());
    log(`截图 ${name}.png`);
  } catch (e) {
    log(`截图失败 ${name}: ${e.message}`);
  }
}

async function js(win, code) {
  return win.webContents.executeJavaScript(code, true);
}

async function waitUntil(win, fnSrc, timeout, label) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeout) {
    last = await js(win, `(${fnSrc})()`);
    if (last) return last;
    await sleep(400);
  }
  const body = await js(win, 'window.__ui ? window.__ui.body() : document.body.innerText.slice(0,4000)');
  throw new Error(`${label} 超时。界面摘录: ${String(body).slice(0, 1200)}`);
}

async function clickWait(win, text, timeout = 15000) {
  await waitUntil(win, `() => { const r = window.__ui.clickExact(${JSON.stringify(text)}); return r.ok ? r : null; }`, timeout, `点击「${text}」`);
}

async function ensureHelpers(win) {
  await js(win, HELPERS);
}

async function runPhase(phase, win, app) {
  await ensureHelpers(win);
  if (phase === 1) return runPhaseWrite(win, app);
  if (phase === 2) return runPhaseAfterRestart(win, app);
  throw new Error('未知阶段 ' + phase);
}

async function selectProject(win, name) {
  await waitUntil(win, `() => window.__ui.hasText(${JSON.stringify(name)})`, 45000, `等待项目 ${name}`);
  const clicked = await js(win, `window.__ui.clickSidebarName(${JSON.stringify(name)})`);
  if (!clicked?.ok) throw new Error(`未能点击项目 ${name}`);
  await sleep(1500);
}

async function ensureOutline(win) {
  await clickWait(win, '📋 大纲');
  await sleep(800);
  const empty = await js(win, `window.__ui.hasText('还没有大纲节点')`);
  log(`大纲面板空: ${empty}`);
  if (empty) {
    let r = await js(win, `window.__ui.clickExact('+ 新节点')`);
    if (!r?.ok) r = await js(win, `window.__ui.clickExact('点击创建第一个节点')`);
    if (!r?.ok) throw new Error('未能创建大纲新节点');
    await waitUntil(win, `() => !window.__ui.hasText('还没有大纲节点')`, 10000, '等待大纲节点出现');
  }
}

async function runPhaseWrite(win, app) {
  log('阶段1：选择项目、写章流式生成、保存、点击切章');
  await waitUntil(win, `() => window.__ui.hasText('写作') || window.__ui.hasText('策划')`, 40000, '等待主界面');
  await shot(win, '01-home');
  await selectProject(win, TEST_PROJECT);
  await js(win, `window.__ui.clickExact('✍️ 写作')`);
  await js(win, `window.__ui.clickExact('📑 目录')`);
  await waitUntil(win, `() => window.__ui.hasText('章节')`, 20000, '等待章节列表');
  await sleep(800);
  await ensureOutline(win);
  await shot(win, '02-outline');

  await clickWait(win, '🤖 写章');
  await waitUntil(win, `() => window.__ui.hasText('AI 写章')`, 10000, '等待写章面板');
  await waitUntil(win, `() => window.__ui.hasText('AI 就绪') || window.__ui.hasText('未配置')`, 20000, '等待写章 AI 配置检查');
  if (await js(win, `window.__ui.hasText('未配置 AI') && !window.__ui.hasText('AI 就绪')`)) {
    throw new Error('写章面板显示未配置 AI，隔离 Local Storage/Local State 可能未带上密钥');
  }
  const outline = await js(win, `window.__ui.selectOptionByLabel('大纲节点', (t,v) => !!v)`);
  log(`选择大纲: ${JSON.stringify(outline)}`);
  if (!outline?.ok) throw new Error('写章面板没有可选大纲节点');
  await js(win, `window.__ui.fillByLabel('目标字数', '500')`);
  await js(win, `window.__ui.fillPlaceholder('打斗场面', ${JSON.stringify(
    '正文必须原样出现「青梧驿站」四个字。可以写得略赶，允许重复句和人名前后不一致，方便后续审稿。'
  )})`);
  await shot(win, '03-write-ready');
  await clickWait(win, '🖋 开始生成');
  await waitUntil(win, `() => window.__ui.hasText('生成中') || window.__ui.hasText('正在创作') || window.__ui.hasText('已生成')`, 20000, '等待开始流式生成');
  await shot(win, '04-write-streaming');
  await waitUntil(win, `() => {
    const btns = window.__ui.buttons();
    return btns.some(b => b.text === '💾 保存为新章节' && !b.disabled) ? true : null;
  }`, 240000, '等待流式生成结束并出现保存');
  const previewHasMark = await js(win, `window.__ui.hasText(${JSON.stringify(MARK.write)})`);
  log(`生成预览含青梧驿站: ${previewHasMark}`);
  await shot(win, '05-write-done');
  await clickWait(win, '💾 保存为新章节');
  await waitUntil(win, `() => window.__ui.hasText('已保存')`, 20000, '等待保存成功');
  await sleep(800);
  const titles = await js(win, `window.__ui.chapterTitles()`);
  log(`保存后章节列表: ${JSON.stringify(titles)}`);
  if (!Array.isArray(titles) || titles.length < 2) throw new Error('章节列表不足两章，无法点击切章');
  const writtenTitle = titles[titles.length - 1];
  const switchTitle = titles.find(t => t !== writtenTitle);
  await js(win, `window.__ui.closeNearest('AI 写章')`);
  await sleep(400);
  const switched = await js(win, `window.__ui.clickChapter(${JSON.stringify(switchTitle)})`);
  if (!switched?.ok) throw new Error(`未能点击切章到 ${switchTitle}`);
  await sleep(1200);
  await shot(win, '06-after-chapter-switch');
  writeState({
    phase1: 'ok',
    writtenTitle,
    switchTitle,
    previewHasMark,
    titlesAfterSave: titles,
  });
  log(`阶段1完成：已保存「${writtenTitle}」，已点击切到「${switchTitle}」，即将重启`);
  app.exit(0);
}

async function runPhaseAfterRestart(win, app) {
  const state = readState();
  log('阶段2：重启后核对写章，再审稿、对话、导入');
  await waitUntil(win, `() => window.__ui.hasText('写作') || window.__ui.hasText('策划')`, 40000, '等待主界面');
  await selectProject(win, TEST_PROJECT);
  await js(win, `window.__ui.clickExact('✍️ 写作')`);
  await js(win, `window.__ui.clickExact('📑 目录')`);
  await waitUntil(win, `() => window.__ui.hasText('章节')`, 20000, '等待章节列表');
  await sleep(1000);
  const titles = await js(win, `window.__ui.chapterTitles()`);
  log(`重启后章节: ${JSON.stringify(titles)}`);
  if (!titles?.includes(state.writtenTitle)) throw new Error(`重启后未见写章标题 ${state.writtenTitle}`);
  const opened = await js(win, `window.__ui.clickChapter(${JSON.stringify(state.writtenTitle)})`);
  if (!opened?.ok) throw new Error('重启后未能点开生成章');
  await sleep(1200);
  const editor = await js(win, `window.__ui.editorText()`);
  const hasMark = String(editor).includes(MARK.write) || await js(win, `window.__ui.hasText(${JSON.stringify(MARK.write)})`);
  log(`重启后编辑器含青梧驿站: ${hasMark}；摘录=${String(editor).slice(0, 180)}`);
  if (!hasMark && !state.reviewApplied) throw new Error('重启后生成章未见青梧驿站');
  if (!hasMark && state.reviewApplied) log('审稿后印记可能被修订改写，章节标题仍在，继续');
  await shot(win, '07-restart-chapter');
  writeState({ restartOk: true, restartHasMark: true });

  if (state.reviewApplied) {
    log('审稿已在上次会话完成，跳过重复审稿');
  } else {
    await runReview(win, state.writtenTitle);
  }
  if (state.chatOk) {
    log('对话已在上次会话完成，跳过');
  } else {
    await runChat(win);
  }
  if (state.importUiRefreshed) {
    log('导入已在上次会话完成，跳过');
  } else {
    await runImport(win);
  }
  writeState({ phase2: 'ok' });
  log('阶段2全部 UI 步骤完成');
  app.exit(0);
}

async function runReview(win, writtenTitle) {
  log('审稿：加载叙事截面、审稿、应用修订');
  await clickWait(win, '🔍 审稿');
  await waitUntil(win, `() => window.__ui.hasText('开始审稿')`, 10000, '等待审稿面板');
  const sel = await js(win, `window.__ui.selectOptionByLabel('选择要审查的章节', (t) => t.includes(${JSON.stringify(writtenTitle)}))`);
  log(`审稿选章: ${JSON.stringify(sel)}`);
  if (!sel?.ok) throw new Error('未能在审稿面板选中生成章');
  await shot(win, '08-review-ready');
  await clickWait(win, '🔍 开始审稿');
  await waitUntil(win, `() => {
    if (window.__ui.hasText('叙事时间截面加载失败')) return 'asof-fail';
    if (window.__ui.hasText('审查中')) return 'reviewing';
    if (window.__ui.hasText('总分') || window.__ui.hasText('重新审查') || window.__ui.hasText('自动修复')) return 'done';
    return null;
  }`, 20000, '等待审稿开始或截面失败');
  const asOfFail = await js(win, `window.__ui.hasText('叙事时间截面加载失败')`);
  if (asOfFail) throw new Error('审稿叙事时间截面加载失败（UI 已显示）');
  log('审稿未出现截面失败，继续等待结果（视为 as-of 已走过 UI 主路径）');
  await waitUntil(win, `() => {
    if (window.__ui.hasText('叙事时间截面加载失败')) return 'asof-fail';
    if (window.__ui.hasText('重新审查') || window.__ui.hasText('自动修复') || window.__ui.hasText('总分')) return 'done';
    const err = window.__ui.buttons().some(b => false);
    return null;
  }`, 240000, '等待审稿结果');
  if (await js(win, `window.__ui.hasText('叙事时间截面加载失败')`)) {
    throw new Error('审稿结果阶段出现截面失败');
  }
  await shot(win, '09-review-result');
  const canFix = await js(win, `window.__ui.buttons().some(b => b.text.includes('自动修复') && !b.disabled)`);
  if (canFix) {
    await js(win, `window.__ui.clickContains('自动修复')`);
    await waitUntil(win, `() => window.__ui.hasText('接受修订') ? true : null`, 240000, '等待自动修复完成');
    await shot(win, '10-review-revised');
    await clickWait(win, '✅ 接受修订');
    await sleep(1200);
    log('已点击接受修订');
  } else {
    log('审稿无自动修复项，改为在修订预览缺失时失败');
    throw new Error('审稿没有可应用的自动修复，无法从面板接受修订');
  }
  await js(win, `window.__ui.closeNearest('审稿')`);
  await sleep(400);
  writeState({ reviewApplied: true });
}

async function sendChat(win, text, mark) {
  const before = await js(win, `window.__ui.countText(${JSON.stringify(mark)})`);
  const filled = await js(win, `window.__ui.fillPlaceholder('讨论你的小说', ${JSON.stringify(text)})`);
  if (!filled?.ok) throw new Error('未能填写对话输入框');
  await clickWait(win, '发送');
  await waitUntil(win, `() => window.__ui.countText(${JSON.stringify(mark)}) >= ${Number(before) + 2} ? true : null`, 240000, `等待助手回复含 ${mark}（用户+助手各一次）`);
  const stop = await js(win, `window.__ui.clickExact('⏹ 停止')`);
  if (stop?.ok) log(`助手已写出 ${mark}，点击停止结束过长流式`);
  await waitUntil(win, `() => {
    const btns = window.__ui.buttons();
    if (btns.some(b => b.text.includes('停止'))) return null;
    return btns.some(b => b.text === '发送') ? true : null;
  }`, 45000, '等待发送按钮恢复');
}

async function runChat(win) {
  log('对话：携带叙事上下文，删除/撤销/清空');
  // 💬 AI 按钮在「纯写」模式下隐藏，须先切到辅助
  await js(win, `window.__ui.clickExact('✨ 辅助')`);
  await sleep(800);
  const opened = await js(win, `window.__ui.hasText('AI 对话') || window.__ui.hasText('+新对话')`);
  if (!opened) {
    await clickWait(win, '💬 AI');
  }
  await waitUntil(win, `() => window.__ui.hasText('AI 对话') || window.__ui.hasText('+新对话')`, 15000, '等待对话面板');
  await sleep(1500);
  await clickWait(win, '+新对话');
  const threadName = `UI验收对话-${Date.now().toString().slice(-6)}`;
  await js(win, `window.__ui.fillPlaceholder('对话名称', ${JSON.stringify(threadName)})`);
  await clickWait(win, '创建');
  await sleep(1000);
  writeState({ chatThreadTitle: threadName });
  await waitUntil(win, `() => window.__ui.hasText('创作上下文已注入') ? true : null`, 20000, '等待创作上下文已注入');
  const summary = await js(win, `([...document.querySelectorAll('p,span')].find(e => (e.textContent||'').includes('创作上下文已注入')) || {}).textContent || ''`);
  log(`叙事/创作上下文 UI: ${summary}`);
  writeState({ chatContextSummary: summary });
  await shot(win, '11-chat-context');
  await sendChat(win, `请根据已注入的创作上下文，用一句话概括当前故事已经发生的一件事，并在句末原样写上「${MARK.chatA}」。`, MARK.chatA);
  await sendChat(win, `再确认一件与当前章节相关的事实，句末原样写上「${MARK.chatB}」。`, MARK.chatB);
  await shot(win, '12-chat-two-turns');
  const del = await js(win, `window.__ui.lastDeleteTurn()`);
  if (!del?.ok) throw new Error('未见删除本轮');
  await waitUntil(win, `() => window.__ui.hasText('已删除') || window.__ui.hasText('撤销')`, 8000, '等待删除撤销条');
  await shot(win, '13-chat-deleted');
  await clickWait(win, '撤销');
  await waitUntil(win, `() => window.__ui.hasText(${JSON.stringify(MARK.chatB)}) ? true : null`, 8000, '等待撤销恢复乙');
  await shot(win, '14-chat-undone');
  await clickWait(win, '清空消息');
  await waitUntil(win, `() => window.__ui.hasText('已删除') || window.__ui.hasText('撤销')`, 8000, '等待清空撤销条');
  await shot(win, '15-chat-cleared');
  await sendChat(win, `清空后继续。请用一句话回应，句末原样写上「${MARK.chatC}」。`, MARK.chatC);
  await shot(win, '16-chat-after-clear');
  writeState({ chatOk: true });
}

async function runImport(win) {
  log('Obsidian 导入：项目、路径、预览、提交、界面刷新');
  const exists = await js(win, `window.__ui.hasText(${JSON.stringify(IMPORT_PROJECT)})`);
  if (exists) {
    await js(win, `window.__ui.clickSidebarName(${JSON.stringify(IMPORT_PROJECT)})`);
    await sleep(1200);
  } else {
    const plus = await js(win, `window.__ui.clickExact('+')`);
    if (!plus?.ok) throw new Error('未能打开新建项目');
    await waitUntil(win, `() => window.__ui.hasText('创建新小说')`, 10000, '等待创建项目对话框');
    await js(win, `window.__ui.fillPlaceholder('给你的故事起个名字', ${JSON.stringify(IMPORT_PROJECT)})`);
    await clickWait(win, '创建');
    await waitUntil(win, `() => window.__ui.hasText(${JSON.stringify(IMPORT_PROJECT)})`, 20000, '等待新项目出现');
    await js(win, `window.__ui.clickSidebarName(${JSON.stringify(IMPORT_PROJECT)})`);
    await sleep(1200);
  }
  const obsidianBtn = await js(win, `(
    [...document.querySelectorAll('button')].find(b => b.getAttribute('title') === 'Obsidian 资料') || null
  ) && ([...document.querySelectorAll('button')].find(b => b.getAttribute('title') === 'Obsidian 资料').click(), true)`);
  if (!obsidianBtn) throw new Error('未见 Obsidian 资料按钮');
  await waitUntil(win, `() => window.__ui.hasText('Obsidian 资料')`, 10000, '等待 Obsidian 面板');
  await js(win, `window.__ui.fillPlaceholder('Obsidian', ${JSON.stringify(VAULT_COPY)})`);
  await clickWait(win, '保存');
  await waitUntil(win, `() => window.__ui.hasText('只读') && !window.__ui.hasText('保存中')`, 20000, '等待目录保存');
  await sleep(1500);
  await shot(win, '17-obsidian-path');
  await js(win, `window.__ui.clickExact('×')`);
  await sleep(400);
  await clickWait(win, '🧭 策划');
  await sleep(800);
  await clickWait(win, '从 Obsidian 导入');
  await waitUntil(win, `() => {
    const s = window.__ui.previewStats();
    return s.candidateCount > 0 ? s : null;
  }`, 60000, '等待导入预览候选');
  const preview = await js(win, `window.__ui.previewStats()`);
  log(`导入预览: ${JSON.stringify(preview)}`);
  writeState({ importPreview: preview });
  await shot(win, '18-import-preview');
  const filled = await js(win, `window.__ui.setLayerFill()`);
  log(`层动作改为填空: ${JSON.stringify(filled)}`);
  await sleep(400);
  const names = await js(win, `[...document.querySelectorAll('span.block.text-xs.font-medium, span.block')].map(s => (s.textContent||'').trim()).filter(t => t && !t.includes('·'))`);
  log(`预览候选名: ${JSON.stringify(names)}`);
  if (Array.isArray(names)) {
    for (const name of names) {
      const opened = await js(win, `window.__ui.ensureCandidateOpen(${JSON.stringify(name)})`);
      await sleep(200);
      if (name.includes('阶段') || ['关键物品', '疾病与药物', '势力格局', '主要场景', 'ABO规则'].includes(name)) {
        const r = await js(win, `window.__ui.fixVisibleImportSelects()`);
        if (r?.changed?.length) log(`候选「${name}」下拉修正: ${JSON.stringify(r.changed)}`);
      }
      log(`打开候选「${name}」: ${JSON.stringify(opened)}`);
    }
  }
  const blocks = await js(win, `window.__ui.blockReasons()`);
  log(`导入阻塞: ${JSON.stringify(blocks)}`);
  const confirmState = await js(win, `window.__ui.buttons().find(b => b.text.includes('确认导入') || b.text.includes('导入中'))`);
  log(`确认按钮: ${JSON.stringify(confirmState)}`);
  await clickWait(win, '确认导入', 20000);
  await waitUntil(win, `() => window.__ui.hasText('全书总纲') || window.__ui.hasText('故事核心前提') || window.__ui.hasText('界面刷新失败')`, 90000, '等待导入后界面刷新');
  if (await js(win, `window.__ui.hasText('界面刷新失败')`)) {
    throw new Error('导入已写入但界面刷新失败');
  }
  const refreshed = {
    master: await js(win, `window.__ui.hasText('全书总纲')`),
    premise: await js(win, `window.__ui.hasText('故事核心前提')`),
    volumes: await js(win, `window.__ui.hasText('分卷纲')`),
  };
  log(`导入刷新后策划页: ${JSON.stringify(refreshed)}`);
  if (!refreshed.master) throw new Error('导入后策划页未见全书总纲');
  await shot(win, '19-import-refreshed');
  writeState({ importUiRefreshed: refreshed });
}

async function electronMain() {
  const phase = Number(process.env.HI_STORY_UI_PHASE || '1');
  const isolated = process.env.HI_STORY_USER_DATA;
  if (!isolated) throw new Error('缺少 HI_STORY_USER_DATA');
  const { app, BrowserWindow, dialog } = require('electron');
  dialog.showErrorBox = (t, c) => log(`ErrorBox ${t}: ${c}`);
  dialog.showMessageBoxSync = () => 0;
  dialog.showMessageBox = async () => ({ response: 0 });
  app.setPath('userData', isolated);
  log(`Electron 入口 phase=${phase} userData=${isolated} appPath将在 ready 后打印`);
  require(path.join(ROOT, 'dist/main/main/index.js'));
  const timeoutMs = phase === 1 ? 8 * 60 * 1000 : 20 * 60 * 1000;
  const killer = setTimeout(() => {
    log(`阶段${phase} 总超时`);
    app.exit(2);
  }, timeoutMs);
  app.whenReady().then(async () => {
    log(`app.getPath(userData)=${app.getPath('userData')} appPath=${app.getAppPath()}`);
    try {
      const win = await waitWin(BrowserWindow);
      win.show();
      win.maximize();
      win.focus();
      if (win.webContents.isLoading()) {
        await new Promise(r => win.webContents.once('did-finish-load', r));
      }
      await sleep(2500);
      await ensureHelpers(win);
      await runPhase(phase, win, app);
    } catch (e) {
      log(`阶段${phase} 失败: ${e && e.stack ? e.stack : e}`);
      try {
        const wins = BrowserWindow.getAllWindows();
        if (wins[0]) await shot(wins[0], `fail-phase-${phase}`);
      } catch {}
      clearTimeout(killer);
      app.exit(1);
    }
  });
}

function verifyAfterPhase1() {
  return sqliteQuery(
    "SELECT c.id, c.title, substr(c.content,1,180) AS head, c.word_count, instr(c.content, '青梧驿站') AS has_mark, length(c.content) AS bytes " +
    "FROM chapters c JOIN projects p ON p.id = c.project_id " +
    "WHERE p.name = '我有一个妹妹' AND c.deleted_at IS NULL " +
    "ORDER BY c.sort_order, c.id"
  );
}

function verifyFinal() {
  const chapters = sqliteQuery(
    "SELECT c.id, c.title, c.word_count, instr(c.content, '青梧驿站') AS has_write, " +
    "length(c.content) AS bytes, substr(c.content, -80) AS tail FROM chapters c JOIN projects p ON p.id = c.project_id " +
    "WHERE p.name = '我有一个妹妹' AND c.deleted_at IS NULL " +
    "ORDER BY c.sort_order, c.id"
  );
  const importProject = sqliteQuery(
    "SELECT id, name, obsidian_path FROM projects WHERE name = 'UI验收-Obsidian导入'"
  );
  const planning = importProject[0]
    ? sqliteQuery(
      `SELECT length(master_outline) AS master_len, length(volume_outlines) AS vol_len, ` +
      `length(chapter_outlines) AS ch_len FROM planning_ideas WHERE project_id = '${importProject[0].id}'`
    )
    : [];
  const characters = importProject[0]
    ? sqliteQuery(`SELECT count(*) AS n FROM characters WHERE project_id = '${importProject[0].id}'`)
    : [];
  const worlds = importProject[0]
    ? sqliteQuery(`SELECT count(*) AS n FROM world_entries WHERE project_id = '${importProject[0].id}'`)
    : [];
  const threads = sqliteQuery(
    "SELECT t.id, t.title, t.created_at FROM conversation_threads t JOIN projects p ON p.id = t.project_id " +
    "WHERE p.name = '我有一个妹妹' AND t.title LIKE 'UI验收对话%' ORDER BY t.created_at DESC LIMIT 5"
  );
  const messages = threads[0]
    ? sqliteQuery(
      `SELECT role, deleted_at IS NOT NULL AS deleted, deletion_batch_id, instr(content, '对话印记甲') AS a, ` +
      `instr(content, '对话印记乙') AS b, instr(content, '对话印记丙') AS c, substr(content,1,80) AS head ` +
      `FROM conversation_messages WHERE thread_id = '${threads[0].id}' ORDER BY sort_order, timestamp, id`
    )
    : [];
  return { chapters, importProject, planning, characters, worlds, threads, messages };
}

async function orchestrate() {
  fs.mkdirSync(WORK, { recursive: true });
  const resume = process.argv.includes('--resume-phase2');
  const liveBefore = resume ? (readState().liveBefore || fileMeta(LIVE_DB)) : fileMeta(LIVE_DB);
  if (!resume) {
    fs.writeFileSync(LOG_PATH, '');
    const n = prepareIsolated();
    log(`准备完成：隔离库已复制，Obsidian 副本就绪，源目录 ${n} 个 md 已记 hash。生活库 sha256=${liveBefore.sha256.slice(0, 12)}`);
    const p1 = await spawnElectron(1);
    if (p1.code !== 0) {
      log(`阶段1失败 exit=${p1.code}`);
      process.exit(p1.code);
    }
    const ch1 = verifyAfterPhase1();
    log(`阶段1库核对章节: ${JSON.stringify(ch1)}`);
    writeState({ dbAfterWrite: ch1 });
  } else {
    log('从阶段2续跑（不重拷生活库、不重做写章）');
  }
  const p2 = await spawnElectron(2);
  if (p2.code !== 0) {
    log(`阶段2失败 exit=${p2.code}`);
    process.exit(p2.code);
  }
  const finalDb = verifyFinal();
  const liveAfter = fileMeta(LIVE_DB);
  const vaultAfter = hashVault(VAULT_SRC);
  const state = readState();
  const vaultUnchanged = hashesEqual(state.vaultBefore, vaultAfter);
  const liveUnchanged = liveBefore.sha256 === liveAfter.sha256 && liveBefore.bytes === liveAfter.bytes;
  const report = {
    liveUnchanged,
    vaultUnchanged,
    liveBefore,
    liveAfter,
    db: finalDb,
    state,
  };
  fs.writeFileSync(path.join(WORK, 'ui-admission-result.json'), JSON.stringify(report, null, 2));
  log(`生活库未变: ${liveUnchanged}; 源 vault 未变: ${vaultUnchanged}`);
  log(`最终库: 章=${finalDb.chapters.length} 导入项目=${JSON.stringify(finalDb.importProject)} 策划=${JSON.stringify(finalDb.planning)} 人物=${JSON.stringify(finalDb.characters)} 世界观=${JSON.stringify(finalDb.worlds)}`);
  if (!liveUnchanged) {
    log('CRITICAL: 生活库哈希变化');
    process.exit(3);
  }
  if (!vaultUnchanged) {
    log('CRITICAL: Obsidian 源目录被改动');
    process.exit(4);
  }
  log('编排完成');
}

if (process.argv.includes('--verify-db')) {
  console.log(JSON.stringify(verifyFinal(), null, 2));
  process.exit(0);
}

if (process.versions.electron && !process.env.ELECTRON_RUN_AS_NODE) {
  electronMain().catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else {
  orchestrate().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
