/**
 * Code-point-safe truncation for user-visible previews: a UTF-16 code-unit
 * slice can split a surrogate pair and render a replacement glyph at the
 * boundary. Appends the ellipsis only when content was actually cut.
 */
export function truncateByCodePoints(value: string, maxCodePoints: number, ellipsis = '…'): string {
  if (value.length <= maxCodePoints) {
    return value;
  }
  const sliced = Array.from(value).slice(0, maxCodePoints).join('');
  return `${sliced}${ellipsis}`;
}
