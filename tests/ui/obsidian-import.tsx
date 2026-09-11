// Obsidian 导入真实 UI 回归（8.3）：真实挂载面板，通过 DOM 交互完成导入闭环。
// 核心提交走面板内部 commit（调用 electronAPI），测试脚本只用 reset/snapshot/counts/setDelays 辅助 IPC。
import React from 'react';
import { createRoot } from 'react-dom/client';
import ObsidianImportPanel from '../../src/renderer/components/ObsidianImportPanel';
import PlanningWorkspace from '../../src/renderer/components/PlanningWorkspace';
import { createImportedEntitiesRefresher } from '../../src/renderer/services/imported-entities-refresher';

const invoke = (window as any).electronAPI.invoke.bind((window as any).electronAPI);

function wait(ms: number) { return new Promise(res => setTimeout(res, ms)); }
async function waitFor(cond: () => boolean | Promise<boolean>, timeout = 8000, step = 50): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await cond()) return true; await wait(step); }
  if (await cond()) return true;
  throw new Error('waitFor 超时：条件未满足');
}

// React 受控组件 DOM 模拟：原生 value setter + 对应事件
function setNativeValue(el: HTMLInputElement | HTMLSelectElement, value: string) {
  // 用原型 setter 绕过 React value tracker，使 React 检测到 DOM 变化并触发 onChange
  const proto = el.tagName.toLowerCase() === 'select' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
}
function fireInput(el: HTMLElement) { el.dispatchEvent(new Event('input', { bubbles: true })); }
function fireChange(el: HTMLElement) { el.dispatchEvent(new Event('change', { bubbles: true })); }

type Result = { name: string; error?: string };

