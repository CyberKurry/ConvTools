import type { SelectionPageMeta } from '../../../core/module-sdk/runtime';
import { clampInput, EXCERPT_MAX_CHARS, SUMMARY_MAX_CHARS, TITLE_MAX_CHARS } from './limits';
import type { ShareCardInput } from './types';

export const MAX_URL_BYTES = 2048;
export const SITE_NAME_MAX_CHARS = 80;

/** Narrows an untrusted hand-off payload back into a v1 input. */
export function parseShareCardInput(value: unknown): ShareCardInput | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const candidate = value as Partial<ShareCardInput>;
  if (candidate.version !== 1 || typeof candidate.excerpt !== 'string') {
    return null;
  }
  const url = normalizeUrl(typeof candidate.url === 'string' ? candidate.url : null);
  return {
    version: 1,
    excerpt: normalizeCardText(candidate.excerpt, EXCERPT_MAX_CHARS) ?? '',
    title: typeof candidate.title === 'string' ? normalizeCardText(candidate.title, TITLE_MAX_CHARS) : null,
    summary: typeof candidate.summary === 'string' ? normalizeCardText(candidate.summary, SUMMARY_MAX_CHARS) : null,
    url,
    siteName: typeof candidate.siteName === 'string'
      ? normalizeCardText(candidate.siteName, SITE_NAME_MAX_CHARS) ?? hostOf(url)
      : hostOf(url),
  };
}

function cleanText(value: string): string {
  // Control characters must never reach the canvas or the stored history;
  // built without a control-character regex so lint stays clean too.
  let cleaned = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    cleaned += code < 0x20 || code === 0x7f ? ' ' : char;
  }
  return cleaned;
}

export function normalizeCardText(value: string, maxChars: number): string | null {
  const bounded = boundedPrefix(value, Math.max(maxChars * 4, maxChars));
  const cleaned = cleanText(bounded).replace(/\s+/g, ' ').trim();
  if (cleaned === '') {
    return null;
  }
  return clampInput(cleaned, maxChars).text;
}

function normalizeUrl(value: string | null): string | null {
  if (value === null || value.trim() === '') {
    return null;
  }
  if (new TextEncoder().encode(value).byteLength > MAX_URL_BYTES) {
    return null;
  }
  try {
    const parsed = new URL(value);
    // Only web origins may be encoded into a scannable code.
    if (
      (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
      parsed.username !== '' ||
      parsed.password !== ''
    ) {
      return null;
    }
    const normalized = parsed.toString();
    return new TextEncoder().encode(normalized).byteLength <= MAX_URL_BYTES ? normalized : null;
  } catch {
    return null;
  }
}

function hostOf(url: string | null): string | null {
  if (url === null) {
    return null;
  }
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/**
 * Builds the versioned module input from the raw selection and whatever page
 * metadata the core could collect. Every field degrades independently; only
 * the excerpt is required (and may be the empty string's caller's problem —
 * the action rejects empty selections upstream).
 */
export function normalizeSelectionInput(selectionText: string, page: SelectionPageMeta | null): ShareCardInput {
  const url = normalizeUrl(page?.url ?? null);
  return {
    version: 1,
    excerpt: normalizeCardText(selectionText, EXCERPT_MAX_CHARS) ?? '',
    title: normalizeCardText(page?.title ?? '', TITLE_MAX_CHARS),
    summary: normalizeCardText(page?.description ?? '', SUMMARY_MAX_CHARS),
    url,
    siteName: normalizeCardText(page?.siteName ?? '', SITE_NAME_MAX_CHARS) ?? hostOf(url),
  };
}

function boundedPrefix(value: string, maxCodePoints: number): string {
  let result = '';
  let count = 0;
  for (const char of value) {
    result += char;
    count += 1;
    if (count >= maxCodePoints) {
      break;
    }
  }
  return result;
}

export { hostOf, normalizeUrl };
