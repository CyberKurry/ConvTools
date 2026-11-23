import type { CardLocale } from '../core/types';

export interface CardSpec {
  readonly excerpt: string;
  readonly title: string | null;
  readonly summary: string | null;
  readonly url: string | null;
  readonly siteName: string | null;
  readonly templateId: 'paper' | 'ink' | 'mist';
  readonly sizeId: 'portrait' | 'square';
  /** yyyy-mm-dd, resolved on the page before the worker runs. */
  readonly dateIso: string;
  readonly locale: CardLocale;
  /** Pre-resolved user-facing strings; the worker never touches i18n. */
  readonly watermarkText: string;
  readonly qrHint: string;
}

export interface CardWorkerRequest {
  readonly id: number;
  readonly card: CardSpec;
  readonly scale: 1 | 2;
}

export interface CardDoneMessage {
  readonly type: 'done';
  readonly id: number;
  readonly buffer: ArrayBuffer;
  readonly width: number;
  readonly height: number;
  readonly excerptTruncated: boolean;
}

export interface CardErrorMessage {
  readonly type: 'error';
  readonly id: number;
  readonly code: string;
  readonly message: string;
}

export type CardWorkerMessage = CardDoneMessage | CardErrorMessage;
