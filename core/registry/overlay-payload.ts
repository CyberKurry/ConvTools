import { chineseMessages, englishMessages, lookup, resolveLocale, type LocalePreference } from '../i18n/types';

/**
 * Data contract between the background (which converts the selection and
 * injects the overlay) and the injected overlay script. Labels are resolved
 * ahead of time because the overlay has no settings pipeline of its own.
 */
export interface OverlayLabels {
  readonly copy: string;
  readonly copied: string;
  readonly close: string;
  readonly expand: string;
  readonly expandFailed: string;
  readonly manualCopy: string;
  readonly failed: string;
  readonly truncated: string;
}

export interface OverlayPayload {
  readonly result: string;
  readonly actionLabel: string;
  readonly isError?: boolean;
  /** Origin action, present when the payload can be re-handed off ("Expand"). */
  readonly moduleId?: string;
  readonly actionId?: string;
  readonly labels: OverlayLabels;
  /** Resolved extension theme; omitted means the overlay follows the OS. */
  readonly theme?: 'light' | 'dark';
}

export const FALLBACK_OVERLAY_LABELS: OverlayLabels = {
  copy: englishMessages.overlay.copy,
  copied: englishMessages.overlay.copied,
  close: englishMessages.overlay.close,
  expand: englishMessages.overlay.expand,
  expandFailed: englishMessages.overlay.expandFailed,
  manualCopy: englishMessages.copy.manual,
  failed: englishMessages.errors.generic,
  truncated: englishMessages.overlay.truncated,
};

export function overlayLabelsFor(preference: LocalePreference): OverlayLabels {
  const messages = resolveLocale(preference) === 'zh_CN' ? chineseMessages : englishMessages;
  return {
    copy: lookup(messages, 'overlay.copy'),
    copied: lookup(messages, 'overlay.copied'),
    close: lookup(messages, 'overlay.close'),
    expand: lookup(messages, 'overlay.expand'),
    expandFailed: lookup(messages, 'overlay.expandFailed'),
    manualCopy: lookup(messages, 'copy.manual'),
    failed: lookup(messages, 'errors.generic'),
    truncated: lookup(messages, 'overlay.truncated'),
  };
}
