import { describe, expect, it } from 'vitest';
import { resolveLocalTime } from './local-time';

describe('DST disambiguation', () => {
  it('returns a unique instant when the local time exists once', () => {
    const result = resolveLocalTime('2024-01-15T12:00:00', 'America/New_York');
    expect(result.kind).toBe('unique');
  });

  it('errors on a nonexistent spring-forward time', () => {
    const result = resolveLocalTime('2024-03-10T02:30:00', 'America/New_York');
    expect(result.kind).toBe('nonexistent');
  });

  it('lists two offsets for a repeated fall-back time', () => {
    const result = resolveLocalTime('2024-11-03T01:30:00', 'America/New_York');
    expect(result.kind).toBe('ambiguous');
    if (result.kind === 'ambiguous') {
      expect(result.earlier.epochSeconds).not.toBe(result.later.epochSeconds);
    }
  });
});
