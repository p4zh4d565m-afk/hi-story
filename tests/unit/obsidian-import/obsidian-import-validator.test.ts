import { describe, expect, it } from 'vitest';
import { validateObsidianCommitInput } from '../../../src/main/obsidian/import-validator';
import type { ObsidianCommitInput } from '../../../src/renderer/types';

/** 合法输入基准，每个测试只改一个字段制造单变量缺陷。 */
function validInput(): ObsidianCommitInput {
  return {
    projectId: 'p1',
    operationId: 'op-1',
    selections: [
      {
        relativePath: 'a.md',
        hash: 'a'.repeat(64),
        slots: ['master'],
        defaultVolumeIndex: null,
        characterOverrides: [],
        worldOverrides: [],
      },
    ],
    layerChoices: {
      master: { action: 'keep', unlockLocked: false },
      volumes: { action: 'keep', unlockLocked: false },
      chapters: { action: 'keep', unlockLocked: false },
    },
  };
}

describe('validateObsidianCommitInput：运行时 DTO 逐层校验', () => {
  it('合法输入返回 valid: true 并保留 value', () => {
    const input = validInput();
    const r = validateObsidianCommitInput(input);
    expect(r).toEqual({ valid: true, value: input });
  });

  it('根输入非普通对象被拒绝', () => {
    expect(validateObsidianCommitInput(null)).toMatchObject({ valid: false });
    expect(validateObsidianCommitInput(undefined)).toMatchObject({ valid: false });
    expect(validateObsidianCommitInput('x')).toMatchObject({ valid: false });
    expect(validateObsidianCommitInput([1, 2])).toMatchObject({ valid: false });
  });

  it('projectId 缺失 / 空白被明确拒绝', () => {
    const r = validateObsidianCommitInput({ ...validInput(), projectId: '   ' });
    expect(r).toMatchObject({ valid: false });
    expect((r as { error: string }).error).toContain('projectId');

    const missing = validateObsidianCommitInput({ ...validInput(), projectId: undefined as unknown as string });
    expect(missing).toMatchObject({ valid: false });
    expect((missing as { error: string }).error).toContain('projectId');
  });

  it('selections 为 undefined 被明确拒绝，报 selections 参数错误', () => {
    const r = validateObsidianCommitInput({ ...validInput(), selections: undefined as unknown as ObsidianCommitInput['selections'] });
    expect(r).toMatchObject({ valid: false });
    expect((r as { error: string }).error).toContain('selections');
  });

  it('operationId 空 / 超长被拒绝', () => {
    expect(validateObsidianCommitInput({ ...validInput(), operationId: '' })).toMatchObject({ valid: false });
    expect(validateObsidianCommitInput({ ...validInput(), operationId: 'x'.repeat(201) })).toMatchObject({ valid: false });
  });

  it('selections 非数组 / 超过 500 被拒绝', () => {
    expect(validateObsidianCommitInput({ ...validInput(), selections: {} as any })).toMatchObject({ valid: false });
    const tooMany = Array.from({ length: 501 }, () => validInput().selections[0]);
    expect(validateObsidianCommitInput({ ...validInput(), selections: tooMany })).toMatchObject({ valid: false });
  });

  it('hash 非 64 位小写十六进制被拒绝', () => {
    const input = validInput();
    input.selections[0].hash = 'ABC';
    expect(validateObsidianCommitInput(input)).toMatchObject({ valid: false });
    input.selections[0].hash = 'g'.repeat(64);
    expect(validateObsidianCommitInput(input)).toMatchObject({ valid: false });
    input.selections[0].hash = 'A'.repeat(64);
    expect(validateObsidianCommitInput(input)).toMatchObject({ valid: false });
  });

  it('slots 含非法元素 / 重复被拒绝', () => {
    const input = validInput();
    input.selections[0].slots = ['master', 'bogus'] as any;
    expect(validateObsidianCommitInput(input)).toMatchObject({ valid: false });
    input.selections[0].slots = ['master', 'master'];
    expect(validateObsidianCommitInput(input)).toMatchObject({ valid: false });
  });

  it('defaultVolumeIndex 负数 / 非整数 / 字符串被拒绝', () => {
    const input = validInput();
    input.selections[0].defaultVolumeIndex = -1;
    expect(validateObsidianCommitInput(input)).toMatchObject({ valid: false });
    input.selections[0].defaultVolumeIndex = 1.5;
    expect(validateObsidianCommitInput(input)).toMatchObject({ valid: false });
    input.selections[0].defaultVolumeIndex = '1' as any;
    expect(validateObsidianCommitInput(input)).toMatchObject({ valid: false });
  });

  it('人物 override 字段类型错误被拒绝', () => {
    const input = validInput();
    input.selections[0].characterOverrides = [{ sourceName: 'a', name: 1 as any, overwrite: false }];
    expect(validateObsidianCommitInput(input)).toMatchObject({ valid: false });
    input.selections[0].characterOverrides = [{ sourceName: 'a', name: 'b', overwrite: 'yes' as any }];
    expect(validateObsidianCommitInput(input)).toMatchObject({ valid: false });
    input.selections[0].characterOverrides = 'x' as any;
    expect(validateObsidianCommitInput(input)).toMatchObject({ valid: false });
  });

  it('世界观 override category 非法枚举被拒绝', () => {
    const input = validInput();
    input.selections[0].worldOverrides = [{ sourceName: 'w', name: 'w', category: 'bogus' as any, overwrite: false }];
    expect(validateObsidianCommitInput(input)).toMatchObject({ valid: false });
  });

  it('relativePath 空字符串被拒绝', () => {
    const input = validInput();
    input.selections[0].relativePath = '   ';
    const r = validateObsidianCommitInput(input);
    expect(r).toMatchObject({ valid: false });
    expect((r as { error: string }).error).toContain('relativePath');
  });

  it('世界观 override 非数组 / sourceName/name 非字符串 / overwrite 非布尔被拒绝', () => {
    const input = validInput();
    input.selections[0].worldOverrides = 'x' as any;
    expect(validateObsidianCommitInput(input)).toMatchObject({ valid: false });
    input.selections[0].worldOverrides = [{ sourceName: 1 as any, name: 'w', category: 'place', overwrite: false }];
    expect(validateObsidianCommitInput(input)).toMatchObject({ valid: false });
    input.selections[0].worldOverrides = [{ sourceName: 'w', name: 'w', category: 'place', overwrite: 'yes' as any }];
    expect(validateObsidianCommitInput(input)).toMatchObject({ valid: false });
  });

  it('selection 缺少 characterOverrides 字段被拒绝', () => {
    const input = validInput();
    const { characterOverrides, ...rest } = input.selections[0];
    input.selections[0] = rest as any;
    const r = validateObsidianCommitInput(input);
    expect(r).toMatchObject({ valid: false });
    expect((r as { error: string }).error).toContain('characterOverrides');
  });

  it('selection 缺少 worldOverrides 字段被拒绝', () => {
    const input = validInput();
    const { worldOverrides, ...rest } = input.selections[0];
    input.selections[0] = rest as any;
    const r = validateObsidianCommitInput(input);
    expect(r).toMatchObject({ valid: false });
    expect((r as { error: string }).error).toContain('worldOverrides');
  });

  it('layerChoices 缺层 / action 非法 / unlockLocked 非布尔被拒绝', () => {
    const input = validInput();
    const { volumes, ...noVolumes } = input.layerChoices;
    expect(validateObsidianCommitInput({ ...validInput(), layerChoices: noVolumes as any })).toMatchObject({ valid: false });

    input.layerChoices.master.action = 'delete' as any;
    expect(validateObsidianCommitInput(input)).toMatchObject({ valid: false });

    const reset = validInput();
    reset.layerChoices.master.unlockLocked = 'yes' as any;
    expect(validateObsidianCommitInput(reset)).toMatchObject({ valid: false });
  });

  it('storyOptionDraft 字段非字符串被拒绝', () => {
    const input = validInput();
    input.storyOptionDraft = { title: 123 } as any;
    expect(validateObsidianCommitInput(input)).toMatchObject({ valid: false });
  });
});
