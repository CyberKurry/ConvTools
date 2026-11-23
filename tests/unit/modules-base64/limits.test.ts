import { describe, expect, it } from 'vitest';
import { exceedsInputLimit, MAX_INPUT_BYTES, utf8ByteLength } from '../../../modules/base64/core/limits';

describe('base64 text input limits', () => {
  it('counts UTF-8 bytes, not UTF-16 units', () => {
    expect(utf8ByteLength('abc')).toBe(3);
    expect(utf8ByteLength('例子')).toBe(6);
    expect(utf8ByteLength('😀')).toBe(4);
  });

  it('accepts input at the limit and rejects one byte over', () => {
    expect(exceedsInputLimit('abc', 3)).toBe(false);
    expect(exceedsInputLimit('abc', 2)).toBe(true);
    expect(exceedsInputLimit('例子', 6)).toBe(false);
    expect(exceedsInputLimit('例子', 5)).toBe(true);
  });

  it('rejects by length alone once the units cannot fit any encoding', () => {
    // 11 units against a 10-byte budget: even one byte per unit overflows.
    expect(exceedsInputLimit('a'.repeat(11), 10)).toBe(true);
  });

  it('shares the file hard limit', () => {
    expect(MAX_INPUT_BYTES).toBe(50 * 1024 * 1024);
  });
});
