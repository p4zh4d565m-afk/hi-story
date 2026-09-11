// Obsidian 导入真实 UI 回归（8.3）：真实挂载面板，通过 DOM 交互完成导入闭环。
// 核心提交走面板内部 commit（调用 electronAPI），测试脚本只用 reset/snapshot/counts/setDelays 辅助 IPC。
import React from 'react';
import { createRoot } from 'react-dom/client';
import ObsidianImportPanel from '../../src/renderer/components/ObsidianImportPanel';

const invoke = (window as any).electronAPI.invoke.bind((window as any).electronAPI);

function wait(ms: number) { return new Promise(res => setTimeout(res, ms)); }
async function waitFor(cond: () => boolean | Promise<boolean>, timeout = 8000, step = 50): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await cond()) return true; await wait(step); }
  return cond();
}

// React 受控组件 DOM 模拟：原生 value setter + 对应事件
function setNativeValue(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = Object.getPrototypeOf(el);
  const desc = Object.getOwnPropertyDescriptor(proto, 'value')!;
  desc.set!.call(el, value);
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
    // 勾选解锁 checkbox
    const unlockCbs = findCheckboxes().filter(cb => {
      const span = cb.closest('span') || cb.parentElement;
      return span?.textContent?.includes('解锁');
    });
    check('D2 解锁 checkbox 存在', unlockCbs.length > 0);
    if (unlockCbs.length > 0) unlockCbs[0].click();
    await wait(100);

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
    const gConfirm = findButton('确认导入');
    if (gConfirm && !(gConfirm as HTMLButtonElement).disabled) (gConfirm as HTMLButtonElement).click();
    await waitFor(async () => (await invoke('snapshot')).characters.length > 0, 8000);
    const gAfter = await invoke('snapshot');
    check('G3 覆盖人物保留原 id', gAfter.characters[0]?.id === 'c1', JSON.stringify(gAfter.characters));
    check('G4 覆盖人物保留 profileOutline', gAfter.characters[0]?.profile_outline === '[{"id":"node-a"}]', JSON.stringify(gAfter.characters[0]?.profile_outline));

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
    const g2Confirm = findButton('确认导入');
    if (g2Confirm && !(g2Confirm as HTMLButtonElement).disabled) (g2Confirm as HTMLButtonElement).click();
    await waitFor(async () => (await invoke('snapshot')).worlds.length > 0, 8000);
    const g2After = await invoke('snapshot');
    const g2World = g2After.worlds.find((w: any) => w.id === 'w1');
    check('G5 覆盖世界观保留原 id', g2World?.id === 'w1', JSON.stringify(g2After.worlds));
    check('G6 覆盖世界观保留 parentId', g2World?.parent_id === 'parent-w', JSON.stringify(g2World));

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
    await invoke('setDelays', { commit: 300 });
    await invoke('reset', 'basic');
    await mount({ id: 'project-a', name: '测试项目', typeTags: [], style: '', summary: '', obsidianPath: '', createdAt: 't', updatedAt: 't' }, async () => {});
    await waitFor(() => document.body.textContent?.includes('完整大纲'), 8000);
    const iActionSelects = Array.from(document.querySelectorAll('select')).filter(s => ['保留', '填空', '替换', '清空'].some(t => Array.from(s.options).some(o => o.textContent?.includes(t))));
    for (const sel of iActionSelects) { setNativeValue(sel as HTMLSelectElement, 'fill'); fireChange(sel); }
    await wait(200);
    const iConfirm = findButton('确认导入');
    if (iConfirm && !(iConfirm as HTMLButtonElement).disabled) (iConfirm as HTMLButtonElement).click();
    await wait(50); // 进入 committing，延迟尚未结束
    const anyDisabled = Array.from(document.querySelectorAll('input, select, button')).some(el => (el as any).disabled);
    check('I1 提交期间存在禁用控件', anyDisabled);
    const closeBtnDisabled = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('×'));
    check('I2 提交期间关闭按钮禁用', closeBtnDisabled ? (closeBtnDisabled as HTMLButtonElement).disabled : false);
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

  } catch (e) {
    results.push({ name: '整体执行', error: (e as Error).message });
  } finally {
    if (root) { try { root.unmount(); } catch {} }
  }
  return results;
}

(window as any).runObsidianImportRegression = run;
