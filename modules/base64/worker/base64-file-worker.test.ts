import { describe, expect, it } from 'vitest';
import { encodeBase64, encodeBytes } from '../core/encode';
import { assertFileSize, FileTooLargeError, processFileJob } from './process-file';
import { MAX_FILE_BYTES, type FileJobRequest } from './protocol';

describe('base64 file worker processing', () => {
  it('rejects files above 50 MB before processing', () => {
    const buffer = new ArrayBuffer(MAX_FILE_BYTES + 1);
    expect(() =>
      processFileJob({
        kind: 'encode',
        buffer,
        format: 'standard',
        mode: 'strict',
      }),
    ).toThrow(FileTooLargeError);
  });

  it('accepts a file at the exact 50 MB limit boundary', () => {
    expect(() => assertFileSize(MAX_FILE_BYTES)).not.toThrow();
    expect(() => assertFileSize(MAX_FILE_BYTES + 1)).toThrow(FileTooLargeError);
  });

  it.each([1, 2, 3, 4])('encodes chunk boundaries at %i bytes', (size) => {
    const bytes = Uint8Array.from({ length: size }, (_, index) => index + 1);
    const result = processFileJob({
      kind: 'encode',
      buffer: bytes.buffer,
      format: 'standard',
      mode: 'strict',
      chunkSize: 1,
    });
    const encoded = result.chunks.map((chunk) => new TextDecoder().decode(chunk)).join('');
    const expected = encodeBase64(new TextDecoder().decode(bytes), { format: 'standard' });
    expect(encoded).toBe(expected);
    expect(result.maxWorkingChunkBytes).toBeGreaterThanOrEqual(1);
  });

  it('preserves binary bytes when an input chunk splits every possible carry length', () => {
    const bytes = Uint8Array.from({ length: 17 }, (_, index) => (index * 29) & 0xff);
    const result = processFileJob({
      kind: 'encode',
      buffer: bytes.buffer,
      format: 'standard',
      mode: 'strict',
      chunkSize: 2,
    });
    expect(result.chunks.map((chunk) => new TextDecoder().decode(chunk)).join('')).toBe(
      encodeBytes(bytes, { format: 'standard' }),
    );
  });

  it('reports monotonic progress', () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const progress: number[] = [];
    processFileJob(
      {
        kind: 'encode',
        buffer: bytes.buffer,
        format: 'standard',
        mode: 'strict',
        chunkSize: 2,
      },
      (event) => progress.push(event.completedBytes),
    );
    for (let i = 1; i < progress.length; i += 1) {
      expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1] ?? 0);
    }
  });

  it('preserves Data URL MIME and always offers .bin output on decode', () => {
    const encoded = new TextEncoder().encode('data:application/json;base64,e30=');
    const result = processFileJob({
      kind: 'decode',
      buffer: encoded.buffer,
      format: 'data-url',
      mode: 'tolerant',
    });
    expect(result.mime).toBe('application/json');
    expect(result.textPreview).toBe('{}');
    expect(result.textPreviewComplete).toBe(true);
  });

  it('keeps encoded file output as text and preserves an empty Data URL header', () => {
    const result = processFileJob({
      kind: 'encode',
      buffer: new ArrayBuffer(0),
      format: 'data-url',
      mode: 'tolerant',
      mime: 'application/json',
    });
    expect(new TextDecoder().decode(result.chunks[0])).toBe('data:application/json;base64,');
    expect(result.mime).toBe('text/plain;charset=utf-8');
  });

  it('marks encoded previews incomplete based on output bytes', () => {
    const result = processFileJob({
      kind: 'encode',
      buffer: new ArrayBuffer(3_073),
      format: 'standard',
      mode: 'tolerant',
    });
    expect(result.textPreview).toHaveLength(4_096);
    expect(result.textPreviewComplete).toBe(false);
  });

  it('rejects invalid worker chunk sizes before entering a loop', () => {
    for (const chunkSize of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => processFileJob({
        kind: 'encode',
        buffer: new ArrayBuffer(1),
        format: 'standard',
        mode: 'tolerant',
        chunkSize,
      })).toThrow(/chunk size/i);
    }
  });
});

