import { describe, expect, it } from 'vitest';
import { ContextBuilder } from '../../../src/main/ai/context-builder';
import type { ObsidianDocument } from '../../../src/renderer/types';

function document(index: number, content: string): ObsidianDocument {
  return {
    id: `人物/角色${index}.md`,
    kind: 'character',
    name: `角色${index}`,
    relativePath: `人物/角色${index}.md`,
    content,
    frontmatter: {},
    updatedAt: '2026-09-08T00:00:00.000Z',
  };
}

describe('Obsidian AI 上下文', () => {
  it('明确标注只读来源并限制上下文长度', () => {
    const documents = Array.from({ length: 30 }, (_, index) => (
      document(index, `${'这是人物的长期设定。'.repeat(500)}尾部标记-${index}`)
    ));

    const context = ContextBuilder.getObsidianContext(documents);

    expect(context).toContain('Obsidian');
    expect(context).toContain('只读');
    expect(context).toContain('角色0');
    expect(ContextBuilder.estimateTokens(context || '')).toBeLessThanOrEqual(3500);
    expect(context).not.toContain('尾部标记-29');
  });

  it('build 将 Obsidian 资料加入聊天系统上下文', () => {
    const messages = ContextBuilder.build({ obsidianDocuments: [document(0, '主角不能使用法术。')] });

    expect(messages[0].content).toContain('主角不能使用法术');
    expect(messages[0].content).toContain('冲突时优先参考 Obsidian');
  });

  it('大量人物资料不会挤掉世界观和长期大纲', () => {
    const characters = Array.from({ length: 20 }, (_, index) => document(index, '人物设定。'.repeat(500)));
    const world: ObsidianDocument = { ...document(100, '世界规则。'), id: '世界观/规则.md', kind: 'world', name: '世界规则', relativePath: '世界观/规则.md' };
    const outline: ObsidianDocument = { ...document(101, '最终走向。'), id: '大纲/主线.md', kind: 'outline', name: '主线大纲', relativePath: '大纲/主线.md' };

    const context = ContextBuilder.getObsidianContext([...characters, world, outline]);

    expect(context).toContain('世界规则');
    expect(context).toContain('主线大纲');
    expect(ContextBuilder.estimateTokens(context || '')).toBeLessThanOrEqual(3500);
  });
});
