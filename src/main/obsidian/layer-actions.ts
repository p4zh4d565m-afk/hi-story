import type { ImportLayerChoices } from '../../renderer/types';

export interface LayerStateInput {
  master: { exists: boolean; locked: boolean };
  volumes: { exists: boolean; locked: boolean };
  chapters: { exists: boolean; locked: boolean };
}

export interface LayerIncoming {
  master: boolean;
  volumes: boolean;
  chapters: boolean;
}

export interface LayerFinalResult {
  final: { master: boolean; volumes: boolean; chapters: boolean };
  reasons: string[];
}

/**
 * 三层动作最终状态与阻塞原因（UI 预判与主进程校验共用，保证契约一致）。
 * 与仓储 validateFinalState 的 applyAction + 不变量 + 上下游约束语义完全一致，
 * 但不抛异常，而是把原因收集进 reasons，供 UI 展示与禁用按钮。
 */
export function computeLayerFinalState(
  layers: LayerStateInput,
  choices: ImportLayerChoices,
  incoming: LayerIncoming,
): LayerFinalResult {
  const reasons: string[] = [];

  const applyAction = (action: string, unlock: boolean, currentExists: boolean, hasIncoming: boolean, locked: boolean, label: string): boolean => {
    if (action === 'clear') {
      if (locked && !unlock) reasons.push(`${label}已锁定，替换/清空需确认解锁`);
      return false;
    }
    if (action === 'replace') {
      if (locked && !unlock) reasons.push(`${label}已锁定，替换/清空需确认解锁`);
      if (!hasIncoming) reasons.push(`没有可替换的来源内容（${label}）`);
      return true;
    }
    if (action === 'fill') {
      if (!currentExists && !hasIncoming) reasons.push(`没有可填入内容（${label}）`);
      return currentExists || hasIncoming;
    }
    return currentExists; // keep
  };

  const final = {
    master: applyAction(choices.master.action, choices.master.unlockLocked, layers.master.exists, incoming.master, layers.master.locked, '总纲'),
    volumes: applyAction(choices.volumes.action, choices.volumes.unlockLocked, layers.volumes.exists, incoming.volumes, layers.volumes.locked, '分卷纲'),
    chapters: applyAction(choices.chapters.action, choices.chapters.unlockLocked, layers.chapters.exists, incoming.chapters, layers.chapters.locked, '章纲'),
  };

  // 最终状态不变量
  if (final.volumes && !final.master) reasons.push('存在分卷纲但缺少全书总纲');
  if (final.chapters && (!final.master || !final.volumes)) reasons.push('存在章纲但缺少全书总纲或分卷纲');

  // 上下游动作约束
  if ((choices.master.action === 'replace' || choices.master.action === 'clear') && final.volumes && !['replace', 'clear'].includes(choices.volumes.action)) {
    reasons.push('替换或清空总纲时，分卷纲需同步替换或清空');
  }
  if ((choices.volumes.action === 'replace' || choices.volumes.action === 'clear') && final.chapters && !['replace', 'clear'].includes(choices.chapters.action)) {
    reasons.push('替换或清空分卷纲时，章纲需同步替换或清空');
  }

  return { final, reasons };
}
