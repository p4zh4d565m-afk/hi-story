import { describe, expect, it } from 'vitest';
import { ContextBuilder } from '../../../src/main/ai/context-builder';
import type { OutlineNode } from '../../../src/renderer/types';

function mkNode(id: string, title: string, parentId: string | null = null): OutlineNode {
  return { id, projectId: 'p1', parentId, title, summary: '', sortOrder: 0, createdAt: '', updatedAt: '' };
}

describe('ContextBuilder（A4a：策划结构优先于 outlineNodes）', () => {
  it('有 planningContext 时注入策划块、跳过 outlineNodes', () => {
    const messages = ContextBuilder.build({
      project: { id: 'p1', name: '测试', typeTags: [], style: '', summary: '', obsidianPath: '', createdAt: '', updatedAt: '' },
      outlineNodes: [mkNode('n1', '大纲面板干扰标题')],
      planningContext: '## 全书结构（策划工作台）\n核心前提：策划前提',
    });
    const content = messages[0].content;
    expect(content).toContain('核心前提：策划前提');
    expect(content).not.toContain('大纲面板干扰标题');
  });

  it('无 planningContext 时仍走 outlineNodes（老项目回退）', () => {
    const messages = ContextBuilder.build({
      project: { id: 'p1', name: '测试', typeTags: [], style: '', summary: '', obsidianPath: '', createdAt: '', updatedAt: '' },
      outlineNodes: [mkNode('n1', '手写提纲节点')],
    });
    expect(messages[0].content).toContain('手写提纲节点');
  });
});
