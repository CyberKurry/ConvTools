/**
 * The single shared Base64 encoding primitives for text and file paths
 * (AGENTS.md Base64 contract: standard, URL-safe and Data URL outputs share
 * one pure-function core). The file worker streams chunks through the same
 * alphabet mapping as the text encoder so the two outputs can never drift.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Encodes one chunk whose byte length is a multiple of 3 (no padding). */
export function encodeTriplets(bytes: Uint8Array): string {
  let output = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const triple = ((a << 16) | ((b ?? 0) << 8) | (c ?? 0)) & 0xffffff;
    output += ALPHABET[(triple >> 18) & 63];
    output += ALPHABET[(triple >> 12) & 63];
    output += b === undefined ? '=' : ALPHABET[(triple >> 6) & 63];
    output += c === undefined ? '=' : ALPHABET[triple & 63];
  }
  return output;
}

/** Maps a standard-alphabet chunk onto the URL-safe alphabet, stripping padding. */
export function toUrlSafeAlphabet(text: string): string {
  return text.replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
