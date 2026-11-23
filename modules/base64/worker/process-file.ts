import { MAX_FILE_BYTES, WORKING_CHUNK_BYTES, type FileJobRequest, type FileProgressMessage } from './protocol';
import { encodeTriplets, toUrlSafeAlphabet } from '../core/shared-encode';

const SAMPLE_PREVIEW_BYTES = 4096;
const HEADER_PROBE_BYTES = 2048;
const MAX_WORKING_CHUNK_BYTES = 4 * 1024 * 1024;

export class FileTooLargeError extends Error {
  readonly code = 'FILE_TOO_LARGE';
  constructor() {
    super('file exceeds 50 MB');
    this.name = 'FileTooLargeError';
  }
}

export interface ProcessFileResult {
  readonly chunks: ArrayBuffer[];
  readonly mime: string | null;
  readonly textPreview: string | null;
  readonly textPreviewComplete: boolean;
  readonly corrections: string[];
  readonly maxWorkingChunkBytes: number;
  readonly completedBytes: number;
}

export function assertFileSize(byteLength: number): void {
  if (byteLength > MAX_FILE_BYTES) {
    throw new FileTooLargeError();
  }
}

export function processFileJob(
  job: FileJobRequest,
  onProgress?: (message: FileProgressMessage) => void,
): ProcessFileResult {
  assertFileSize(job.buffer.byteLength);
  const chunkSize = validateChunkSize(job.chunkSize);
  if (job.kind === 'encode') {
    return encodeFile(job, chunkSize, onProgress);
  }
  return decodeFile(job, chunkSize, onProgress);
}

function encodeFile(
  job: FileJobRequest,
  chunkSize: number,
  onProgress?: (message: FileProgressMessage) => void,
): ProcessFileResult {
  const input = new Uint8Array(job.buffer);
  const encoder = new TextEncoder();
  const chunks: ArrayBuffer[] = [];
  // The shared encoder owns the alphabet mapping so file and text paths can
  // never drift (AGENTS.md Base64 contract).
  const header = job.format === 'data-url'
    ? `data:${job.mime ?? 'application/octet-stream'};base64,`
    : '';
  const urlSafe = job.format === 'url';
  const encodeChunk = (bytes: Uint8Array): string =>
    urlSafe ? toUrlSafeAlphabet(encodeTriplets(bytes)) : encodeTriplets(bytes);
  let preview = '';
  let outputBytes = 0;
  const carry = new Uint8Array(2);
  let carryLength = 0;
  let firstOutput = true;

  const emit = (encoded: string): void => {
    const value = firstOutput ? `${header}${encoded}` : encoded;
    firstOutput = false;
    outputBytes += value.length;
    if (preview.length < SAMPLE_PREVIEW_BYTES) {
      preview += value.slice(0, SAMPLE_PREVIEW_BYTES - preview.length);
    }
    chunks.push(encoder.encode(value).buffer);
  };

  for (let offset = 0; offset < input.byteLength; offset += chunkSize) {
    const end = Math.min(offset + chunkSize, input.byteLength);
    let cursor = offset;

    if (carryLength > 0) {
      const needed = 3 - carryLength;
      const available = end - cursor;
      if (available < needed) {
        carry.set(input.subarray(cursor, end), carryLength);
        carryLength += available;
        cursor = end;
      } else {
        const prefix = new Uint8Array(3);
        prefix.set(carry.subarray(0, carryLength));
        prefix.set(input.subarray(cursor, cursor + needed), carryLength);
        emit(encodeChunk(prefix));
        cursor += needed;
        carryLength = 0;
      }
    }

    const remaining = end - cursor;
    const fullLength = remaining - (remaining % 3);
    if (fullLength > 0) {
      emit(encodeChunk(input.subarray(cursor, cursor + fullLength)));
      cursor += fullLength;
    }

    const tail = end - cursor;
    if (tail === 1) {
      carry[0] = input[cursor] ?? 0;
      carryLength = 1;
    } else if (tail === 2) {
      carry[0] = input[cursor] ?? 0;
      carry[1] = input[cursor + 1] ?? 0;
      carryLength = 2;
    }
    onProgress?.({ type: 'progress', completedBytes: end, totalBytes: input.byteLength });
  }

  if (carryLength > 0) {
    const tail = carryLength === 1
      ? carry.subarray(0, 1)
      : carry.subarray(0, 2);
    emit(encodeChunk(tail));
  }
  if (firstOutput) {
    emit('');
  }

  return {
    chunks,
    // The encoded file is text even when its Data URL declares a binary
    // source MIME; the declaration is part of the text payload.
    mime: 'text/plain;charset=utf-8',
    textPreview: preview,
    textPreviewComplete: outputBytes <= SAMPLE_PREVIEW_BYTES,
    corrections: [],
    maxWorkingChunkBytes: Math.max(chunkSize, 3),
    completedBytes: input.byteLength,
  };
}

