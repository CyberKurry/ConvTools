import type { DecodeFailure, NormalizedBase64, NormalizationCorrection } from './types';

const STANDARD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
// Tolerant cleanup is limited to ASCII whitespace (AGENTS.md Base64 contract).
const ASCII_WHITESPACE = /[ \t\r\n\f\v]+/g;
// Membership table for the canonical alphabet plus '=': a bounded array scan
// replaces the per-character 64-char string search on the decode hot path.
const CANONICAL = new Uint8Array(128);
for (const char of STANDARD) {
  CANONICAL[char.charCodeAt(0)] = 1;
}
CANONICAL[61] = 1; // '='

export function normalizeBase64(
  input: string,
  mode: 'strict' | 'tolerant',
): NormalizedBase64 | DecodeFailure {
  if (input.length === 0) {
    return fail('EMPTY', 'input is empty', null);
  }

  let value = input;
  const corrections: NormalizationCorrection[] = [];
  if (mode === 'tolerant') {
    const compact = value.replace(ASCII_WHITESPACE, '');
    if (compact !== value) {
      corrections.push({ code: 'whitespace', detail: 'correctionWhitespace' });
    }
    value = compact;
    if (value.length === 0) {
      return fail('EMPTY', 'input is empty', null);
    }
  } else {
    const whitespaceIndex = /\s/.exec(value)?.index;
    if (whitespaceIndex !== undefined) {
      return fail('INVALID_CHARACTER', 'whitespace is not allowed in strict mode', whitespaceIndex);
    }
  }

  let mime: string | null = null;
  let format: 'standard' | 'url' | 'data-url' = 'standard';
  let payloadOffset = 0;
  if (value.startsWith('data:')) {
    const match = /^data:([^,]*);base64,(.*)$/s.exec(value);
    if (!match) {
      return fail('INVALID_DATA_URL', 'malformed Data URL header', 0);
    }
    mime = match[1] && match[1].length > 0 ? match[1] : 'application/octet-stream';
    value = match[2] ?? '';
    payloadOffset = match[0].length - value.length;
    format = 'data-url';
    if (value.length === 0) {
      return fail('EMPTY', 'Data URL payload is empty', null);
    }
  }

  const hasStandardAlphabet = /[+/]/.test(value);
  const hasUrlAlphabet = /[-_]/.test(value);
  if (hasStandardAlphabet && hasUrlAlphabet) {
    return fail('INVALID_CHARACTER', 'mixed Base64 alphabets are not allowed', firstAlphabetIndex(value));
  }
  if (hasUrlAlphabet) {
    if (mode === 'strict' && format === 'data-url') {
      return fail(
        'INVALID_CHARACTER',
        'URL-safe characters are not canonical inside a Data URL',
        payloadOffset + value.search(/[-_]/),
      );
    }
    if (format !== 'data-url') {
      format = 'url';
    }
    if (mode === 'tolerant') {
      // The file path applies the same tolerant repair, so both surfaces give
      // one answer for URL-safe characters inside a Data URL.
      value = value.replaceAll('-', '+').replaceAll('_', '/');
      corrections.push({ code: 'url-alphabet', detail: 'correctionUrl' });
    } else {
      // Strict mode rejects repairs, but URL-safe alphabet detection is a
      // supported input format; normalize it internally without reporting a
      // correction.
      value = value.replaceAll('-', '+').replaceAll('_', '/');
    }
  } else if (mode === 'strict' && value.indexOf('=') === -1 && value.length % 4 !== 0) {
    // An unpadded non-multiple-of-4 length cannot be canonical standard or
    // Data URL Base64 (both always pad); the only spec-supported producer of
    // that shape is the URL-safe format, which omits padding by design.
    format = 'url';
  }

  // URL-safe Base64 canonically omits padding (RFC 4648 §5), so its strict
  // mode accepts the unpadded length as already canonical — our own encoder
  // emits exactly that form and must decode back in strict mode.
  const canonical = normalizePadding(value, mode, corrections, format);
  if (!canonical.ok) {
    return canonical;
  }
  value = canonical.value;

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 128 && CANONICAL[code] === 1) {
      continue;
    }
    return fail('INVALID_CHARACTER', `invalid character ${value[index] ?? ''}`, payloadOffset + index);
  }

  // Padding is canonical by this point, so the data length is the first '='
  // position — no full-string duplicate just to count data characters.
  const padIndex = value.indexOf('=');
  const dataLength = padIndex === -1 ? value.length : padIndex;
  if (dataLength === 0) {
    return fail('INVALID_LENGTH', 'Base64 payload is empty', null);
  }
  if (dataLength % 4 === 1) {
    return fail('INVALID_LENGTH', 'Base64 length is invalid', null);
  }
  const padBits = validatePadBits(value);
  if (!padBits.ok) {
    return padBits;
  }
  return { ok: true, value, format, mime, corrections };
}

