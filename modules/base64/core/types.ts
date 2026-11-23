export type Base64Format = 'standard' | 'url' | 'data-url';
export type Base64Mode = 'strict' | 'tolerant';

export interface NormalizationCorrection {
  readonly code: 'whitespace' | 'url-alphabet' | 'padding';
  readonly detail: string;
}

export interface DecodeSuccess {
  readonly ok: true;
  readonly bytes: Uint8Array;
  readonly format: Base64Format;
  readonly mime: string | null;
  readonly corrections: readonly NormalizationCorrection[];
  readonly text: string | null;
}

export interface DecodeFailure {
  readonly ok: false;
  readonly code: 'EMPTY' | 'INVALID_CHARACTER' | 'INVALID_PADDING' | 'INVALID_LENGTH' | 'INVALID_DATA_URL';
  readonly message: string;
  readonly index: number | null;
}

export type DecodeResult = DecodeSuccess | DecodeFailure;

export interface EncodeOptions {
  readonly format: Base64Format;
  readonly mime?: string;
}

export interface NormalizedBase64 {
  readonly ok: true;
  readonly value: string;
  readonly format: Base64Format;
  readonly mime: string | null;
  readonly corrections: readonly NormalizationCorrection[];
}