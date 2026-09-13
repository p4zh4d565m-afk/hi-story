import { describe, expect, it } from 'vitest';
import {
  OBSIDIAN_IMPORT_DEFAULT_LAYOUT,
  OBSIDIAN_IMPORT_MIN_PX,
  OBSIDIAN_IMPORT_SPLIT_IDS,
  shouldShowObsidianImportSplit,
} from '../../../src/renderer/components/obsidian-import-split';

describe('Obsidian 导入弹窗纵向分隔', () => {
  it('默认比例为上 65 / 下 35，且加总为 100', () => {
    expect(OBSIDIAN_IMPORT_DEFAULT_LAYOUT).toEqual({
      [OBSIDIAN_IMPORT_SPLIT_IDS.candidates]: 65,
      [OBSIDIAN_IMPORT_SPLIT_IDS.plan]: 35,
    });
    expect(
      OBSIDIAN_IMPORT_DEFAULT_LAYOUT[OBSIDIAN_IMPORT_SPLIT_IDS.candidates]
      + OBSIDIAN_IMPORT_DEFAULT_LAYOUT[OBSIDIAN_IMPORT_SPLIT_IDS.plan],
    ).toBe(100);
  });

  it('最小高度用像素，避免某一侧被拖没', () => {
    expect(OBSIDIAN_IMPORT_MIN_PX[OBSIDIAN_IMPORT_SPLIT_IDS.candidates]).toBe(180);
    expect(OBSIDIAN_IMPORT_MIN_PX[OBSIDIAN_IMPORT_SPLIT_IDS.plan]).toBe(160);
  });

  it('仅扫描完成后才挂分隔条，避免空 Group', () => {
    expect(shouldShowObsidianImportSplit({ hasPrepareResult: true, loading: false })).toBe(true);
    expect(shouldShowObsidianImportSplit({ hasPrepareResult: true, loading: true })).toBe(false);
    expect(shouldShowObsidianImportSplit({ hasPrepareResult: false, loading: false })).toBe(false);
    expect(shouldShowObsidianImportSplit({ hasPrepareResult: false, loading: true })).toBe(false);
  });
});
