import { describe, expect, it } from 'vitest';
import { mergeCharacterOverrides, mergeWorldOverrides } from '../../../src/main/obsidian/override-merge';
import type { ImportCharacterOverride, ImportWorldOverride } from '../../../src/renderer/types';

describe('override 合并（R5 统一归一化 source key）', () => {
  it('sourceName 的 NFKC 变体仍保留作者 override（人物）', () => {
    // 旧 override 的 sourceName 是全角「Ａ」；新 draft 的 sourceName 是半角「A」。
    // 归一化后相同，应保留作者编辑的 name。
    const old: ImportCharacterOverride[] = [{ sourceName: 'Ａ', name: '作者改的名', overwrite: true }];
    const newDrafts = [{ sourceName: 'A', name: 'A', overwrite: false }];
    const merged = mergeCharacterOverrides(old, newDrafts as any);
    expect(merged).toEqual([{ sourceName: 'A', name: '作者改的名', overwrite: true }]);
  });

  it('sourceName 的 NFKC 变体仍保留作者 override（世界观）', () => {
    const old: ImportWorldOverride[] = [{ sourceName: '星　海', name: '作者改名', category: 'place', overwrite: true }];
    const newDrafts = [{ sourceName: '星 海', name: '星 海', category: null as any, overwrite: false }];
    const merged = mergeWorldOverrides(old, newDrafts as any);
    expect(merged).toEqual([{ sourceName: '星 海', name: '作者改名', category: 'place', overwrite: true }]);
  });

  it('已消失 sourceName 被移除，新 sourceName 使用默认值（人物）', () => {
    const old: ImportCharacterOverride[] = [
      { sourceName: '已消失', name: '旧', overwrite: true },
    ];
    const newDrafts = [{ sourceName: '新人物', name: '新人物', overwrite: false }];
    const merged = mergeCharacterOverrides(old, newDrafts as any);
    expect(merged).toEqual([{ sourceName: '新人物', name: '新人物', overwrite: false }]);
  });

  it('大小写变体 sourceName 仍匹配（人物）', () => {
    const old: ImportCharacterOverride[] = [{ sourceName: 'LIN', name: '林', overwrite: true }];
    const newDrafts = [{ sourceName: 'lin', name: 'lin', overwrite: false }];
    const merged = mergeCharacterOverrides(old, newDrafts as any);
    expect(merged).toEqual([{ sourceName: 'lin', name: '林', overwrite: true }]);
  });

  it('世界观 category 保留作者选择而非 parser 默认', () => {
    const old: ImportWorldOverride[] = [{ sourceName: 'w', name: 'w', category: 'faction', overwrite: false }];
    const newDrafts = [{ sourceName: 'w', name: 'w', category: 'place', overwrite: false }];
    const merged = mergeWorldOverrides(old, newDrafts as any);
    expect(merged).toEqual([{ sourceName: 'w', name: 'w', category: 'faction', overwrite: false }]);
  });
});
