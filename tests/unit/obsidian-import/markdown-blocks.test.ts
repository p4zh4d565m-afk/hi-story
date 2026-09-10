import { describe, expect, it } from 'vitest';
import { parseMarkdownBlocks, parseMarkdownTable } from '../../../src/main/obsidian/markdown-blocks';

describe('Markdown 块结构解析', () => {
  it('识别标题、段落、键值列表、加粗标签与嵌套列表', () => {
    const src = [
      '## 核心前提',
      '一个失去记忆的人必须查清身份。',
      '',
      '- 目标：找出叛徒',
      '- 高潮: 主角公开证据',
      '',
      '**章末钩子**：门外出现了本应死去的人。',
      '',
      '## 关键事件',
      '- 事件一',
      '  - 细节甲',
      '- 事件二',
    ].join('\n');
    const blocks = parseMarkdownBlocks(src);
    expect(blocks[0]).toEqual({ type: 'heading', level: 2, text: '核心前提' });
    expect(blocks[1]).toEqual({ type: 'paragraph', text: '一个失去记忆的人必须查清身份。' });
    expect(blocks[2]).toEqual({ type: 'list', items: [
      { text: '目标：找出叛徒', depth: 0 },
      { text: '高潮: 主角公开证据', depth: 0 },
    ]});
    expect(blocks[3]).toEqual({ type: 'boldLabel', label: '章末钩子', value: '门外出现了本应死去的人。' });
    expect(blocks[5]).toEqual({ type: 'list', items: [
      { text: '事件一', depth: 0 },
      { text: '细节甲', depth: 1 },
      { text: '事件二', depth: 0 },
    ]});
  });

  it('解析 markdown 表格为表头+行', () => {
    const src = [
      '| 章 | 标题 | 核心事件 | 爽点 | 钩子 |',
      '|---|------|---------|-----------|-----------|',
      '| 1 | 初见 | 帕莎游轮顶层宴会。 | 飞刀镇场。 | 雅座里的omega是谁？ |',
      '| 2 | 调戏？ | 米悦悦主动撩陈城。 | 猎手反转让陈城措手不及。 | 米悦悦为什么要接近陈城？ |',
    ].join('\n');
    const table = parseMarkdownTable(src);
    expect(table).toEqual({
      headers: ['章', '标题', '核心事件', '爽点', '钩子'],
      rows: [
        ['1', '初见', '帕莎游轮顶层宴会。', '飞刀镇场。', '雅座里的omega是谁？'],
        ['2', '调戏？', '米悦悦主动撩陈城。', '猎手反转让陈城措手不及。', '米悦悦为什么要接近陈城？'],
      ],
    });
  });

  it('表格单元格内嵌竖线按转义保留', () => {
    const src = '| 章 | 标题 |\n|---|---|\n| 1 | 甲\\|乙 |';
    expect(parseMarkdownTable(src).rows[0]).toEqual(['1', '甲|乙']);
  });
});
