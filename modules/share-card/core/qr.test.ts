import { describe, expect, it } from 'vitest';
import qrcode from 'qrcode-generator';
import type { ShareCardInput } from './types';
import { buildQrMatrix, QrEncodeError } from './qr';

/**
 * Runs `buildQrMatrix` while recording the exact bytes the pinned encoder
 * receives, delegating to whatever `stringToBytes` the module configured.
 * This observes the production byte pipeline without replacing it.
 */
function captureEncodedBytes(text: string): { matrix: readonly boolean[][]; bytes: number[] } {
  const live = qrcode.stringToBytes.bind(qrcode);
  let bytes: number[] = [];
  qrcode.stringToBytes = (value: string) => {
    const encoded = live(value);
    if (value === text) {
      bytes = [...encoded];
    }
    return encoded;
  };
  try {
    return { matrix: buildQrMatrix(text), bytes };
  } finally {
    qrcode.stringToBytes = live;
  }
}

describe('buildQrMatrix', () => {
  it('encodes a url deterministically into a square boolean matrix', () => {
    const url = 'https://example.com/article?utm=x';
    const first = buildQrMatrix(url);
    const second = buildQrMatrix(url);
    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(20);
    expect(first.every((row) => row.length === first.length)).toBe(true);
    expect(first.some((row) => row.some((dark) => dark))).toBe(true);
  });

  it('encodes non-ascii text via utf-8 bytes', () => {
    const matrix = buildQrMatrix('https://例子.test/文章');
    expect(matrix.length).toBeGreaterThan(20);
  });

  it('does not truncate non-latin1 characters the way the library default does', () => {
    // The pinned library's default stringToBytes keeps (charCodeAt & 0xff),
    // so U+4E2D would collapse to 0x2D ('-') and encode the WRONG payload.
    // With the module's UTF-8 encoder the two inputs must differ.
    expect('中'.charCodeAt(0) & 0xff).toBe('-'.charCodeAt(0));
    expect(buildQrMatrix('https://ex.test/中')).not.toEqual(buildQrMatrix('https://ex.test/-'));
  });

  it('feeds real UTF-8 bytes to the encoder instead of charCode truncation (H7)', () => {
    // '例' is U+4F8B: UTF-8 is E4 BE 8B, while the library default
    // (`charCode & 0xFF`) would emit the single byte 8B.
    const { bytes } = captureEncodedBytes('例');
    expect(bytes).toEqual([...new TextEncoder().encode('例')]);
    expect(bytes).toEqual([0xe4, 0xbe, 0x8b]);
    expect(bytes).not.toEqual([0x8b]);
  });

  it('distinguishes characters that collide under charCode truncation (H7)', () => {
    // U+4F8B and U+008B both truncate to 0x8B; with UTF-8 they encode to
    // different byte sequences and therefore different matrices.
    expect(buildQrMatrix('例')).not.toEqual(buildQrMatrix('\u008b'));
  });

  it('rejects empty text with a typed error', () => {
    expect(() => buildQrMatrix('')).toThrow(QrEncodeError);
    expect(() => buildQrMatrix('   ')).toThrow(QrEncodeError);
  });

  it('accepts a valid ShareCardInput url round-trip', () => {
    const input: ShareCardInput = {
      version: 1,
      excerpt: 'x',
      title: null,
      summary: null,
      url: 'https://example.com/a',
      siteName: null,
    };
    expect(buildQrMatrix(input.url as string)).toEqual(buildQrMatrix('https://example.com/a'));
  });
});
