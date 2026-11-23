import { describe, expect, it } from 'vitest';
import { encodeBytes } from '../../../modules/base64/core/encode';
import { processFileJob } from '../../../modules/base64/worker/process-file';
import type { FileJobRequest } from '../../../modules/base64/worker/protocol';

function encodeJob(bytes: readonly number[], format: FileJobRequest['format']): FileJobRequest {
  return {
    kind: 'encode',
    buffer: new Uint8Array(bytes).buffer,
    format,
    mode: 'tolerant',
  };
}

function decodeText(result: { chunks: readonly ArrayBuffer[] }): string {
  return new TextDecoder().decode(concat(result.chunks));
}

function concat(chunks: readonly ArrayBuffer[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }
  return out;
}

describe('file encode format handling (H1)', () => {
  it('produces URL-safe output without +, / or padding for format:"url"', () => {
    // Bytes chosen so standard Base64 would contain '+' (0xFB 0xFF -> "+//)
    // and require padding (4 bytes -> length 8 with '=').
    const result = processFileJob(encodeJob([0xfb, 0xff, 0xef, 0x01], 'url'));
    const text = decodeText(result);
    expect(text).toBe('-__vAQ'); // url-safe of "+//vAQ==", no padding
    expect(text).not.toMatch(/[+/=]/);
  });

  it('matches the shared text-path encoder for the same bytes (drift guard)', () => {
    const bytes = new Uint8Array([0xfb, 0xff, 0xef, 0x01, 0x80, 0x7f, 0x00, 0xff, 0xfe]);
    const fileText = decodeText(processFileJob(encodeJob([...bytes], 'url')));
    const textPath = encodeBytes(bytes, { format: 'url' });
    expect(fileText).toBe(textPath);
  });

  it('keeps data-url output canonical (standard alphabet + header)', () => {
    const result = processFileJob({
      ...encodeJob([0xfb, 0xff, 0xef, 0x01], 'data-url'),
      mime: 'image/png',
    });
    expect(decodeText(result)).toBe('data:image/png;base64,+//vAQ==');
  });

  it('keeps standard output unchanged', () => {
    const result = processFileJob(encodeJob([0xfb, 0xff, 0xef, 0x01], 'standard'));
    expect(decodeText(result)).toBe('+//vAQ==');
  });
});
