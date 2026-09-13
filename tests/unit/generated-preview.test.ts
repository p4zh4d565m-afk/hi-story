import { describe, it, expect } from 'vitest';
import { splitGeneratedPreviewBlocks } from '../../src/renderer/services/ai/generated-preview';

describe('splitGeneratedPreviewBlocks', () => {
  it('多段 p 抽出文本节点，解码常见实体', () => {
    const html = '<p>第一段&lt;秘&gt;</p><p>第二段&amp;续</p>';
    expect(splitGeneratedPreviewBlocks(html)).toEqual([
      { kind: 'paragraph', text: '第一段<秘>' },
      { kind: 'paragraph', text: '第二段&续' },
    ]);
  });

  it('无 p 标签时整份 fallback，不把 a<b 当标签吃掉', () => {
    expect(splitGeneratedPreviewBlocks('a<b>c')).toEqual([
      { kind: 'fallback', text: 'a<b>c' },
    ]);
  });

  it('空字符串得到空数组', () => {
    expect(splitGeneratedPreviewBlocks('')).toEqual([]);
  });

  it('流式未闭合 p 尾段也立即显示', () => {
    expect(splitGeneratedPreviewBlocks('<p>第一段</p><p>第二段正在生成')).toEqual([
      { kind: 'paragraph', text: '第一段' },
      { kind: 'paragraph', text: '第二段正在生成' },
    ]);
  });

  it('p 外的前缀和尾随不得静默丢失', () => {
    expect(splitGeneratedPreviewBlocks('前言<p>正文</p>尾声')).toEqual([
      { kind: 'fallback', text: '前言' },
      { kind: 'paragraph', text: '正文' },
      { kind: 'fallback', text: '尾声' },
    ]);
    expect(splitGeneratedPreviewBlocks('<p>一</p>间隙<p>二')).toEqual([
      { kind: 'paragraph', text: '一' },
      { kind: 'fallback', text: '间隙<p>二' },
    ]);
  });

  it('段内 br 转换换行，其他标签不作为 markup 输出', () => {
    expect(splitGeneratedPreviewBlocks('<p><strong>正文</strong><br>续&amp;下</p>')).toEqual([
      { kind: 'paragraph', text: '正文\n续&下' },
    ]);
    expect(splitGeneratedPreviewBlocks('<p><img src=x onerror=alert(1)>正文</p>')).toEqual([
      { kind: 'paragraph', text: '正文' },
    ]);
  });
});
