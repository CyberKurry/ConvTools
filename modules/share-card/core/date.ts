import type { CardLocale } from './types';

const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/**
 * Formats an ISO yyyy-mm-dd date for the card footer. Hand-rolled (no
 * locale-dependent Intl) so worker output stays deterministic; `Temporal`
 * validates the input. Malformed input passes through unchanged — the caller
 * formatted it from a real date in the first place.
 */
export function formatCardDate(dateIso: string, locale: CardLocale): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIso);
  if (!match) {
    return dateIso;
  }
  const year = match[1];
  const month = match[2];
  const day = match[3];
  if (year === undefined || month === undefined || day === undefined) {
    return dateIso;
  }
  const monthIndex = Number.parseInt(month, 10) - 1;
  if (monthIndex < 0 || monthIndex > 11) {
    return dateIso;
  }
  if (locale === 'zh_CN') {
    return `${year}/${month}/${day}`;
  }
  const dayNumber = String(Number.parseInt(day, 10));
  return `${EN_MONTHS[monthIndex]} ${dayNumber}, ${year}`;
}
