// Obsidian 导入真实 UI 回归：通过主进程 IPC + 真实仓储 + 真实临时目录，验证导入闭环。
import React from 'react';
import { createRoot } from 'react-dom/client';
import ObsidianImportPanel from '../../src/renderer/components/ObsidianImportPanel';

const invoke = (window as any).electronAPI.invoke.bind((window as any).electronAPI);

async function run(): Promise<Array<{ name: string; error?: string }>> {
  const results: Array<{ name: string; error?: string }> = [];
  const check = (name: string, ok: boolean, detail?: string) => {
    results.push({ name, error: ok ? undefined : detail || '断言失败' });
  };

  try {
    await invoke('reset');

    // prepare
    const prep = await invoke('prepare', 'project-a');
    check('prepare 返回候选', prep.success && Array.isArray(prep.data?.candidates), prep.error);
    check('候选包含总纲槽位', prep.data?.candidates?.some((c: any) => c.slots.includes('master')));
    check('候选包含人物槽位', prep.data?.candidates?.some((c: any) => c.slots.includes('character')));
    check('target 返回策划记录数 0', prep.data?.target?.planningRecordCount === 0);

    // 提交总纲
    const masterCand = prep.data.candidates.find((c: any) => c.slots.includes('master'));
    const commitRes = await invoke('commit', {
      projectId: 'project-a', operationId: 'op-ui-1',
      selections: [{ relativePath: masterCand.relativePath, hash: masterCand.hash, slots: masterCand.slots, drafts: masterCand.drafts }],
      layerChoices: { master: { action: 'fill', unlockLocked: false }, volumes: { action: 'keep', unlockLocked: false }, chapters: { action: 'keep', unlockLocked: false } },
    });
    check('提交总纲成功', commitRes.success, commitRes.error);

    const snap = await invoke('snapshot');
    check('策划记录写入 1 条', snap.planning.length === 1);
    check('策划状态为 confirmed', snap.planning[0]?.status === 'confirmed');
    check('总纲已写入', JSON.parse(snap.planning[0].master_outline).ending === '开放式结局');

    // 提交人物
    const charCand = prep.data.candidates.find((c: any) => c.slots.includes('character'));
    const charCommit = await invoke('commit', {
      projectId: 'project-a', operationId: 'op-ui-2',
      selections: [{ relativePath: charCand.relativePath, hash: charCand.hash, slots: charCand.slots, drafts: charCand.drafts }],
      layerChoices: { master: { action: 'keep', unlockLocked: false }, volumes: { action: 'keep', unlockLocked: false }, chapters: { action: 'keep', unlockLocked: false } },
    });
    check('提交人物成功', charCommit.success, charCommit.error);
    const snap2 = await invoke('snapshot');
    check('人物写入 1 条', snap2.characters.length === 1);
    check('人物名字正确', snap2.characters[0]?.name === '沈屿');

    // 世界观未导入不误伤
    check('世界观仍为 0 条', snap2.worlds.length === 0);
  } catch (e) {
    results.push({ name: '整体执行', error: (e as Error).message });
  }
  return results;
}

(window as any).runObsidianImportRegression = run;

// 真实挂载最小面板，验证组件可挂载（open=false 时渲染 null）。
if (typeof document !== 'undefined') {
  const el = document.getElementById('root');
  if (el) {
    createRoot(el).render(React.createElement(ObsidianImportPanel, {
      project: { id: 'project-a', name: '测试', typeTags: [], style: '', summary: '', obsidianPath: '', createdAt: 't', updatedAt: 't' },
      open: false, onClose: () => {}, onImported: async () => {},
    }));
  }
}
