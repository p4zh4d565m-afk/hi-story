import { describe, it, expect } from 'vitest';
import {
  normalizeChapterText,
  shouldBumpContentGeneration,
} from '../../src/main/ai/content-revision';

describe('normalizeChapterText — 规范化纯文本', () => {
  it('空串返回空', () => {
    expect(normalizeChapterText('')).toBe('');
    expect(normalizeChapterText('<p></p>')).toBe('');
  });

  it('去 HTML 标签、合并空白', () => {
    expect(normalizeChapterText('<p>他 推开  了门</p>')).toBe('他 推开 了门');
  });

  it('换行/段落差异收成单空格', () => {
    expect(normalizeChapterText('<p>甲</p><p>乙</p>')).toBe('甲 乙');
    expect(normalizeChapterText('甲<br>乙')).toBe('甲 乙');
    expect(normalizeChapterText('甲\n\n乙')).toBe('甲 乙');
  });

  it('解码常见 HTML 实体', () => {
    expect(normalizeChapterText('<p>甲&amp;乙</p>')).toBe('甲&乙');
    expect(normalizeChapterText('<p>&lt;秘密&gt;</p>')).toBe('<秘密>');
    expect(normalizeChapterText('<p>说&#39;话&#39;</p>')).toBe("说'话'");
  });
});

describe('shouldBumpContentGeneration — 世代递增判据', () => {
  it('等价 HTML（标签/空段落不同但汉字相同）不递增', () => {
    expect(shouldBumpContentGeneration('<p>甲</p>', '<p>甲</p><p></p>')).toBe(false);
    expect(shouldBumpContentGeneration('<p>甲</p><p>乙</p>', '<p>甲</p><br><p>乙</p>')).toBe(false);
    // 标签顺序/加粗不同、纯文本一致 → 不递增
    expect(shouldBumpContentGeneration('<p>甲<strong>乙</strong></p>', '<p><strong>甲</strong>乙</p>')).toBe(false);
  });

  it('改一个汉字递增', () => {
    expect(shouldBumpContentGeneration('<p>甲</p>', '<p>乙</p>')).toBe(true);
  });

  it('改一个标点递增', () => {
    expect(shouldBumpContentGeneration('<p>他说。</p>', '<p>他说！</p>')).toBe(true);
  });

  it('只改空白/换行不递增（合并空白后相同）', () => {
    expect(shouldBumpContentGeneration('<p>甲</p><p>乙</p>', '甲\n\n乙')).toBe(false);
  });

  it('相同内容不递增', () => {
    expect(shouldBumpContentGeneration('<p>甲</p>', '<p>甲</p>')).toBe(false);
  });
});
