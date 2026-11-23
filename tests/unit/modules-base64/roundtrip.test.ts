import { describe, expect, it } from 'vitest';
import { decodeBase64, encodeBase64 } from '../../../modules/base64/core/encode';

describe('encode/decode symmetry (M3)', () => {
  it('round-trips its own URL-safe output in strict mode', () => {
    for (const input of ['a', 'ab', 'abc', 'abcd', '你好，世界', 'Pj8>?']) {
      const encoded = encodeBase64(input, { format: 'url' });
      const decoded = decodeBase64(encoded, 'strict');
      expect(decoded.ok, `input ${input} -> ${encoded}`).toBe(true);
      if (decoded.ok) {
        expect(decoded.text).toBe(input);
        // 'url' when URL-safe characters or the unpadded shape identify it;
        // a multiple-of-4 alphanumeric payload is indistinguishable from
        // canonical standard and may be reported as either.
        expect(['url', 'standard']).toContain(decoded.format);
      }
    }
  });

  it('round-trips its own standard and Data URL outputs in strict mode', () => {
    const standard = encodeBase64('hello', { format: 'standard' });
    expect(decodeBase64(standard, 'strict').ok).toBe(true);
    const dataUrl = encodeBase64('hello', { format: 'data-url', mime: 'text/plain' });
    const decoded = decodeBase64(dataUrl, 'strict');
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.text).toBe('hello');
      expect(decoded.mime).toBe('text/plain');
    }
  });
});