function normalizePadding(
  value: string,
  mode: 'strict' | 'tolerant',
  corrections: NormalizationCorrection[],
  format: 'standard' | 'url' | 'data-url',
): { ok: true; value: string } | DecodeFailure {
  const firstPad = value.indexOf('=');
  const dataLength = firstPad === -1 ? value.length : firstPad;
  const padLength = firstPad === -1 ? 0 : value.length - firstPad;
  if (firstPad !== -1 && /[^=]/.test(value.slice(firstPad))) {
    return fail('INVALID_PADDING', 'padding is misplaced', firstPad);
  }
  if (dataLength === 0 || padLength > 2 || dataLength % 4 === 1) {
    return fail('INVALID_PADDING', 'padding is invalid', firstPad === -1 ? null : firstPad);
  }

  const remainder = dataLength % 4;
  const expectedPadding = remainder === 0 ? 0 : 4 - remainder;
  if (padLength > expectedPadding) {
    return fail('INVALID_PADDING', 'too much padding', firstPad);
  }
  if (mode === 'strict' && padLength !== expectedPadding) {
    // URL-safe Base64 canonically omits padding (RFC 4648 §5): an unpadded
    // data length is the canonical form for the 'url' format, so strict mode
    // accepts it there. Standard and Data URL inputs must stay fully padded.
    // The url format covers both detected URL-safe alphabets and the
    // alphanumeric-only output our URL-safe encoder emits.
    if (!(format === 'url' && padLength === 0)) {
      return fail('INVALID_PADDING', 'missing padding', value.length);
    }
  }
  if (mode === 'tolerant' && padLength < expectedPadding) {
    corrections.push({ code: 'padding', detail: 'correctionPadding' });
    return { ok: true, value: `${value}${'='.repeat(expectedPadding - padLength)}` };
  }
  return { ok: true, value };
}

function validatePadBits(value: string): { ok: true } | DecodeFailure {
  const firstPad = value.indexOf('=');
  const dataLength = firstPad === -1 ? value.length : firstPad;
  if (dataLength % 4 === 2) {
    const last = value[dataLength - 1];
    if (last === undefined || (STANDARD.indexOf(last) & 0x0f) !== 0) {
      return fail('INVALID_PADDING', 'non-zero Base64 pad bits', dataLength - 1);
    }
  } else if (dataLength % 4 === 3) {
    const last = value[dataLength - 1];
    if (last === undefined || (STANDARD.indexOf(last) & 0x03) !== 0) {
      return fail('INVALID_PADDING', 'non-zero Base64 pad bits', dataLength - 1);
    }
  }
  return { ok: true };
}

function firstAlphabetIndex(value: string): number {
  const indexes = [value.search(/[+/]/), value.search(/[-_]/)].filter((index) => index >= 0);
  return Math.min(...indexes);
}

function fail(code: DecodeFailure['code'], message: string, index: number | null): DecodeFailure {
  return { ok: false, code, message, index };
}
