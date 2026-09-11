import { describe, expect, it } from 'vitest';
import { simulateFinalEntityNames } from '../../../src/main/obsidian/entity-name-simulator';

describe('simulateFinalEntityNames：两阶段顺序无关（F4）', () => {
  const ab = [{ name: 'A' }, { name: 'B' }];

  it('交换改名 A→B、B→A 合法（不应报重名）', () => {
    const r = simulateFinalEntityNames('人物', ab, [
      { sourceName: 'A', name: 'B', overwrite: true },
      { sourceName: 'B', name: 'A', overwrite: true },
    ]);
    expect(r.error).toBeUndefined();
  });

  it('链式改名 A→B、B→C 合法（C 为新名字，不应报重名）', () => {
    const r = simulateFinalEntityNames('人物', ab, [
      { sourceName: 'A', name: 'B', overwrite: true },
      { sourceName: 'B', name: 'C', overwrite: true },
    ]);
    expect(r.error).toBeUndefined();
  });

  it('链式改名结果与输入顺序无关（A、B 正序与逆序结果一致）', () => {
    const a = simulateFinalEntityNames('人物', ab, [
      { sourceName: 'A', name: 'B', overwrite: true },
      { sourceName: 'B', name: 'C', overwrite: true },
    ]);
    const b = simulateFinalEntityNames('人物', ab, [
      { sourceName: 'B', name: 'C', overwrite: true },
      { sourceName: 'A', name: 'B', overwrite: true },
    ]);
    expect(a.error).toBeUndefined();
    expect(b.error).toBeUndefined();
  });

  it('世界观交换改名同样合法', () => {
    const r = simulateFinalEntityNames('世界观', ab, [
      { sourceName: 'A', name: 'B', overwrite: true },
      { sourceName: 'B', name: 'A', overwrite: true },
    ]);
    expect(r.error).toBeUndefined();
  });

  it('两个 create 改同名仍报重名（两阶段不影响冲突检测）', () => {
    const r = simulateFinalEntityNames('人物', [{ name: 'A' }], [
      { sourceName: 'X', name: 'Z', overwrite: false },
      { sourceName: 'Y', name: 'Z', overwrite: false },
    ]);
    expect(r.error).toContain('重名');
  });

  it('覆盖 A 改名为 B（B 未被释放）仍报重名', () => {
    const r = simulateFinalEntityNames('人物', [{ name: 'A' }, { name: 'B' }], [
      { sourceName: 'A', name: 'B', overwrite: true },
    ]);
    expect(r.error).toContain('重名');
  });
});