interface DataUrlHeader {
  readonly payloadStart: number;
  readonly mime: string | null;
  readonly present: boolean;
  readonly whitespaceRemoved: boolean;
}

function decodeFile(
  job: FileJobRequest,
  chunkSize: number,
  onProgress?: (message: FileProgressMessage) => void,
): ProcessFileResult {
  const input = new Uint8Array(job.buffer);
  const header = findDataUrlHeader(input, job.mode);
  const corrections: string[] = [];
  if (header.whitespaceRemoved) {
    addCorrection(corrections, 'whitespace');
  }
  const chunks: ArrayBuffer[] = [];
  const previewBytes = new Uint8Array(SAMPLE_PREVIEW_BYTES);
  let outputChunk = new Uint8Array(chunkSize);
  let outputUsed = 0;
  let outputBytes = 0;
  let previewUsed = 0;
  let dataLength = 0;
  let padCount = 0;
  let quartetLength = 0;
  let quartet0 = 0;
  let quartet1 = 0;
  let quartet2 = 0;
  let quartet3 = 0;
  let lastValue = 0;
  let seenPadding = false;
  let sawStandardSpecial = false;
  let sawUrlSpecial = false;

  const emitByte = (value: number): void => {
    outputChunk[outputUsed] = value;
    outputUsed += 1;
    outputBytes += 1;
    if (previewUsed < SAMPLE_PREVIEW_BYTES) {
      previewBytes[previewUsed] = value;
      previewUsed += 1;
    }
    if (outputUsed === outputChunk.byteLength) {
      chunks.push(outputChunk.buffer);
      // This is intentionally a new fixed-size chunk. Completed chunks are
      // transferred out of the worker without retaining a full duplicate.
      outputChunk = new Uint8Array(chunkSize);
      outputUsed = 0;
    }
  };

  const payloadLength = input.byteLength - header.payloadStart;
  for (let index = header.payloadStart; index < input.byteLength; index += 1) {
    const byte = input[index] ?? 0;
    if (isAsciiWhitespace(byte)) {
      if (job.mode === 'strict') {
        fail('INVALID_CHARACTER', 'whitespace is not allowed in strict mode');
      }
      addCorrection(corrections, 'whitespace');
      continue;
    }

    if (byte === 61) {
      if (dataLength === 0 || padCount >= 2) {
        fail('INVALID_PADDING', 'padding is misplaced');
      }
      seenPadding = true;
      padCount += 1;
      continue;
    }
    if (seenPadding) {
      fail('INVALID_PADDING', 'padding is misplaced');
    }

    let value: number | null = null;
    if (byte === 45 || byte === 95) {
      if (header.present) {
        // Same contract as the text path (core/normalize.ts): Data URLs are
        // RFC 4648 §4 canonical standard Base64; URL-safe characters inside
        // one are rejected in both modes, never silently repaired.
        fail('INVALID_CHARACTER', 'URL-safe characters are not canonical inside a Data URL');
      }
      sawUrlSpecial = true;
      addCorrectionIfTolerant(corrections, 'url-alphabet', job.mode);
      value = byte === 45 ? 62 : 63;
    } else if (byte === 43 || byte === 47) {
      if (sawUrlSpecial) {
        fail('INVALID_CHARACTER', 'mixed Base64 alphabets are not allowed');
      }
      sawStandardSpecial = true;
      value = byte === 43 ? 62 : 63;
    } else if (byte >= 65 && byte <= 90) {
      value = byte - 65;
    } else if (byte >= 97 && byte <= 122) {
      value = byte - 97 + 26;
    } else if (byte >= 48 && byte <= 57) {
      value = byte - 48 + 52;
    }
    if (sawStandardSpecial && sawUrlSpecial) {
      fail('INVALID_CHARACTER', 'mixed Base64 alphabets are not allowed');
    }
    if (value === null) {
      fail('INVALID_CHARACTER', 'invalid Base64 character');
    }

    dataLength += 1;
    lastValue = value;
    if (quartetLength === 0) quartet0 = value;
    else if (quartetLength === 1) quartet1 = value;
    else if (quartetLength === 2) quartet2 = value;
    else quartet3 = value;
    quartetLength += 1;
    if (quartetLength === 4) {
      emitByte((quartet0 << 2) | (quartet1 >> 4));
      emitByte(((quartet1 & 15) << 4) | (quartet2 >> 2));
      emitByte(((quartet2 & 3) << 6) | quartet3);
      quartetLength = 0;
    }

    const processed = index - header.payloadStart + 1;
    if (processed % chunkSize === 0 || index === input.byteLength - 1) {
      onProgress?.({ type: 'progress', completedBytes: processed, totalBytes: payloadLength });
    }
  }

  if (dataLength === 0) {
    fail('EMPTY', 'input is empty');
  }
  if (dataLength % 4 === 1) {
    fail('INVALID_LENGTH', 'Base64 length is invalid');
  }
  const expectedPadding = dataLength % 4 === 0 ? 0 : 4 - (dataLength % 4);
  if (padCount > expectedPadding) {
    fail('INVALID_PADDING', 'too much padding');
  }
  if (job.mode === 'strict' && padCount !== expectedPadding) {
    fail('INVALID_PADDING', 'missing padding');
  }
  if (job.mode === 'tolerant' && padCount < expectedPadding) {
    addCorrection(corrections, 'padding');
  }
  if (dataLength % 4 === 2 && (lastValue & 15) !== 0) {
    fail('INVALID_PADDING', 'non-zero Base64 padding bits');
  }
  if (dataLength % 4 === 3 && (lastValue & 3) !== 0) {
    fail('INVALID_PADDING', 'non-zero Base64 padding bits');
  }
  if (quartetLength === 2) {
    emitByte((quartet0 << 2) | (quartet1 >> 4));
  } else if (quartetLength === 3) {
    emitByte((quartet0 << 2) | (quartet1 >> 4));
    emitByte(((quartet1 & 15) << 4) | (quartet2 >> 2));
  }

  if (outputUsed > 0) {
    chunks.push(outputChunk.slice(0, outputUsed).buffer);
  }
  if (chunks.length === 0) {
    chunks.push(new ArrayBuffer(0));
  }
  const preview = textPreviewFor(previewBytes.subarray(0, previewUsed));
  return {
    chunks,
    mime: header.mime,
    textPreview: preview,
    textPreviewComplete: preview !== null && outputBytes <= SAMPLE_PREVIEW_BYTES,
    corrections,
    maxWorkingChunkBytes: chunkSize,
    completedBytes: job.buffer.byteLength,
  };
}

