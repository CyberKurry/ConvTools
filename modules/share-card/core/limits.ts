import type { TruncatedText } from './types';

export const EXCERPT_MAX_CHARS = 300;
export const TITLE_MAX_CHARS = 80;
export const SUMMARY_MAX_CHARS = 120;

/** Punctuation that may end a cut without breaking reading flow. */
const SAFE_CUT_CHARS = new Set([...('，。、；：！？）】」』》…—')]);

/**
 * Clamps free-form input to a hard character cap. Cuts backtrack to the
 * nearest safe CJK punctuation so a truncated excerpt does not end mid-word
 * or on an opening bracket, then appends an ellipsis.
 */
export function clampInput(text: string, maxChars: number): TruncatedText {
  const codePoints = Array.from(text);
  if (codePoints.length <= maxChars) {
    return { text, truncated: false };
  }
  if (maxChars <= 1) {
    return { text: '…'.slice(0, maxChars), truncated: true };
  }
  const window = codePoints.slice(0, maxChars - 1);
  for (let index = window.length - 1; index > 0; index -= 1) {
    if (SAFE_CUT_CHARS.has(window[index] ?? '')) {
      return { text: `${window.slice(0, index + 1).join('')}…`, truncated: true };
    }
  }
  return { text: `${window.join('')}…`, truncated: true };
}
