import { describe, expect, it } from 'vitest';
import { decodeBase64, encodeBase64 } from './encode';
import { bytesToUtf8, utf8ToBytes } from './bytes';

describe('base64 text conversion', () => {
  it.each([
    ['', ''],
    ['hello', 'aGVsbG8='],
    ['你好', '5L2g5aW9'],
    ['😀', '8J+YgA=='],
  ])('encodes %j as standard Base64', (input, expected) => {
    expect(encodeBase64(input, { format: 'standard' })).toBe(expected);
  });

  it('encodes URL-safe Base64 without padding plus/slash', () => {
    expect(encodeBase64('>?', { format: 'url' })).toBe('Pj8');
    expect(encodeBase64('subjects?', { format: 'url' })).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('encodes a Data URL with the declared MIME', () => {
    expect(encodeBase64('hi', { format: 'data-url', mime: 'text/plain' })).toBe(
      'data:text/plain;base64,aGk=',
    );
  });

  it('decodes ASCII, Chinese, and emoji through UTF-8', () => {
    expect(decodeBase64('aGVsbG8=', 'tolerant').ok).toBe(true);
    const chinese = decodeBase64('5L2g5aW9', 'tolerant');
    expect(chinese.ok && chinese.text).toBe('你好');
    const emoji = decodeBase64('8J+YgA==', 'tolerant');
    expect(emoji.ok && emoji.text).toBe('😀');
  });

  it('decodes URL-safe alphabets and Data URLs', () => {
    const url = decodeBase64('c3ViamVjdHM_', 'tolerant');
    expect(url.ok && url.format).toBe('url');
    const dataUrl = decodeBase64('data:text/plain;base64,aGk=', 'tolerant');
    expect(dataUrl.ok && dataUrl.mime).toBe('text/plain');
    expect(dataUrl.ok && dataUrl.text).toBe('hi');
  });

  it('tolerant mode strips whitespace, maps URL-safe characters, and adds padding', () => {
    const result = decodeBase64(' aGVs bG8 ', 'tolerant');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.corrections.map((item) => item.code)).toContain('whitespace');
      expect(result.text).toBe('hello');
    }
    const padded = decodeBase64('aGk', 'tolerant');
    expect(padded.ok).toBe(true);
    if (padded.ok) {
      expect(padded.corrections.map((item) => item.code)).toContain('padding');
    }
  });

  it('strict mode rejects whitespace and invalid characters, and accepts the unpadded canonical URL-safe form', () => {
    expect(decodeBase64('aGVs bG8=', 'strict').ok).toBe(false);
    // Unpadded "aGk" is the canonical URL-safe Base64 form (RFC 4648 §5):
    // the module's own URL-safe encoder emits exactly this shape and strict
    // mode must decode its own output (encode/decode symmetry).
    const urlSafe = decodeBase64('aGk', 'strict');
    expect(urlSafe.ok).toBe(true);
    if (urlSafe.ok) {
      expect(urlSafe.format).toBe('url');
      expect(urlSafe.text).toBe('hi');
    }
    const invalid = decodeBase64('!!!!', 'strict');
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.index).toBe(0);
    }
  });

  it('rejects malformed Data URL headers and never executes decoded content', () => {
    const result = decodeBase64('data:text/html;base64', 'tolerant');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('INVALID_DATA_URL');
    }
  });

  it('uses TextEncoder/TextDecoder rather than btoa on Unicode', () => {
    expect(utf8ToBytes('你好')).toEqual(new TextEncoder().encode('你好'));
    expect(bytesToUtf8(utf8ToBytes('你好'))).toBe('你好');
  });

  it('reports empty input', () => {
    const result = decodeBase64('', 'strict');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('EMPTY');
    }
  });

  it.each(['====', 'Q=Q=', 'QQ=', 'A==='])('rejects misplaced padding %j in strict mode', (input) => {
    const result = decodeBase64(input, 'strict');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(['INVALID_CHARACTER', 'INVALID_PADDING', 'INVALID_LENGTH']).toContain(result.code);
    }
  });

  it('accepts canonical padding in strict mode', () => {
    expect(decodeBase64('QQ==', 'strict').ok).toBe(true);
    expect(decodeBase64('aGVsbG8=', 'strict').ok).toBe(true);
  });

  it('rejects all-padding payloads in tolerant mode', () => {
    const result = decodeBase64('====', 'tolerant');
    expect(result.ok).toBe(false);
  });

  it('rejects misplaced padding in tolerant mode instead of silently moving it', () => {
    const result = decodeBase64('Q=Q=', 'tolerant');
    expect(result.ok).toBe(false);
  });

  it('keeps tolerant whitespace cleanup to the ASCII set', () => {
    // U+00A0 is not ASCII whitespace and must not be silently stripped.
    const result = decodeBase64('QQ\u00A0==', 'tolerant');
    expect(result.ok).toBe(false);
  });

  it('still strips ASCII whitespace in tolerant mode', () => {
    const result = decodeBase64('aG Vs\nbG8=', 'tolerant');
    expect(result.ok && result.text).toBe('hello');
  });
});

describe('base64 normalization edge cases (ultrareview batch 3)', () => {
  it('does not report a padding correction for already canonical input', () => {
    for (const input of ['aGVsbG8=', 'YQ==', 'QQ==', 'aGk=', '5L2g5aW9', 'Pj8=']) {
      const result = decodeBase64(input, 'tolerant');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.corrections.map((item) => item.code)).not.toContain('padding');
      }
    }
  });

  it('still pads genuinely missing padding in tolerant mode', () => {
    const result = decodeBase64('aGVsbG8', 'tolerant');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.corrections.map((item) => item.code)).toContain('padding');
      expect(result.text).toBe('hello');
    }
  });

  it('reports EMPTY for an empty Data URL payload in both modes', () => {
    for (const mode of ['tolerant', 'strict'] as const) {
      const result = decodeBase64('data:text/plain;base64,', mode);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('EMPTY');
      }
    }
  });

  it('recognizes a Data URL with leading whitespace in tolerant mode', () => {
    const result = decodeBase64('  data:text/plain;base64,aGk=', 'tolerant');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.format).toBe('data-url');
      expect(result.mime).toBe('text/plain');
      expect(result.text).toBe('hi');
      expect(result.corrections.map((item) => item.code)).toContain('whitespace');
    }
  });

  it('rejects URL-safe characters inside a strict-mode Data URL with a precise index', () => {
    const result = decodeBase64('data:application/octet-stream;base64,a-b_', 'strict');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('INVALID_CHARACTER');
      expect(result.index).toBe(38); // header is 37 chars, '-' is the 2nd payload char
    }
  });

  it('repairs URL-safe characters inside a tolerant-mode Data URL like the file path', () => {
    // Same input must decode on both surfaces: the file path already accepted
    // URL-safe payloads inside Data URLs in tolerant mode.
    const result = decodeBase64('data:application/octet-stream;base64,a-b_', 'tolerant');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.format).toBe('data-url');
      expect(result.corrections.map((item) => item.code)).toContain('url-alphabet');
    }
  });

  it('keeps strict-mode plain URL-safe input decodable via format detection', () => {
    const result = decodeBase64('c3ViamVjdHM_', 'strict');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.format).toBe('url');
      expect(result.text).toBe('subjects?');
    }
  });

  it('rejects non-zero pad bits and mixed alphabets in strict mode', () => {
    expect(decodeBase64('AB==', 'strict').ok).toBe(false);
    expect(decodeBase64('a+b-', 'strict').ok).toBe(false);
  });
});