function findDataUrlHeader(input: Uint8Array, mode: 'strict' | 'tolerant'): DataUrlHeader {
  const limit = Math.min(input.byteLength, HEADER_PROBE_BYTES);
  let compact = '';
  let commaIndex = -1;
  let whitespaceRemoved = false;
  let sawWhitespace = false;
  for (let index = 0; index < limit; index += 1) {
    const byte = input[index] ?? 0;
    if (isAsciiWhitespace(byte)) {
      sawWhitespace = true;
      if (mode === 'tolerant') {
        whitespaceRemoved = true;
        continue;
      }
    }
    compact += String.fromCharCode(byte);
    if (byte === 44) {
      commaIndex = index;
      break;
    }
  }
  if (!compact.startsWith('data:')) {
    return { payloadStart: 0, mime: null, present: false, whitespaceRemoved: false };
  }
  // Strict keeps whitespace out of the header entirely: a space inside the
  // MIME token would otherwise slip into the decoded result's mime.
  if (mode === 'strict' && sawWhitespace) {
    fail('INVALID_DATA_URL', 'whitespace is not allowed in strict mode');
  }
  const match = /^data:([^,]*);base64,$/.exec(compact);
  if (!match || commaIndex < 0) {
    fail('INVALID_DATA_URL', 'malformed Data URL header');
  }
  return {
    payloadStart: commaIndex + 1,
    mime: match[1] && match[1].length > 0 ? match[1] : 'application/octet-stream',
    present: true,
    whitespaceRemoved,
  };
}

function addCorrection(corrections: string[], code: string): void {
  if (!corrections.includes(code)) {
    corrections.push(code);
  }
}

function addCorrectionIfTolerant(corrections: string[], code: string, mode: 'strict' | 'tolerant'): void {
  if (mode === 'tolerant') {
    addCorrection(corrections, code);
  }
}

function validateChunkSize(value: number | undefined): number {
  const chunkSize = value ?? WORKING_CHUNK_BYTES;
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1 || chunkSize > MAX_WORKING_CHUNK_BYTES) {
    fail('INVALID_JOB', 'chunk size must be a positive safe integer within the worker limit');
  }
  return chunkSize;
}

function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code });
}

// Numeric range checks instead of a per-byte regex+string allocation: the
// decode hot loop calls this up to 50 million times on a max-size file.
function isAsciiWhitespace(byte: number): boolean {
  return byte === 32 || (byte >= 9 && byte <= 13);
}

function textPreviewFor(bytes: Uint8Array): string | null {
  if (bytes.byteLength === 0) {
    return '';
  }
  // A multi-byte UTF-8 character split by the sample window must not flip a
  // text file into the binary path: retry with up to 3 trailing bytes cut
  // before concluding the sample is genuinely invalid UTF-8.
  for (let trim = 0; trim <= 3; trim += 1) {
    const size = bytes.byteLength - trim;
    if (size <= 0) {
      break;
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size));
    } catch {
      // Retry with a shorter sample.
    }
  }
  return null;
}