async function run(): Promise<Result[]> {
  const results: Result[] = [];
  const check = (name: string, ok: boolean, detail?: string) => {
    results.push({ name, error: ok ? undefined : detail || '断言失败' });
  };

  let root: any = null;
  const mount = async (project: any, onImported: any) => {
    if (root) { try { root.unmount(); } catch {} }
    document.getElementById('root')!.innerHTML = '';
    root = createRoot(document.getElementById('root')!);
    root.render(React.createElement(ObsidianImportPanel, {
      project, open: true, onClose: () => {}, onImported,
    }));
    await waitFor(() => document.body.textContent?.includes('从 Obsidian 导入策划') === true, 8000);
    // 等待扫描完成（候选列表或错误出现）
    await waitFor(() => !document.body.textContent?.includes('正在扫描'), 8000);
  };

  // 挂载真实 PlanningWorkspace（R1 集成测试）：面板 onImported 走真实的 loadPlanning + refreshImportedEntities 链路。
  // 实体刷新使用与 App 一致的 createImportedEntitiesRefresher，测试库通过 failNextEntityRefresh 触发真实 IPC 失败。
  const mountPlanning = async () => {
    if (root) { try { root.unmount(); } catch {} }
    document.getElementById('root')!.innerHTML = '';
    root = createRoot(document.getElementById('root')!);
    const refreshImportedEntities = createImportedEntitiesRefresher({
      invoke: (channel, ...args) => invoke(channel, ...args),
      isProjectCurrent: () => true,
      onApply: () => {},
    });
    root.render(React.createElement(PlanningWorkspace, {
      project: { id: 'project-a', name: '测试项目', typeTags: [], style: '', summary: '', obsidianPath: '', createdAt: 't', updatedAt: 't' },
      onRefreshImportedEntities: refreshImportedEntities,
    }));
    // PlanningWorkspace 初始 importOpen=false，点「从 Obsidian 导入」打开真实面板
    await waitFor(() => document.body.textContent?.includes('从 Obsidian 导入') === true, 8000);
    const openBtn = findButton('从 Obsidian 导入');
    if (!openBtn) throw new Error('从 Obsidian 导入按钮不存在');
    openBtn.click();
    await waitFor(() => document.body.textContent?.includes('从 Obsidian 导入策划') === true, 8000);
    await waitFor(() => !document.body.textContent?.includes('正在扫描'), 8000);
  };

  const findButton = (text: string) => Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes(text));
  const findSelects = () => Array.from(document.querySelectorAll('select'));
  const findCheckboxes = () => Array.from(document.querySelectorAll('input[type="checkbox"]'));

  try {
    // ============ 场景 A：basic 五类扫描 + 默认全选提交 + 三层 JSON 断言 ============
    await invoke('reset', 'basic');
    await mount({ id: 'project-a', name: '测试项目', typeTags: [], style: '', summary: '', obsidianPath: '', createdAt: 't', updatedAt: 't' }, async () => {});
    await waitFor(() => document.body.textContent?.includes('完整大纲'), 8000);
    check('A1 扫描出总纲候选', document.body.textContent?.includes('完整大纲') ?? false);
    check('A2 扫描出分卷纲候选', document.body.textContent?.includes('大纲_卷1') ?? false);
    check('A3 扫描出章纲候选', document.body.textContent?.includes('章节细纲') ?? false);
    check('A4 扫描出人物候选', document.body.textContent?.includes('沈屿') ?? false);
    check('A5 扫描出世界观候选', document.body.textContent?.includes('主要场景') ?? false);

    const confirmBtn = findButton('确认导入');
    check('A6 确认导入按钮存在', !!confirmBtn);
    const before = await invoke('snapshot');
    check('A7 提交前数据库为空', before.planning.length === 0 && before.characters.length === 0 && before.worlds.length === 0);
    // 8.3 第8条：显式把三层 action 设为 fill（不能只依赖默认 keep），内容才真正写入
    const aActionSelects = Array.from(document.querySelectorAll('select')).filter(s => ['保留', '填空', '替换', '清空'].some(t => Array.from(s.options).some(o => o.textContent?.includes(t))));
    check('A7b 三层 action 下拉存在', aActionSelects.length === 3, `实际 ${aActionSelects.length} 个`);
    for (const sel of aActionSelects) { setNativeValue(sel as HTMLSelectElement, 'fill'); fireChange(sel); }
    await wait(200);
    const confirmBtn2 = findButton('确认导入');
    if (confirmBtn2 && !(confirmBtn2 as HTMLButtonElement).disabled) (confirmBtn2 as HTMLButtonElement).click();
    await waitFor(async () => (await invoke('snapshot')).planning.length === 1, 8000);
    const after = await invoke('snapshot');
    check('A8 提交后策划记录写入', after.planning.length === 1);
    check('A9 总纲 JSON 前提非空', !!(after.masterOutlines[0]?.premise), JSON.stringify(after.masterOutlines));
    check('A10 总纲 JSON 结局正确', after.masterOutlines[0]?.ending === '开放式结局', JSON.stringify(after.masterOutlines[0]));
    check('A11 分卷纲卷数=1', after.volumeOutlines[0]?.length === 1, JSON.stringify(after.volumeOutlines));
    check('A12 分卷纲标题含陆昭', after.volumeOutlines[0]?.[0]?.title?.includes('陆昭') ?? false, JSON.stringify(after.volumeOutlines[0]?.[0]));
    check('A13 章纲章数=2', after.chapterOutlines[0]?.length === 2, JSON.stringify(after.chapterOutlines));
    check('A14 章纲第1章标题=初见', after.chapterOutlines[0]?.[0]?.title === '初见', JSON.stringify(after.chapterOutlines[0]?.[0]));
    check('A15 章纲第1章核心冲突正确', after.chapterOutlines[0]?.[0]?.centralConflict === '游轮宴会。', JSON.stringify(after.chapterOutlines[0]?.[0]));
    check('A16 人物写入=1', after.characters.length === 1 && after.characters[0].name === '沈屿');
    check('A17 世界观写入=1 分类 place', after.worlds.length === 1 && after.worlds[0].category === 'place', JSON.stringify(after.worlds));
    // 11.3 第3条：如实断言——有真值的字段值正确；无来源字段明确标注为空（parser 尚未解析这些列）
    const aMaster = after.masterOutlines[0];
    const aVolume = after.volumeOutlines[0]?.[0];
    const aChapter = after.chapterOutlines[0]?.[0];
    const aPhase = aMaster?.phases?.[0];
    check('A18 总纲 phase title/chapterRange 值正确', aPhase?.title?.includes('陆昭') && aPhase?.chapterRange === '第 1-50 章', JSON.stringify(aPhase));
    check('A18b 总纲 phase purpose/keyEvents/turningPoint/emotionTrend 无来源为空', aPhase?.purpose === '' && Array.isArray(aPhase?.keyEvents) && aPhase.keyEvents.length === 0 && aPhase?.turningPoint === '' && aPhase?.emotionTrend === '', JSON.stringify(aPhase));
    check('A19 分卷 chapterRange/keyEvents 内容正确', aVolume?.chapterRange === '第 1-50 章' && Array.isArray(aVolume?.keyEvents) && aVolume.keyEvents.length > 0 && aVolume.keyEvents[0].includes('黄金三章'), JSON.stringify(aVolume));
    check('A20 章纲 chapterNumber/volumeIndex 正确', aChapter?.chapterNumber === 1 && aChapter?.volumeIndex === 0, JSON.stringify(aChapter));
    check('A20b 章纲 pov 无来源为空（parser 未解析视角列）', aChapter?.pov === '', JSON.stringify(aChapter));

    // ============ 场景 B：取消世界观候选 ============
    await invoke('reset', 'basic');
    await mount({ id: 'project-a', name: '测试项目', typeTags: [], style: '', summary: '', obsidianPath: '', createdAt: 't', updatedAt: 't' }, async () => {});
    await waitFor(() => document.body.textContent?.includes('主要场景'), 8000);
    // 找到世界观候选行的 checkbox（其父 span 含「主要场景」）
    const worldRow = Array.from(document.querySelectorAll('label')).find(l => l.textContent?.includes('主要场景'));
    const worldCb = worldRow?.querySelector('input[type="checkbox"]') as HTMLInputElement | undefined;
    check('B1 世界观候选 checkbox 存在', !!worldCb);
    if (worldCb && worldCb.checked) worldCb.click(); // 取消选中
    await wait(100);
    const bConfirm = findButton('确认导入');
    if (bConfirm && !(bConfirm as HTMLButtonElement).disabled) (bConfirm as HTMLButtonElement).click();
    await waitFor(async () => (await invoke('snapshot')).planning.length === 1, 8000);
    const bAfter = await invoke('snapshot');
    check('B2 取消世界观后世界观未写入', bAfter.worlds.length === 0, JSON.stringify(bAfter.worlds));
    check('B3 取消世界观后人物仍写入', bAfter.characters.length === 1, JSON.stringify(bAfter.characters));

    // ============ 场景 C：世界观手动分类 ============
    await invoke('reset', 'no-category-world');
    await mount({ id: 'project-a', name: '测试项目', typeTags: [], style: '', summary: '', obsidianPath: '', createdAt: 't', updatedAt: 't' }, async () => {});
    await waitFor(() => document.body.textContent?.includes('无分类场景'), 8000);
    // 选中世界观候选（main 区会显示），其分类 select 需要手动选
    const catSelect = Array.from(document.querySelectorAll('select')).find(s => Array.from(s.options).some(o => o.value === 'place'));
    check('C1 世界观分类下拉存在', !!catSelect);
    if (!catSelect) throw new Error('世界观分类下拉不存在');
    setNativeValue(catSelect as HTMLSelectElement, 'faction');
    fireChange(catSelect);
    await wait(200);
    const cConfirm = findButton('确认导入');
    check('C2 分类选择后按钮应可提交', cConfirm ? !(cConfirm as HTMLButtonElement).disabled : false);
    if (!cConfirm || (cConfirm as HTMLButtonElement).disabled) throw new Error('分类选择后确认导入按钮仍禁用：' + document.body.textContent?.slice(0, 500));
    (cConfirm as HTMLButtonElement).click();
    await waitFor(async () => (await invoke('snapshot')).worlds.length > 0, 8000);
    const cAfter = await invoke('snapshot');
    check('C3 世界观分类为 faction', cAfter.worlds[0]?.category === 'faction', JSON.stringify(cAfter.worlds));

    // ============ 场景 D：locked 层需解锁 ============
    await invoke('reset', 'locked');
    await mount({ id: 'project-a', name: '测试项目', typeTags: [], style: '', summary: '', obsidianPath: '', createdAt: 't', updatedAt: 't' }, async () => {});
    await waitFor(() => document.body.textContent?.includes('完整大纲'), 8000);
    // 把总纲 action 设为 replace，观察是否出现锁定原因
    const actionSelects = Array.from(document.querySelectorAll('select')).filter(s => ['保留', '填空', '替换', '清空'].some(t => Array.from(s.options).some(o => o.textContent?.includes(t))));
    const masterActionSelect = actionSelects[0];
    if (masterActionSelect) {
      setNativeValue(masterActionSelect as HTMLSelectElement, 'replace');
      fireChange(masterActionSelect);
      await wait(200);
    }
    const lockReason = document.body.textContent?.includes('锁定') ?? false;
    check('D1 锁定总纲 replace 显示解锁提示', lockReason);
    // 未解锁时按钮应禁用
    const dBtnBefore = findButton('确认导入');
    check('D2 未解锁时按钮禁用', dBtnBefore ? (dBtnBefore as HTMLButtonElement).disabled : false);
    // 勾选解锁 checkbox
    const unlockCbs = findCheckboxes().filter(cb => {
      const span = cb.closest('span') || cb.parentElement;
      return span?.textContent?.includes('解锁');
    });
    check('D3 解锁 checkbox 存在', unlockCbs.length > 0);
    if (unlockCbs.length === 0) throw new Error('解锁 checkbox 不存在');
    unlockCbs[0].click();
    await wait(100);
    // 分卷纲（locked）需 clear 并解锁，避免「替换总纲但分卷 keep」的上下游约束
    const volActionSelect = actionSelects[1];
    if (volActionSelect) {
      setNativeValue(volActionSelect as HTMLSelectElement, 'clear');
      fireChange(volActionSelect);
      await wait(200);
    }
    const volUnlockCbs = findCheckboxes().filter(cb => {
      const span = cb.closest('span') || cb.parentElement;
      return span?.textContent?.includes('解锁');
    });
    if (volUnlockCbs.length > 1) volUnlockCbs[1].click();
    await wait(200);
    const dBtnAfter = findButton('确认导入');
    check('D4 解锁后可提交', dBtnAfter ? !(dBtnAfter as HTMLButtonElement).disabled : false);
    if (dBtnAfter && !(dBtnAfter as HTMLButtonElement).disabled) (dBtnAfter as HTMLButtonElement).click();
    await waitFor(async () => {
      const s = await invoke('snapshot');
      return s.masterOutlines[0]?.ending === '新结局';
    }, 8000);
    const dAfter = await invoke('snapshot');
    check('D5 解锁后提交成功（总纲已替换）', dAfter.masterOutlines[0]?.ending === '新结局', JSON.stringify(dAfter.masterOutlines[0]));

    // ============ 场景 E：上下游非法组合 ============
    await invoke('reset', 'upstream-conflict');
    await mount({ id: 'project-a', name: '测试项目', typeTags: [], style: '', summary: '', obsidianPath: '', createdAt: 't', updatedAt: 't' }, async () => {});
    await waitFor(() => document.body.textContent?.includes('完整大纲'), 8000);
    const eSelects = Array.from(document.querySelectorAll('select')).filter(s => ['保留', '填空', '替换', '清空'].some(t => Array.from(s.options).some(o => o.textContent?.includes(t))));
    const eMasterSelect = eSelects[0];
    if (eMasterSelect) {
      setNativeValue(eMasterSelect as HTMLSelectElement, 'replace');
      fireChange(eMasterSelect);
      await wait(200);
    }
    const eReason = document.body.textContent?.includes('替换或清空总纲时，分卷纲需同步替换或清空') ?? false;
    check('E1 替换总纲但分卷 keep 显示非法组合原因', eReason);
    const eBtn = findButton('确认导入');
    check('E2 非法组合时按钮禁用', eBtn ? (eBtn as HTMLButtonElement).disabled : false);

    // ============ 场景 F：刷新失败重试不重复 commit ============
    await invoke('reset', 'basic');
    let importedCalls = 0;
    let failFirst = true;
    await mount({ id: 'project-a', name: '测试项目', typeTags: [], style: '', summary: '', obsidianPath: '', createdAt: 't', updatedAt: 't' }, async () => {
      importedCalls++;
      if (failFirst) { failFirst = false; throw new Error('刷新失败'); }
    });
    await waitFor(() => document.body.textContent?.includes('完整大纲'), 8000);
    const fConfirm = findButton('确认导入');
    if (fConfirm && !(fConfirm as HTMLButtonElement).disabled) (fConfirm as HTMLButtonElement).click();
    await waitFor(() => document.body.textContent?.includes('重试刷新'), 8000);
    check('F1 刷新失败后出现重试刷新按钮', document.body.textContent?.includes('重试刷新') ?? false);
    const fCounts1 = await invoke('counts');
    check('F2 首次提交 commit 调用=1', fCounts1.commitCalls === 1, JSON.stringify(fCounts1));
    // 点击重试刷新
    const retryBtn = findButton('重试刷新');
    if (retryBtn) (retryBtn as HTMLButtonElement).click();
    await wait(300);
    const fCounts2 = await invoke('counts');
    check('F3 重试后 commit 仍=1（不重复写库）', fCounts2.commitCalls === 1, JSON.stringify(fCounts2));
    check('F4 onImported 调用=2', importedCalls === 2, `importedCalls=${importedCalls}`);

    // ============ 场景 G：覆盖同名人物保留 id 与 profileOutline ============
    await invoke('reset', 'overwrite');
    await mount({ id: 'project-a', name: '测试项目', typeTags: [], style: '', summary: '', obsidianPath: '', createdAt: 't', updatedAt: 't' }, async () => {});
    await waitFor(() => document.body.textContent?.includes('沈屿'), 8000);
    const charCb = Array.from(document.querySelectorAll('input[type="checkbox"]')).find(cb => {
      const parent = cb.closest('label') || cb.parentElement;
      return parent?.textContent?.includes('覆盖同名');
    });
    check('G1 人物覆盖 checkbox 存在', !!charCb);
    if (!charCb) throw new Error('人物覆盖 checkbox 不存在');
    if (!(charCb as HTMLInputElement).checked) (charCb as HTMLInputElement).click();
    await wait(100);
    // R2/7.3：通过 DOM 编辑人物最终名称（改为「沈屿改」，覆盖后 id 应保留但 name 更新）
    const charNameInput = Array.from(document.querySelectorAll('input')).find(i => !(i as HTMLInputElement).type || (i as HTMLInputElement).type === 'text' ? (i as HTMLInputElement).value === '沈屿' : false);
    check('G1b 人物名称输入框存在', !!charNameInput);
    if (charNameInput) {
      setNativeValue(charNameInput as HTMLInputElement, '沈屿改');
      fireInput(charNameInput);
      await wait(150);
    }
    // 诊断：验证 input.value 是否已改变
    const afterInput = Array.from(document.querySelectorAll('input')).find(i => ((i as HTMLInputElement).type === 'text' || !(i as HTMLInputElement).type) && (i as HTMLInputElement).value === '沈屿改');
    const gConfirm = findButton('确认导入');
    const gBtnDisabled = gConfirm ? (gConfirm as HTMLButtonElement).disabled : true;
    if (gConfirm && !gBtnDisabled) (gConfirm as HTMLButtonElement).click();
    await waitFor(async () => {
      const s = await invoke('snapshot');
      return s.characters[0]?.name === '沈屿改';
    }, 8000);
    const gAfter = await invoke('snapshot');
    check('G3 覆盖人物保留原 id', gAfter.characters[0]?.id === 'c1', JSON.stringify(gAfter.characters));
    check('G4 覆盖人物保留 profileOutline', gAfter.characters[0]?.profile_outline === '[{"id":"node-a"}]', JSON.stringify(gAfter.characters[0]?.profile_outline));
    check('G4b 覆盖人物名称已更新', gAfter.characters[0]?.name === '沈屿改', `name=${JSON.stringify(gAfter.characters[0]?.name)}, personality=${JSON.stringify(gAfter.characters[0]?.personality)}, count=${gAfter.characters.length}, afterInput=${!!afterInput}, btnDisabled=${gBtnDisabled}`);

    // ============ 场景 G2：覆盖同名世界观保留 id 与 parentId ============
    await invoke('reset', 'overwrite-world');
    await mount({ id: 'project-a', name: '测试项目', typeTags: [], style: '', summary: '', obsidianPath: '', createdAt: 't', updatedAt: 't' }, async () => {});
    await waitFor(() => document.body.textContent?.includes('主要场景'), 8000);
    const gWorldCb = Array.from(document.querySelectorAll('input[type="checkbox"]')).find(cb => {
      const parent = cb.closest('label') || cb.parentElement;
      return parent?.textContent?.includes('覆盖同名');
    });
    check('G2 世界观覆盖 checkbox 存在', !!gWorldCb);
    if (!gWorldCb) throw new Error('世界观覆盖 checkbox 不存在');
    if (!(gWorldCb as HTMLInputElement).checked) (gWorldCb as HTMLInputElement).click();
    await wait(100);
    // 9.4 第4条：通过 DOM 编辑世界观最终名称
    const gWorldNameInput = Array.from(document.querySelectorAll('input')).find(i => ((i as HTMLInputElement).type === 'text' || !(i as HTMLInputElement).type) && (i as HTMLInputElement).value === '主要场景');
    check('G2b 世界观名称输入框存在', !!gWorldNameInput);
    if (gWorldNameInput) {
      setNativeValue(gWorldNameInput as HTMLInputElement, '主要场景改');
      fireInput(gWorldNameInput);
      await wait(150);
    }
    const g2Confirm = findButton('确认导入');
    if (g2Confirm && !(g2Confirm as HTMLButtonElement).disabled) (g2Confirm as HTMLButtonElement).click();
    await waitFor(async () => {
      const s = await invoke('snapshot');
      return s.worlds.find((w: any) => w.id === 'w1')?.name === '主要场景改';
    }, 8000);
    const g2After = await invoke('snapshot');
    const g2World = g2After.worlds.find((w: any) => w.id === 'w1');
    check('G5 覆盖世界观保留原 id', g2World?.id === 'w1', JSON.stringify(g2After.worlds));
    check('G6 覆盖世界观保留 parentId', g2World?.parent_id === 'parent-w', JSON.stringify(g2World));
    check('G6b 覆盖世界观名称已更新', g2World?.name === '主要场景改', JSON.stringify(g2World?.name));

    // ============ 场景 H：卷归属选择（volumeIndex 最终写入） ============
    await invoke('reset', 'two-volumes');
    await mount({ id: 'project-a', name: '测试项目', typeTags: [], style: '', summary: '', obsidianPath: '', createdAt: 't', updatedAt: 't' }, async () => {});
    await waitFor(() => document.body.textContent?.includes('章节细纲'), 8000);
    // 三层设为 fill（写卷）
    const hActionSelects = Array.from(document.querySelectorAll('select')).filter(s => ['保留', '填空', '替换', '清空'].some(t => Array.from(s.options).some(o => o.textContent?.includes(t))));
    for (const sel of hActionSelects) { setNativeValue(sel as HTMLSelectElement, 'fill'); fireChange(sel); }
    await wait(200);
    // 切换到章纲候选（点击候选行，label 的 onClick 切换 selectedPath；但 label 默认会 toggle checkbox，需恢复选中）
    const chapterRow = Array.from(document.querySelectorAll('label')).find(l => l.textContent?.includes('章节细纲'));
    check('H0 章纲候选行存在', !!chapterRow);
    if (!chapterRow) throw new Error('章纲候选行不存在');
    const chapterCb = chapterRow.querySelector('input[type="checkbox"]') as HTMLInputElement;
    const wasChecked = chapterCb?.checked ?? false;
    (chapterRow as HTMLElement).click();
    await wait(200);
    // 点击 label 会 toggle checkbox，若章纲候选被误取消则点回
    if (wasChecked && chapterCb && !chapterCb.checked) chapterCb.click();
    await wait(200);
    // 章纲候选的卷归属下拉应可见（章纲 volumeIndex 为 null）
    const volSelect = Array.from(document.querySelectorAll('select')).find(s => s.value === '' && Array.from(s.options).some(o => o.value === '1' && o.textContent?.includes('卷 2')));
    check('H1 卷归属下拉存在', !!volSelect);
    if (!volSelect) throw new Error('卷归属下拉不存在：' + Array.from(document.querySelectorAll('select')).map(s => s.outerHTML).join(' | '));
    setNativeValue(volSelect as HTMLSelectElement, '1');
    fireChange(volSelect);
    await wait(300); // 等 reparse
    const hConfirm = findButton('确认导入');
    if (hConfirm && !(hConfirm as HTMLButtonElement).disabled) (hConfirm as HTMLButtonElement).click();
    await waitFor(async () => (await invoke('snapshot')).chapterOutlines[0]?.length === 2, 8000);
    const hAfter = await invoke('snapshot');
    check('H2 章纲 volumeIndex 最终=1（选择卷 2）', hAfter.chapterOutlines[0]?.[0]?.volumeIndex === 1, `chapterOutlines=${JSON.stringify(hAfter.chapterOutlines)}`);

    // ============ 场景 I：提交期间控件冻结 ============
    await invoke('reset', 'basic');
    await invoke('setDelays', { commit: 300 });
    await mount({ id: 'project-a', name: '测试项目', typeTags: [], style: '', summary: '', obsidianPath: '', createdAt: 't', updatedAt: 't' }, async () => {});
    await waitFor(() => document.body.textContent?.includes('主要场景'), 8000);
    // 切到世界观候选（分类下拉仅在世界观候选 main 区渲染）
    const iWorldRow = Array.from(document.querySelectorAll('label')).find(l => l.textContent?.includes('主要场景') && l.querySelector('input[type="checkbox"]'));
    if (iWorldRow) {
      const iWorldCb = iWorldRow.querySelector('input[type="checkbox"]') as HTMLInputElement;
      const iWas = iWorldCb?.checked ?? false;
      (iWorldRow as HTMLElement).click();
      await wait(100);
      if (iWas && iWorldCb && !iWorldCb.checked) iWorldCb.click();
      await wait(100);
    }
    const iActionSelects = Array.from(document.querySelectorAll('select')).filter(s => ['保留', '填空', '替换', '清空'].some(t => Array.from(s.options).some(o => o.textContent?.includes(t))));
    for (const sel of iActionSelects) { setNativeValue(sel as HTMLSelectElement, 'fill'); fireChange(sel); }
    await wait(200);
    const iConfirm = findButton('确认导入');
    if (iConfirm && !(iConfirm as HTMLButtonElement).disabled) (iConfirm as HTMLButtonElement).click();
    await wait(50); // 进入 committing，延迟尚未结束
    // 9.4 第7条：逐项断言候选/槽位/输入框/action/确认按钮全部冻结
    const anyDisabled = Array.from(document.querySelectorAll('input, select, button')).some(el => (el as any).disabled);
    check('I1 提交期间存在禁用控件', anyDisabled);
    const closeBtnDisabled = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('×'));
    check('I2 提交期间关闭按钮禁用', closeBtnDisabled ? (closeBtnDisabled as HTMLButtonElement).disabled : false);
    const iConfirmBtn = findButton('导入中') || findButton('确认导入');
    check('I3 提交期间确认按钮禁用', iConfirmBtn ? (iConfirmBtn as HTMLButtonElement).disabled : false);
    const iCandidateCb = Array.from(document.querySelectorAll('input[type="checkbox"]')).find(cb => {
      const label = cb.closest('label');
      return label?.textContent?.includes('完整大纲');
    });
    check('I4 提交期间候选 checkbox 禁用', iCandidateCb ? (iCandidateCb as HTMLInputElement).disabled : false);
    const iActionSelect = Array.from(document.querySelectorAll('select')).find(s => ['保留', '填空', '替换', '清空'].some(t => Array.from(s.options).some(o => o.textContent?.includes(t))));
    check('I5 提交期间 action 下拉禁用', iActionSelect ? (iActionSelect as HTMLSelectElement).disabled : false);
    // 11.3 第2条：补槽位、文本输入、分类、卷归属、故事方向控件冻结
    const iSlotCb = Array.from(document.querySelectorAll('input[type="checkbox"]')).find(cb => {
      const label = cb.closest('label');
      return label && ['总纲', '分卷纲', '章纲', '人物', '世界观'].includes(label.textContent?.trim() ?? '');
    });
    check('I6 提交期间槽位 checkbox 禁用', iSlotCb ? (iSlotCb as HTMLInputElement).disabled : false);
    const iTextInput = Array.from(document.querySelectorAll('input')).find(i => ((i as HTMLInputElement).type === 'text' || !(i as HTMLInputElement).type) && (i as HTMLInputElement).value.length > 0);
    check('I7 提交期间文本输入框禁用', iTextInput ? (iTextInput as HTMLInputElement).disabled : false);
    const iCategorySelect = Array.from(document.querySelectorAll('select')).find(s => Array.from(s.options).some(o => o.value === 'place'));
    check('I8 提交期间分类下拉禁用', iCategorySelect ? (iCategorySelect as HTMLSelectElement).disabled : false);
    // 故事方向表单（basic 无已确认方向，导入总纲时预填表单）
    const iStoryInput = Array.from(document.querySelectorAll('input')).find(i => (i as HTMLInputElement).value === '测试项目');
    check('I9 提交期间故事方向输入框禁用', iStoryInput ? (iStoryInput as HTMLInputElement).disabled : false);
    await invoke('setDelays', { commit: 0 });
    await wait(500);

    // I10：章纲卷归属下拉在提交期间冻结（two-volumes 场景才渲染该下拉）
    await invoke('reset', 'two-volumes');
    await invoke('setDelays', { commit: 300 });
    await mount({ id: 'project-a', name: '测试项目', typeTags: [], style: '', summary: '', obsidianPath: '', createdAt: 't', updatedAt: 't' }, async () => {});
    await waitFor(() => document.body.textContent?.includes('章节细纲'), 8000);
    const i10ActionSelects = Array.from(document.querySelectorAll('select')).filter(s => ['保留', '填空', '替换', '清空'].some(t => Array.from(s.options).some(o => o.textContent?.includes(t))));
    for (const sel of i10ActionSelects) { setNativeValue(sel as HTMLSelectElement, 'fill'); fireChange(sel); }
    await wait(200);
    const i10ChapterRow = Array.from(document.querySelectorAll('label')).find(l => l.textContent?.includes('章节细纲'));
    if (i10ChapterRow) {
      const i10Cb = i10ChapterRow.querySelector('input[type="checkbox"]') as HTMLInputElement;
      const i10Was = i10Cb?.checked ?? false;
      (i10ChapterRow as HTMLElement).click();
      await wait(100);
      if (i10Was && i10Cb && !i10Cb.checked) i10Cb.click();
      await wait(100);
    }
    const i10VolSelect = Array.from(document.querySelectorAll('select')).find(s => s.value === '' && Array.from(s.options).some(o => o.value === '1'));
    check('I10a 章纲卷归属下拉存在', !!i10VolSelect);
    if (i10VolSelect) {
      setNativeValue(i10VolSelect as HTMLSelectElement, '1');
      fireChange(i10VolSelect);
      await wait(300);
    }
    const i10Confirm = findButton('确认导入');
    if (i10Confirm && !(i10Confirm as HTMLButtonElement).disabled) (i10Confirm as HTMLButtonElement).click();
    await wait(50);
    const i10VolSelectFrozen = Array.from(document.querySelectorAll('select')).find(s => s.value === '1' && Array.from(s.options).some(o => o.value === '1'));
    check('I10 提交期间章纲卷归属下拉禁用', i10VolSelectFrozen ? (i10VolSelectFrozen as HTMLSelectElement).disabled : false);
    await invoke('setDelays', { commit: 0 });
    await wait(500);

    // I11：人物覆盖 checkbox 在提交期间冻结（overwrite 场景渲染覆盖 checkbox）
    await invoke('reset', 'overwrite');
    await invoke('setDelays', { commit: 300 });
    await mount({ id: 'project-a', name: '测试项目', typeTags: [], style: '', summary: '', obsidianPath: '', createdAt: 't', updatedAt: 't' }, async () => {});
    await waitFor(() => document.body.textContent?.includes('沈屿'), 8000);
    // overwrite 场景只导入人物（非策划层，不受三层 action 门控），无需设 fill
    const i11OverwriteCb = Array.from(document.querySelectorAll('input[type="checkbox"]')).find(cb => {
      const parent = cb.closest('label') || cb.parentElement;
      return parent?.textContent?.includes('覆盖同名');
    });
    check('I11a 人物覆盖 checkbox 存在', !!i11OverwriteCb);
    if (i11OverwriteCb && !(i11OverwriteCb as HTMLInputElement).checked) (i11OverwriteCb as HTMLInputElement).click();
    await wait(100);
    const i11Confirm = findButton('确认导入');
    if (i11Confirm && !(i11Confirm as HTMLButtonElement).disabled) (i11Confirm as HTMLButtonElement).click();
    await wait(50);
    const i11OverwriteFrozen = Array.from(document.querySelectorAll('input[type="checkbox"]')).find(cb => {
      const parent = cb.closest('label') || cb.parentElement;
      return parent?.textContent?.includes('覆盖同名');
    });
    check('I11 提交期间人物覆盖 checkbox 禁用', i11OverwriteFrozen ? (i11OverwriteFrozen as HTMLInputElement).disabled : false);
    await invoke('setDelays', { commit: 0 });
    await wait(500);

    // ============ 场景 J：reparse pending 期间提交禁用 ============
    await invoke('reset', 'basic');
    await invoke('setDelays', { reparse: 400 });
    await mount({ id: 'project-a', name: '测试项目', typeTags: [], style: '', summary: '', obsidianPath: '', createdAt: 't', updatedAt: 't' }, async () => {});
    await waitFor(() => document.body.textContent?.includes('完整大纲'), 8000);
    // 三层 fill
    const jActionSelects = Array.from(document.querySelectorAll('select')).filter(s => ['保留', '填空', '替换', '清空'].some(t => Array.from(s.options).some(o => o.textContent?.includes(t))));
    for (const sel of jActionSelects) { setNativeValue(sel as HTMLSelectElement, 'fill'); fireChange(sel); }
    await wait(200);
    // 通过槽位 checkbox 触发 reparse（右侧 main 区的槽位勾选，label 文本恰好是槽位名）
    const slotCb = Array.from(document.querySelectorAll('input[type="checkbox"]')).find(cb => {
      const label = cb.closest('label');
      return label && ['总纲', '分卷纲', '章纲', '人物', '世界观'].includes(label.textContent?.trim() ?? '');
    });
    if (slotCb) { slotCb.click(); await wait(50); } // 触发 setSlot → reparse（延迟 400ms）
    const jConfirm = findButton('确认导入');
    check('J1 reparse pending 期间按钮禁用', jConfirm ? (jConfirm as HTMLButtonElement).disabled : false);
    await invoke('setDelays', { reparse: 0 });
    await wait(600); // 等 reparse 完成

    // ============ 场景 K：分页到达最后一条 ============
    await invoke('reset', 'many-chapters');
    await mount({ id: 'project-a', name: '测试项目', typeTags: [], style: '', summary: '', obsidianPath: '', createdAt: 't', updatedAt: 't' }, async () => {});
    await waitFor(() => document.body.textContent?.includes('章节细纲'), 8000);
    // 切换到章纲候选
    const kChapterRow = Array.from(document.querySelectorAll('label')).find(l => l.textContent?.includes('章节细纲'));
    if (kChapterRow) {
      const kCb = kChapterRow.querySelector('input[type="checkbox"]') as HTMLInputElement;
      const kWas = kCb?.checked ?? false;
      (kChapterRow as HTMLElement).click();
      await wait(100);
      if (kWas && kCb && !kCb.checked) kCb.click();
      await wait(100);
    }
    // 章纲分页：60 章，每页 50，应有两页
    const kNextBtn = findButton('下一页');
    check('K1 分页下一页按钮存在', !!kNextBtn);
    if (!kNextBtn) throw new Error('下一页按钮不存在（可能未渲染分页）');
    (kNextBtn as HTMLButtonElement).click();
    await wait(200);
    const kHasLast = document.body.textContent?.includes('第60章') ?? false;
    check('K2 点击下一页后到达最后一条（第60章）', kHasLast);

    // ============ 场景 L：reparse 失败→重试成功→预览更新→提交成功 ============
    await invoke('reset', 'basic');
    await mount({ id: 'project-a', name: '测试项目', typeTags: [], style: '', summary: '', obsidianPath: '', createdAt: 't', updatedAt: 't' }, async () => {});
    await waitFor(() => document.body.textContent?.includes('沈屿'), 8000);
    // 三层 fill
    const lActionSelects = Array.from(document.querySelectorAll('select')).filter(s => ['保留', '填空', '替换', '清空'].some(t => Array.from(s.options).some(o => o.textContent?.includes(t))));
    for (const sel of lActionSelects) { setNativeValue(sel as HTMLSelectElement, 'fill'); fireChange(sel); }
    await wait(200);
    // 切换到沈屿候选（点击左侧候选行）
    const lCharRow = Array.from(document.querySelectorAll('label')).find(l => l.textContent?.includes('沈屿') && l.querySelector('input[type="checkbox"]'));
    check('L0 沈屿候选行存在', !!lCharRow);
    if (!lCharRow) throw new Error('沈屿候选行不存在');
    const lCharCb = lCharRow.querySelector('input[type="checkbox"]') as HTMLInputElement;
    const lWas = lCharCb?.checked ?? false;
    (lCharRow as HTMLElement).click();
    await wait(100);
    if (lWas && lCharCb && !lCharCb.checked) lCharCb.click(); // 恢复选中
    await wait(100);
    // 让下一次 reparse 失败，然后取消沈屿的「人物」槽位
    await invoke('failNextReparse');
    const lSlotCb = Array.from(document.querySelectorAll('input[type="checkbox"]')).find(cb => {
      const label = cb.closest('label');
      return label && label.textContent?.trim() === '人物';
    });
    if (lSlotCb) lSlotCb.click(); // 触发 setSlot → reparse（失败）
    await waitFor(() => document.body.textContent?.includes('重新解析'), 8000);
    check('L1 reparse 失败后出现重试按钮', document.body.textContent?.includes('重新解析') ?? false);
    const lBtnAfterFail = findButton('确认导入');
    check('L2 失败后确认导入禁用', lBtnAfterFail ? (lBtnAfterFail as HTMLButtonElement).disabled : false);
    const lRetryBtn = findButton('重新解析');
    if (lRetryBtn) (lRetryBtn as HTMLButtonElement).click();
    await waitFor(() => !document.body.textContent?.includes('重新解析'), 8000);
    const lBtnAfterRetry = findButton('确认导入');
    check('L3 重试成功后确认导入可用', lBtnAfterRetry ? !(lBtnAfterRetry as HTMLButtonElement).disabled : false);
    // 13.3 第1条：重试结果真正落地到预览——人物预览块消失、人物槽位取消（而非仅解除门禁）
    check('L3b 重试后人物预览块已消失', !document.body.textContent?.includes('人物（'), document.body.textContent?.match(/人物（\d+）/)?.[0] ?? '人物预览块仍在');
    const lSlotAfterRetry = Array.from(document.querySelectorAll('input[type="checkbox"]')).find(cb => {
      const label = cb.closest('label');
      return label && label.textContent?.trim() === '人物';
    });
    check('L3c 重试后人物槽位已取消', lSlotAfterRetry ? !(lSlotAfterRetry as HTMLInputElement).checked : false);
    // 提交并核对 SQLite：沈屿的人物槽位已取消，人物不应写入（证明重试结果真正落地到 commit 参数）
    if (lBtnAfterRetry && !(lBtnAfterRetry as HTMLButtonElement).disabled) (lBtnAfterRetry as HTMLButtonElement).click();
    await waitFor(async () => (await invoke('snapshot')).planning.length === 1, 8000);
    const lAfter = await invoke('snapshot');
    check('L4 重试后提交成功且人物未写入', lAfter.planning.length === 1 && lAfter.characters.length === 0, `characters=${JSON.stringify(lAfter.characters)}, planning=${lAfter.planning.length}`);

    // ============ 场景 M：真实 PlanningWorkspace 刷新链路（planning/entity 失败 + 并发门禁） ============
    // M1：策划刷新失败 → 面板停留 refreshPending（真实 db 层 planning 失败）
    await invoke('reset', 'basic');
    await mountPlanning();
    const m1ActionSelects = Array.from(document.querySelectorAll('select')).filter(s => ['保留', '填空', '替换', '清空'].some(t => Array.from(s.options).some(o => o.textContent?.includes(t))));
    for (const sel of m1ActionSelects) { setNativeValue(sel as HTMLSelectElement, 'fill'); fireChange(sel); }
    await wait(200);
    await invoke('failNextPlanningRefresh'); // 让 commit 后的 loadPlanning 失败一次
    const m1Confirm = findButton('确认导入');
    if (m1Confirm && !(m1Confirm as HTMLButtonElement).disabled) (m1Confirm as HTMLButtonElement).click();
    await waitFor(() => document.body.textContent?.includes('重试刷新'), 8000);
    check('M1 planning 刷新失败后停留 refreshPending', document.body.textContent?.includes('重试刷新') ?? false);
    check('M1b 显示界面刷新失败提示', document.body.textContent?.includes('导入已写入，界面刷新失败') ?? false);
    const m1Counts = await invoke('counts');
    check('M1c 只提交一次（不因刷新失败重复写库）', m1Counts.commitCalls === 1, JSON.stringify(m1Counts));

    // M2 + M3：entity 刷新失败（真实 IPC 失败，沿 App 同款 createImportedEntitiesRefresher 返回 false）→ 停留 refreshPending；重试成功 → 面板关闭
    await invoke('reset', 'basic');
    await mountPlanning();
    const m2ActionSelects = Array.from(document.querySelectorAll('select')).filter(s => ['保留', '填空', '替换', '清空'].some(t => Array.from(s.options).some(o => o.textContent?.includes(t))));
    for (const sel of m2ActionSelects) { setNativeValue(sel as HTMLSelectElement, 'fill'); fireChange(sel); }
    await wait(200);
    await invoke('failNextEntityRefresh'); // 让 commit 后的实体刷新（char IPC）失败一次
    const m2Confirm = findButton('确认导入');
    if (m2Confirm && !(m2Confirm as HTMLButtonElement).disabled) (m2Confirm as HTMLButtonElement).click();
    await waitFor(() => document.body.textContent?.includes('重试刷新'), 8000);
    check('M2 entity 刷新失败后停留 refreshPending', document.body.textContent?.includes('重试刷新') ?? false);
    const m2Counts = await invoke('counts');
    check('M2b 只提交一次', m2Counts.commitCalls === 1, JSON.stringify(m2Counts));
    check('M2c 实体刷新确因 IPC 失败返回 false', m2Counts.entityRefreshCalls >= 1, JSON.stringify(m2Counts));
    // M3：重试刷新成功 → 面板关闭
    const m3Retry = findButton('重试刷新');
    if (m3Retry) (m3Retry as HTMLButtonElement).click();
    await waitFor(() => !document.body.textContent?.includes('从 Obsidian 导入策划'), 8000);
    check('M3 重试刷新成功后面板关闭', !document.body.textContent?.includes('从 Obsidian 导入策划'));
    const m3Counts = await invoke('counts');
    check('M3b 重试不再次提交', m3Counts.commitCalls === 1, JSON.stringify(m3Counts));

    // M4：刷新并发门禁 + 刷新中关闭无效（先让首次刷新失败停留在 refreshPending，再在重试刷新时制造「刷新中」窗口）
    await invoke('reset', 'basic');
    await mountPlanning();
    const m4ActionSelects = Array.from(document.querySelectorAll('select')).filter(s => ['保留', '填空', '替换', '清空'].some(t => Array.from(s.options).some(o => o.textContent?.includes(t))));
    for (const sel of m4ActionSelects) { setNativeValue(sel as HTMLSelectElement, 'fill'); fireChange(sel); }
    await wait(200);
    await invoke('failNextPlanningRefresh'); // 首次刷新失败 → 停留 refreshPending
    const m4Confirm = findButton('确认导入');
    if (m4Confirm && !(m4Confirm as HTMLButtonElement).disabled) (m4Confirm as HTMLButtonElement).click();
    await waitFor(() => document.body.textContent?.includes('重试刷新'), 8000);
    await invoke('setDelays', { refresh: 400 }); // 重试刷新耗时，制造「刷新中」窗口
    const m4Before = await invoke('counts');
    const m4Retry = findButton('重试刷新');
    if (!m4Retry) throw new Error('重试刷新按钮不存在');
    (m4Retry as HTMLButtonElement).click();
    await wait(80); // 进入刷新中窗口
    const m4RetryingBtn = findButton('刷新中');
    check('M4a 刷新中重试按钮显示刷新中', !!m4RetryingBtn);
    check('M4b 刷新中重试按钮禁用', m4RetryingBtn ? (m4RetryingBtn as HTMLButtonElement).disabled : false);
    const m4CloseBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('关闭'));
    check('M4c 刷新中关闭按钮禁用', m4CloseBtn ? (m4CloseBtn as HTMLButtonElement).disabled : false);
    const m4HeaderClose = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('×'));
    check('M4d 刷新中标题栏关闭禁用', m4HeaderClose ? (m4HeaderClose as HTMLButtonElement).disabled : false);
    // 背景关闭：refreshing 时 onMouseDown 不触发 onClose
    const overlay = document.querySelector('.fixed.inset-0');
    if (overlay) { (overlay as HTMLElement).dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); await wait(80); }
    check('M4e 刷新中背景关闭后面板仍在', document.body.textContent?.includes('从 Obsidian 导入策划') ?? false);
    if (m4RetryingBtn) (m4RetryingBtn as HTMLButtonElement).click(); // 第二次点击（仍刷新中，被 refreshingRef 挡住）
    await waitFor(() => !document.body.textContent?.includes('从 Obsidian 导入策划'), 8000);
    await invoke('setDelays', { refresh: 0 });
    const m4After = await invoke('counts');
    check('M4 双击重试只进入一次刷新', m4After.planningRefreshCalls - m4Before.planningRefreshCalls === 1, `before=${m4Before.planningRefreshCalls}, after=${m4After.planningRefreshCalls}`);

    // I12：世界观「覆盖同名」checkbox 冻结（overwrite-world 场景渲染世界观覆盖 checkbox）
    await invoke('reset', 'overwrite-world');
    await invoke('setDelays', { commit: 300 });
    await mount({ id: 'project-a', name: '测试项目', typeTags: [], style: '', summary: '', obsidianPath: '', createdAt: 't', updatedAt: 't' }, async () => {});
    await waitFor(() => document.body.textContent?.includes('主要场景'), 8000);
    const i12OverwriteCb = Array.from(document.querySelectorAll('input[type="checkbox"]')).find(cb => {
      const parent = cb.closest('label') || cb.parentElement;
      return parent?.textContent?.includes('覆盖同名');
    });
    check('I12a 世界观覆盖 checkbox 存在', !!i12OverwriteCb);
    if (i12OverwriteCb && !(i12OverwriteCb as HTMLInputElement).checked) (i12OverwriteCb as HTMLInputElement).click();
    await wait(100);
    const i12Confirm = findButton('确认导入');
    if (i12Confirm && !(i12Confirm as HTMLButtonElement).disabled) (i12Confirm as HTMLButtonElement).click();
    await wait(50);
    const i12OverwriteFrozen = Array.from(document.querySelectorAll('input[type="checkbox"]')).find(cb => {
      const parent = cb.closest('label') || cb.parentElement;
      return parent?.textContent?.includes('覆盖同名');
    });
    check('I12 提交期间世界观覆盖 checkbox 禁用', i12OverwriteFrozen ? (i12OverwriteFrozen as HTMLInputElement).disabled : false);
    await invoke('setDelays', { commit: 0 });
    await wait(500);

  } catch (e) {
    results.push({ name: '整体执行', error: (e as Error).message });
  } finally {
    if (root) { try { root.unmount(); } catch {} }
  }
  return results;
}

(window as any).runObsidianImportRegression = run;
