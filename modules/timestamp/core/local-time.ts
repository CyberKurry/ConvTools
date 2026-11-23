import { describeInstant } from './instant';
import type { LocalTimeResolution } from './types';

export function resolveLocalTime(isoLocal: string, timeZone: string): LocalTimeResolution {
  // overflow: 'reject' keeps impossible calendar dates (2024-02-30) a visible
  // error instead of silently normalizing them to the last valid day.
  const plain = globalThis.Temporal.PlainDateTime.from(isoLocal, { overflow: 'reject' });
  const earlier = plain.toZonedDateTime(timeZone, { disambiguation: 'earlier' }).toInstant();
  const later = plain.toZonedDateTime(timeZone, { disambiguation: 'later' }).toInstant();
  const earlierRoundTrip = earlier.toZonedDateTimeISO(timeZone).toPlainDateTime();
  const laterRoundTrip = later.toZonedDateTimeISO(timeZone).toPlainDateTime();
  const earlierMatches = globalThis.Temporal.PlainDateTime.compare(earlierRoundTrip, plain) === 0;
  const laterMatches = globalThis.Temporal.PlainDateTime.compare(laterRoundTrip, plain) === 0;
  if (!earlierMatches && !laterMatches) {
    return { kind: 'nonexistent' };
  }
  if (earlierMatches && laterMatches && earlier.epochNanoseconds !== later.epochNanoseconds) {
    return {
      kind: 'ambiguous',
      earlier: describeInstant(earlier, timeZone),
      later: describeInstant(later, timeZone),
    };
  }
  const chosen = earlierMatches ? earlier : later;
  return { kind: 'unique', instant: describeInstant(chosen, timeZone) };
}
