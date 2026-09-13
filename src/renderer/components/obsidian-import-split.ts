// Obsidian 导入弹窗上下分隔：只定默认比例与何时挂 Group，不持久化。

export const OBSIDIAN_IMPORT_SPLIT_IDS = {
  group: 'obsidian-import-split-v',
  candidates: 'candidates',
  plan: 'plan',
} as const;

// Group.defaultLayout 的数字是 0–100 的百分比，不是像素。
export const OBSIDIAN_IMPORT_DEFAULT_LAYOUT = {
  [OBSIDIAN_IMPORT_SPLIT_IDS.candidates]: 65,
  [OBSIDIAN_IMPORT_SPLIT_IDS.plan]: 35,
} as const;

// Panel.minSize 的数字是像素（和 defaultLayout 不同）。
export const OBSIDIAN_IMPORT_MIN_PX = {
  [OBSIDIAN_IMPORT_SPLIT_IDS.candidates]: 180,
  [OBSIDIAN_IMPORT_SPLIT_IDS.plan]: 160,
} as const;

/** 扫描完成后才挂纵向 Group；扫描中/失败只留页脚，避免空分隔条。 */
export function shouldShowObsidianImportSplit(opts: {
  hasPrepareResult: boolean;
  loading: boolean;
}): boolean {
  return opts.hasPrepareResult && !opts.loading;
}
