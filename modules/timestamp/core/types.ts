export type TimestampUnit = 'seconds' | 'milliseconds';

export interface DetectedUnit {
  readonly unit: TimestampUnit | 'ambiguous' | 'invalid';
}

export interface InstantParts {
  readonly epochSeconds: bigint;
  readonly epochMilliseconds: bigint;
  readonly isoUtc: string;
  readonly zoned: string;
}

export type LocalTimeResolution =
  | { readonly kind: 'unique'; readonly instant: InstantParts }
  | { readonly kind: 'nonexistent' }
  | { readonly kind: 'ambiguous'; readonly earlier: InstantParts; readonly later: InstantParts };

