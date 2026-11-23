import { describe, expect, it } from 'vitest';
import { layoutParagraph, type Measure } from './text-layout';

// Deterministic fake metrics: 10px per latin/digit char, 20px per CJK char,
// whitespace 10px. Font argument is ignored.
const measure: Measure = (text) => {
  let width = 0;
  for (const char of text) {
    width += /[\u2E80-\u9FFF\u3000-\u303F\uFF00-\uFFEF]/.test(char) ? 20 : 10;
  }
  return width;
};

describe('layoutParagraph', () => {
  it('keeps a short paragraph on one line untruncated', () => {
    const result = layoutParagraph('hello world', 'f', 200, 3, measure);
    expect(result).toEqual({ lines: ['hello world'], truncated: false });
  });

  it('wraps latin text at word boundaries', () => {
    const result = layoutParagraph('alpha beta gamma', 'f', 120, 5, measure);
    expect(result.lines).toEqual(['alpha beta', 'gamma']);
    expect(result.truncated).toBe(false);
  });

  it('wraps CJK text per character', () => {
    const result = layoutParagraph('一二三四五六', 'f', 80, 5, measure); // 4 chars per line
    expect(result.lines).toEqual(['一二三四', '五六']);
  });

  it('keeps forbidden leading punctuation attached to the previous line', () => {
    // The comma after "四" may not start a line: it hangs on line one.
    const result = layoutParagraph('一二三四，五六', 'f', 80, 5, measure);
    expect(result.lines[0]).toBe('一二三四，');
    expect(result.lines[1]).toBe('五六');
  });

  it('keeps forbidden trailing brackets off line ends', () => {
    // "三「" fits on line one but the bracket may not end it: it moves down
    // together with the next character.
    const result = layoutParagraph('一二三「四五', 'f', 80, 5, measure);
    expect(result.lines[0]).toBe('一二三');
    expect(result.lines[1]).toBe('「四五');
  });

  it('collapses leading whitespace on wrapped lines', () => {
    const result = layoutParagraph('alpha    beta', 'f', 100, 5, measure);
    expect(result.lines.join('|')).not.toContain('| ');
    expect(result.lines[0]).toBe('alpha');
  });

  it('truncates with an ellipsis when lines exceed the cap', () => {
    const result = layoutParagraph('一二三四五六七八九十'.repeat(2), 'f', 80, 2, measure);
    expect(result.truncated).toBe(true);
    expect(result.lines).toHaveLength(2);
    expect(result.lines[1]?.endsWith('…')).toBe(true);
  });

  it('never splits a surrogate-pair emoji across lines', () => {
    const result = layoutParagraph('ab🙂cd', 'f', 50, 4, measure);
    const joined = result.lines.join('');
    expect(joined).toContain('🙂');
  });

  it('hard-wraps a long Latin token within the measured width', () => {
    const result = layoutParagraph('abcdefghijklmnop', 'f', 50, 8, measure);
    expect(result.lines).toEqual(['abcde', 'fghij', 'klmno', 'p']);
    expect(result.lines.every((line) => measure(line, 'f') <= 50)).toBe(true);
  });

  it('hard-wraps a long Latin token after an earlier word', () => {
    const result = layoutParagraph('x abcdefghijklmnop', 'f', 50, 8, measure);
    expect(result.lines).toEqual(['x', 'abcde', 'fghij', 'klmno', 'p']);
    expect(result.lines.every((line) => measure(line, 'f') <= 50)).toBe(true);
  });

  it('fits the ellipsis into the final line width', () => {
    const result = layoutParagraph('abcdefghijk', 'f', 50, 1, measure);
    expect(result.lines[0]).toBe('abcd…');
    expect(measure(result.lines[0] ?? '', 'f')).toBeLessThanOrEqual(50);
  });
});
