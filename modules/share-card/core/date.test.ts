import { describe, expect, it } from 'vitest';
import { formatCardDate } from './date';

describe('formatCardDate', () => {
  it('formats zh dates as zero-padded yyyy/mm/dd', () => {
    expect(formatCardDate('2026-09-07', 'zh_CN')).toBe('2026/09/07');
  });

  it('formats en dates as abbreviated month names', () => {
    expect(formatCardDate('2026-09-07', 'en')).toBe('Sep 7, 2026');
    expect(formatCardDate('2026-01-15', 'en')).toBe('Jan 15, 2026');
  });

  it('returns the raw iso text for malformed dates', () => {
    expect(formatCardDate('not-a-date', 'zh_CN')).toBe('not-a-date');
  });
});
