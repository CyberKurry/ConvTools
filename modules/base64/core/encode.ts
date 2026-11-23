import { bytesToUtf8, utf8ToBytes } from './bytes';
import { encodeTriplets, toUrlSafeAlphabet } from './shared-encode';
import { normalizeBase64 } from './normalize';
import type { DecodeResult, EncodeOptions } from './types';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const EQUALS = 61; // '='
// 128-entry lookup so the decode hot path avoids per-character string scans
// (a 50 MB payload means tens of millions of lookups).
const LOOKUP = new Int16Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i += 1) {
  const char = ALPHABET[i];
  if (char !== undefined) {
    LOOKUP[char.charCodeAt(0)] = i;
  }
}

export function encodeBase64(input: string, options: EncodeOptions): string {
  return encodeBytes(utf8ToBytes(input), options);
}

export function encodeBytes(bytes: Uint8Array, options: EncodeOptions): string {
  const encoded = encodeTriplets(bytes);
  if (options.format === 'url') {
    return toUrlSafeAlphabet(encoded);
  }
  if (options.format === 'data-url') {
    const mime = options.mime ?? 'application/octet-stream';
    return `data:${mime};base64,${encoded}`;
  }
  return encoded;
}

export function decodeBase64(input: string, mode: 'strict' | 'tolerant'): DecodeResult {
  const normalized = normalizeBase64(input, mode);
  if (!normalized.ok) {
    return normalized;
  }
  const bytes = decodeRaw(normalized.value);
  if (!bytes) {
    return { ok: false, code: 'INVALID_CHARACTER', message: 'invalid Base64 payload', index: 0 };
  }
  return {
    ok: true,
    bytes,
    format: normalized.format,
    mime: normalized.mime,
    corrections: normalized.corrections,
    text: bytesToUtf8(bytes),
  };
}

function decodeRaw(value: string): Uint8Array | null {
  // Preallocated output + streaming bit assembly: no boxed number[] and no
  // intermediate copies (spec §16: no full-size duplicate buffers).
  const out = new Uint8Array(Math.floor((value.length * 3) / 4) + 3);
  let o = 0;
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code === EQUALS) {
      continue;
    }
    const v = code < 128 ? (LOOKUP[code] ?? -1) : -1;
    if (v < 0) {
      return null;
    }
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o] = (buffer >>> bits) & 255;
      o += 1;
    }
  }
  return out.subarray(0, o);
}