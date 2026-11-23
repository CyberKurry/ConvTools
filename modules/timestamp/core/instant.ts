import type { InstantParts, TimestampUnit } from './types';

const TEMPORAL_MAX_NS = 8640000000000000000000n;
const NS_PER_SECOND = 1_000_000_000n;
const NS_PER_MILLIS = 1_000_000n;
const MAX_DECIMAL_DIGITS = 16;

export function parseIntegerTimestamp(raw: string, unit: TimestampUnit, timeZone = 'UTC'): InstantParts {
  if (!/^[+-]?\d+$/.test(raw)) {
    throw new SyntaxError('timestamp must be an integer');
  }
  // Leading zeros are numeric decoration, not magnitude: strip them before
  // the digit cap so `000…01` is not rejected as out of range.
  if (raw.replace(/^[+-]/, '').replace(/^0+(?=\d)/, '').length > MAX_DECIMAL_DIGITS) {
    throw new RangeError('timestamp is outside Temporal\'s supported range');
  }
  const value = BigInt(raw);
  const ns = unit === 'seconds' ? value * NS_PER_SECOND : value * NS_PER_MILLIS;
  if (ns > TEMPORAL_MAX_NS || ns < -TEMPORAL_MAX_NS) {
    throw new RangeError('timestamp is outside Temporal\'s supported range');
  }
  const instant = globalThis.Temporal.Instant.fromEpochNanoseconds(ns);
  return describeInstant(instant, timeZone);
}

export function describeInstant(instant: InstanceType<typeof globalThis.Temporal.Instant>, timeZone: string): InstantParts {
  const ns = instant.epochNanoseconds;
  return {
    // BigInt division truncates toward zero; flooring keeps the displayed
    // seconds/milliseconds consistent with the ISO rendering for instants
    // before the epoch (-1500ms is -2s + 500ms, not -1s).
    epochSeconds: floorDiv(ns, NS_PER_SECOND),
    epochMilliseconds: floorDiv(ns, NS_PER_MILLIS),
    isoUtc: instant.toString(),
    zoned: instant.toZonedDateTimeISO(timeZone).toString(),
  };
}

function floorDiv(ns: bigint, unit: bigint): bigint {
  const quotient = ns / unit;
  return ns < 0n && ns % unit !== 0n ? quotient - 1n : quotient;
}
