import { describe, expect, it } from 'vitest';
import { detectUnit } from './detect-unit';
import { parseIntegerTimestamp } from './instant';
import { listTimezones } from './timezones';

describe('timestamp conversion', () => {
  it('detects seconds and milliseconds from digit count', () => {
    expect(detectUnit('0').unit).toBe('seconds');
    expect(detectUnit('1710000000').unit).toBe('seconds');
    // 1.71e12 ms is still inside the seconds-representable window → ambiguous.
    expect(detectUnit('1710000000000').unit).toBe('ambiguous');
    expect(detectUnit('9000000000000').unit).toBe('milliseconds');
    expect(detectUnit('-1').unit).toBe('seconds');
  });

  it('ignores leading zeros when judging the unit', () => {
    // The gates measure the numeric magnitude, not the raw digit count.
    expect(detectUnit('00000000000000009999999999').unit).toBe('seconds');
    expect(detectUnit('0001710000000000').unit).toBe('ambiguous');
    expect(detectUnit('-007').unit).toBe('seconds');
  });

  it('treats 11-12 digit values as ambiguous', () => {
    expect(detectUnit('12345678901').unit).toBe('ambiguous');
  });

  it('converts seconds and milliseconds to ISO UTC', () => {
    const seconds = parseIntegerTimestamp('0', 'seconds');
    expect(seconds.isoUtc).toBe('1970-01-01T00:00:00Z');
    const millis = parseIntegerTimestamp('0', 'milliseconds');
    expect(millis.epochMilliseconds).toBe(0n);
  });

  it('rejects values outside Temporal range', () => {
    expect(() => parseIntegerTimestamp('8640000000001', 'seconds')).toThrow(/supported range/);
  });

  it('lists UTC and the browser zone first', () => {
    const zones = listTimezones('Pacific/Auckland');
    expect(zones[0]).toBe('UTC');
    expect(zones[1]).toBe('Pacific/Auckland');
  });
});

describe('ultrareview batch 4', () => {
  it('treats 13-digit values inside the seconds range as ambiguous', () => {
    expect(detectUnit('4000000000000').unit).toBe('ambiguous');
    expect(detectUnit('9999999999999').unit).toBe('milliseconds');
    expect(detectUnit('-9999999999999').unit).toBe('milliseconds');
    expect(detectUnit('+1710000000').unit).toBe('seconds');
  });

  it('never throws on non-numeric garbage', () => {
    expect(() => detectUnit('banana')).not.toThrow();
    expect(detectUnit('banana').unit).toBe('invalid');
    expect(detectUnit('').unit).toBe('invalid');
  });

  it('accepts zero-padded values that are inside the representable range (L)', () => {
    // 17 characters, but the value (-1) is perfectly representable: only the
    // magnitude may decide the range check.
    const parts = parseIntegerTimestamp('-00000000000000001', 'seconds');
    expect(parts.isoUtc).toBe('1969-12-31T23:59:59Z');
    expect(parseIntegerTimestamp('000000000000000000000001', 'milliseconds').epochMilliseconds).toBe(1n);
  });

  it('rejects oversized decimal representations before BigInt allocation', () => {
    expect(detectUnit('1'.repeat(1_000_000)).unit).toBe('invalid');
    expect(() => parseIntegerTimestamp('1'.repeat(1_000_000), 'milliseconds')).toThrow(/supported range/);
  });

  it('renders the selected timezone for forward conversion', () => {
    const parts = parseIntegerTimestamp('0', 'seconds', 'Asia/Shanghai');
    expect(parts.zoned).toContain('+08:00');
  });

  it('keeps UTC as the default zone for forward conversion', () => {
    const parts = parseIntegerTimestamp('0', 'seconds');
    expect(parts.isoUtc).toBe('1970-01-01T00:00:00Z');
    expect(parts.zoned).toBe('1970-01-01T00:00:00+00:00[UTC]');
  });

  it('floors negative epoch seconds and milliseconds consistently with ISO', () => {
    const parts = parseIntegerTimestamp('-1500', 'milliseconds');
    expect(parts.epochSeconds).toBe(-2n);
    expect(parts.epochMilliseconds).toBe(-1500n);
    expect(parts.isoUtc).toBe('1969-12-31T23:59:58.500Z'.replace('.500', '.5'));
  });
});
