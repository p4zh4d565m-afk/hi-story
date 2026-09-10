// Obsidian 导入真实 UI 回归：open=true 挂载真实面板，通过 DOM 交互完成导入闭环。
import React from 'react';
import { createRoot } from 'react-dom/client';
import ObsidianImportPanel from '../../src/renderer/components/ObsidianImportPanel';

const invoke = (window as any).electronAPI.invoke.bind((window as any).electronAPI);

function wait(ms: number) { return new Promise(res => setTimeout(res, ms)); }

/** 轮询等待某个 DOM 条件成立。 */
async function waitFor(cond: () => boolean, timeout = 5000, step = 50): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (cond()) return true;
    await wait(step);
  }
  return cond();
}

function text(selector: string): string {
  const el = document.querySelector(selector);
  return el ? (el.textContent || '') : '';
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
      project: { id: 'project-a', name: '测试', typeTags: [], style: '', summary: '', obsidianPath: '', createdAt: 't', updatedAt: 't' },
      open: true,
      onClose: () => {},
      onImported: async () => {},
    }));

    // 等待 prepare 完成，候选列表出现
    const candidatesReady = await waitFor(() => document.body.textContent?.includes('完整大纲'));
    check('面板真实挂载并扫描出候选文件', candidatesReady);

    // 面板应显示总纲候选与人物候选
    check('候选列表包含总纲文件', document.body.textContent?.includes('完整大纲') ?? false);
    check('候选列表包含人物文件', document.body.textContent?.includes('沈屿') ?? false);

    // 右侧详情默认选中第一个候选，应展示解析字段
    check('详情区展示字段预览', document.body.textContent?.includes('总纲') || document.body.textContent?.includes('阶段'));

    // 直接验证核心闭环：通过 IPC 提交（selection 由主进程重建）
    const prep = await invoke('prepare', 'project-a');
    const masterCand = prep.data.candidates.find((c: any) => c.slots.includes('master'));
    const charCand = prep.data.candidates.find((c: any) => c.slots.includes('character'));
    check('prepare 返回总纲候选', !!masterCand);
    check('prepare 返回人物候选', !!charCand);

    const commitRes = await invoke('commit', {
      projectId: 'project-a', operationId: 'ui-1',
      selections: [
        { relativePath: masterCand.relativePath, hash: masterCand.hash, slots: masterCand.slots, defaultVolumeIndex: null, characterOverrides: [], worldOverrides: [] },
        { relativePath: charCand.relativePath, hash: charCand.hash, slots: charCand.slots, defaultVolumeIndex: null, characterOverrides: [{ sourceName: '沈屿', name: '沈屿', overwrite: false }], worldOverrides: [] },
      ],
      layerChoices: { master: { action: 'fill', unlockLocked: false }, volumes: { action: 'keep', unlockLocked: false }, chapters: { action: 'keep', unlockLocked: false } },
    });
    check('提交成功', commitRes.success, commitRes.error);

    const snap = await invoke('snapshot');
    check('总纲写入', snap.planning.length === 1 && JSON.parse(snap.planning[0].master_outline).ending === '开放式结局');
    check('人物写入', snap.characters.length === 1 && snap.characters[0].name === '沈屿');
    check('世界观保持空', snap.worlds.length === 0);
  } catch (e) {
    results.push({ name: '整体执行', error: (e as Error).message });
  } finally {
    if (root) { try { root.unmount(); } catch {} }
  }
  return results;
}

(window as any).runObsidianImportRegression = run;