describe('worker decode edge cases (ultrareview batch 3)', () => {
  it('flags a text preview as complete only when the whole payload fits the sample', () => {
    const truncatedInput = encodeBase64('hang'.repeat(2000), { format: 'standard' });
    const result = processFileJob({
      kind: 'decode',
      buffer: new TextEncoder().encode(truncatedInput).buffer,
      format: 'standard',
      mode: 'tolerant',
    });
    expect(result.textPreview).toBe('hang'.repeat(1024));
    expect(result.textPreviewComplete).toBe(false);

    const completeInput = encodeBase64('hang', { format: 'standard' });
    const complete = processFileJob({
      kind: 'decode',
      buffer: new TextEncoder().encode(completeInput).buffer,
      format: 'standard',
      mode: 'tolerant',
    });
    expect(complete.textPreview).toBe('hang');
    expect(complete.textPreviewComplete).toBe(true);
  });

  it('decodes a text file whose multi-byte char crosses the preview window', () => {
    // 'You' is 3 bytes; the 4096-byte sample window splits it after 4095 'a's.
    const text = 'a'.repeat(4095) + '你';
    const input = encodeBase64(text, { format: 'standard' });
    const result = processFileJob({
      kind: 'decode',
      buffer: new TextEncoder().encode(input).buffer,
      format: 'standard',
      mode: 'tolerant',
    });
    expect(result.textPreview).toBe('a'.repeat(4095));
    expect(result.textPreviewComplete).toBe(false);
  });

  it('fails loudly when a data: prefix has no valid base64 header', () => {
    const encoded = new TextEncoder().encode('data:somethingelse,zzzz');
    expect(() =>
      processFileJob({ kind: 'decode', buffer: encoded.buffer, format: 'standard', mode: 'tolerant' }),
    ).toThrow(/data url/i);
  });

  it('decodes tolerant partial quads without padding', () => {
    const encoded = new TextEncoder().encode('aGVsbG8');
    const result = processFileJob({ kind: 'decode', buffer: encoded.buffer, format: 'standard', mode: 'tolerant' });
    expect(result.corrections).toContain('padding');
    expect(result.chunks.map((chunk) => new TextDecoder().decode(chunk)).join('')).toBe('hello');
  });

  it('rejects whitespace inside a strict-mode Data URL header', () => {
    let code = '';
    try {
      processFileJob({
        kind: 'decode',
        mode: 'strict',
        format: 'standard',
        buffer: new TextEncoder().encode('data: text/plain;base64,aGk=').buffer,
      });
    } catch (error) {
      code = (error as { code?: string }).code ?? '';
    }
    expect(code).toBe('INVALID_DATA_URL');
  });

  it('still strips whitespace inside a tolerant-mode Data URL header', () => {
    const result = processFileJob({
      kind: 'decode',
      mode: 'tolerant',
      format: 'standard',
      buffer: new TextEncoder().encode('data: text/plain;base64,aGk=').buffer,
    });
    expect(result.mime).toBe('text/plain');
    expect(result.corrections).toContain('whitespace');
  });

  it('recognizes a Data URL after tolerated leading ASCII whitespace', () => {
    const encoded = new TextEncoder().encode('  data:text/plain;base64,aGk=');
    const result = processFileJob({
      kind: 'decode',
      buffer: encoded.buffer,
      format: 'standard',
      mode: 'tolerant',
    });
    expect(result.mime).toBe('text/plain');
    expect(new TextDecoder().decode(result.chunks[0])).toBe('hi');
    expect(result.corrections).toContain('whitespace');
  });

  it('uses canonical padding and alphabet validation in file decoding', () => {
    const makeJob = (value: string, mode: 'strict' | 'tolerant'): FileJobRequest => ({
      kind: 'decode',
      buffer: new TextEncoder().encode(value).buffer,
      format: 'standard',
      mode,
    });
    expect(() => processFileJob(makeJob('Q=Q=', 'tolerant'))).toThrow(/padding/i);
    expect(() => processFileJob(makeJob('AB==', 'strict'))).toThrow(/padding/i);
    expect(() => processFileJob(makeJob('a+b-', 'strict'))).toThrow(/alphabet|character/i);
  });
});
