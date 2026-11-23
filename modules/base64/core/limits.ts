/**
 * Input size limits for the Base64 module.
 *
 * The 50 MB ceiling is the product hard limit (spec §11.2); the text path
 * shares it so a pasted multi-megabyte blob cannot freeze the page while the
 * synchronous encoder copies it (spec §11.1).
 */
export const MAX_INPUT_BYTES = 50 * 1024 * 1024;

/** UTF-8 byte length of a string, without materializing a second copy. */
export function utf8ByteLength(value: string): number {
  return new Blob([value]).size;
}

/**
 * True when `value` exceeds `limit` UTF-8 bytes.
 *
 * Two cheap bounds avoid measuring (and allocating) for the common cases:
 * every UTF-16 code unit is at least one UTF-8 byte, and at most four.
 */
export function exceedsInputLimit(value: string, limit: number = MAX_INPUT_BYTES): boolean {
  if (value.length > limit) {
    return true;
  }
  if (value.length * 4 <= limit) {
    return false;
  }
  return utf8ByteLength(value) > limit;
}
