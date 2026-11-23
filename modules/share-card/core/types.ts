/** Module-owned, module-versioned input payload (spec §8.2 A2). */
export interface ShareCardInput {
  readonly version: 1;
  readonly excerpt: string;
  readonly title: string | null;
  readonly summary: string | null;
  readonly url: string | null;
  readonly siteName: string | null;
}

export type TemplateId = 'paper' | 'ink' | 'mist';
export type SizeId = 'portrait' | 'square';
export type CardLocale = 'en' | 'zh_CN';

export interface TruncatedText {
  readonly text: string;
  readonly truncated: boolean;
}

/** Resolved user-facing strings the worker must not compute itself. */
export interface CardTextOverrides {
  readonly watermarkText: string;
  readonly qrHint: string;
}
