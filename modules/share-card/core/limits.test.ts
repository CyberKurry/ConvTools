import { describe, expect, it } from 'vitest';
import {
  clampInput,
  EXCERPT_MAX_CHARS,
  SUMMARY_MAX_CHARS,
  TITLE_MAX_CHARS,
} from './limits';

describe('limits', () => {
  it('keeps inputs at or below the cap untouched', () => {
    const text = 'a'.repeat(EXCERPT_MAX_CHARS);
    expect(clampInput(text, EXCERPT_MAX_CHARS)).toEqual({ text, truncated: false });
  });

  it('cuts long input at a CJK punctuation boundary and appends an ellipsis', () => {
    const head = '前半句，'.repeat(50); // 200 chars of safe cut points
    const tail = '尾'.repeat(150);
    const input = head + tail;
    const result = clampInput(input, EXCERPT_MAX_CHARS);
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(EXCERPT_MAX_CHARS);
    expect(result.text.endsWith('…')).toBe(true);
    // The cut lands on a punctuation-safe boundary: the char before the
    // ellipsis is the comma after the 299th position's nearest safe point.
    expect('，。、；：！？）】」』》…—'.includes(result.text.at(-2) ?? '')).toBe(true);
  });

  it('cuts without a boundary by falling back to a hard cut plus ellipsis', () => {
    const input = 'x'.repeat(EXCERPT_MAX_CHARS + 40);
    const result = clampInput(input, EXCERPT_MAX_CHARS);
    expect(result.truncated).toBe(true);
    expect(result.text.endsWith('…')).toBe(true);
    expect(result.text.length).toBe(EXCERPT_MAX_CHARS);
  });

  it('caps titles and summaries at their own limits', () => {
    expect(clampInput('t'.repeat(TITLE_MAX_CHARS + 1), TITLE_MAX_CHARS).truncated).toBe(true);
    expect(clampInput('s'.repeat(SUMMARY_MAX_CHARS + 1), SUMMARY_MAX_CHARS).truncated).toBe(true);
  });

  it('never splits an emoji surrogate pair while applying the cap', () => {
    const result = clampInput('😀😀😀', 2);
    expect(result.text).toBe('😀…');
    expect([...result.text]).toEqual(['😀', '…']);
  });
});
