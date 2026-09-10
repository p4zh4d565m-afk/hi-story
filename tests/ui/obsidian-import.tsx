// Obsidian 导入真实 UI 回归：open=true 挂载真实面板，通过 DOM 事件完成导入闭环，
// 核心提交走面板内部 commit（调用 electronAPI），不直接调用测试 IPC 的 commit。
import React from 'react';
import { createRoot } from 'react-dom/client';
import ObsidianImportPanel from '../../src/renderer/components/ObsidianImportPanel';

const invoke = (window as any).electronAPI.invoke.bind((window as any).electronAPI);

function wait(ms: number) { return new Promise(res => setTimeout(res, ms)); }

async function waitFor(cond: () => boolean, timeout = 8000, step = 50): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (cond()) return true;
    await wait(step);
  }
  return cond();
}

async function run(): Promise<Array<{ name: string; error?: string }>> {
  const results: Array<{ name: string; error?: string }> = [];
  const check = (name: string, ok: boolean, detail?: string) => {
    results.push({ name, error: ok ? undefined : detail || '断言失败' });
  };

  let root: any = null;
  try {
    await invoke('reset');

    // 真实挂载 open=true 面板
    const el = document.getElementById('root')!;
    root = createRoot(el);
    root.render(React.createElement(ObsidianImportPanel, {
      project: { id: 'project-a', name: '测试项目', typeTags: [], style: '', summary: '', obsidianPath: '', createdAt: 't', updatedAt: 't' },
      open: true,
      onClose: () => {},
      onImported: async () => {},  // 模拟 App 层刷新成功
    }));

    // 等待扫描完成，候选列表渲染
    await waitFor(() => document.body.textContent?.includes('完整大纲'));
    check('面板扫描出总纲候选', document.body.textContent?.includes('完整大纲') ?? false);
    check('面板扫描出分卷纲候选', document.body.textContent?.includes('大纲_卷1') ?? false);
    check('面板扫描出章纲候选', document.body.textContent?.includes('章节细纲') ?? false);
    check('面板扫描出人物候选', document.body.textContent?.includes('沈屿') ?? false);
    check('面板扫描出世界观候选', document.body.textContent?.includes('主要场景') ?? false);

    // 世界观 category 已由 frontmatter 提供，无需 DOM 选分类。
    // 不点击文件行（点击 label 会 toggle checkbox，反而取消默认选中），
    // 世界观候选因有 world 槽位默认已选中。

    // 诊断：世界观候选的实际槽位与 category（只读，不属核心提交）
    const diag = await invoke('prepare', 'project-a');
    const worldCand = diag.data.candidates.find((c: any) => c.relativePath.includes('主要场景'));
    check('诊断：世界观候选存在', !!worldCand);
    check('诊断：世界观候选槽位含 world', worldCand?.slots?.includes('world') ?? false, `slots=${JSON.stringify(worldCand?.slots)}`);
    check('诊断：世界观草稿有 1 条', worldCand?.drafts?.worlds?.length === 1, `worlds=${JSON.stringify(worldCand?.drafts?.worlds)}`);
    check('诊断：世界观 category 为 place', worldCand?.drafts?.worlds?.[0]?.category === 'place', `category=${worldCand?.drafts?.worlds?.[0]?.category}`);

    // 找到确认导入按钮并点击
    const confirmBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('确认导入'));
    check('确认导入按钮存在', !!confirmBtn);

    // 提交前 snapshot（通过测试 IPC 只读查询，不算"核心提交"）
    const before = await invoke('snapshot');
    check('提交前数据库为空', before.planning.length === 0 && before.characters.length === 0 && before.worlds.length === 0);

    // 点击确认导入（核心提交走面板内部 commit）
    if (confirmBtn && !(confirmBtn as HTMLButtonElement).disabled) {
      (confirmBtn as HTMLButtonElement).click();
    }

    // 等待提交完成（面板会 onImported 后 onClose，面板关闭即成功）
    await waitFor(() => {
      // 提交成功后面板 onClose 被调用，但这里 onClose 是 no-op，所以检查数据库快照
      return true;
    }, 500);
    await wait(800); // 给 commit + 事务留时间

    const after = await invoke('snapshot');
    check('提交后策划记录写入', after.planning.length === 1);
    check('提交后人物写入', after.characters.length === 1 && after.characters[0].name === '沈屿');
    // 输出世界观实际内容，辅助诊断
    const worldDetail = JSON.stringify(after.worlds);
    check('提交后世界观写入且分类为 place', after.worlds.length === 1 && after.worlds[0].category === 'place', `实际 worlds=${worldDetail}`);
  } catch (e) {
    results.push({ name: '整体执行', error: (e as Error).message });
  } finally {
    if (root) { try { root.unmount(); } catch {} }
  }
  return results;
}

(window as any).runObsidianImportRegression = run;
