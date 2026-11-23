import type { DetectedUnit } from './types';

// Temporal supports instants within ±8.64e12 seconds (±1e8 days).
const MAX_REPRESENTABLE_SECONDS = 8_640_000_000_000n;

export function detectUnit(raw: string): DetectedUnit {
  if (!/^[+-]?\d+$/.test(raw)) {
    return { unit: 'invalid' };
  }
  // Leading zeros must not change the reading: gates apply to the numeric
  // magnitude, not the raw digit count (spec §12.1).
  const magnitude = raw.replace(/^[+-]/, '').replace(/^0+(?=\d)/, '');
  // Avoid constructing attacker-controlled BigInts. Decimal comparison is
  // enough for the unit decision and keeps the cost bounded by the input cap.
  const maxMilliseconds = '8640000000000000';
  if (magnitude.length > maxMilliseconds.length) {
    return { unit: 'invalid' };
  }
  if (magnitude.length <= 10) {
    // By convention up to 10 digits is a seconds timestamp.
    return { unit: 'seconds' };
  }
  if (magnitude.length >= 13) {
    // Both readings are representable while the seconds value stays inside
    // Temporal's ±8.64e12 s window; only beyond it is milliseconds the only
    // possible reading (spec §12.1: digit count AND representable range).
    const maxSeconds = MAX_REPRESENTABLE_SECONDS.toString();
    if (magnitude.length > maxSeconds.length || (magnitude.length === maxSeconds.length && magnitude > maxSeconds)) {
      return { unit: 'milliseconds' };
    }
    return { unit: 'ambiguous' };
  }
  // 11–12 digits are representable as seconds AND milliseconds, so neither
  // reading can be ruled out; the spec requires asking the user.
  return { unit: 'ambiguous' };
}
