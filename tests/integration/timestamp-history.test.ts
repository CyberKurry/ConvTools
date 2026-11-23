import { describe, expect, it, vi } from 'vitest';
import { recordTimestampHistory } from '../../modules/timestamp/history';

describe('timestamp history', () => {
  it('stores normalized input, result, zone, action, and time', async () => {
    const append = vi.fn(() => Promise.resolve());
    await recordTimestampHistory(
      { append, list: () => Promise.resolve([]), clear: () => Promise.resolve() },
      { action: 'timestamp-to-date', input: '0', result: '1970-01-01T00:00:00Z', timeZone: 'UTC' },
    );
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'text',
        action: 'timestamp-to-date',
        input: '0',
        output: '1970-01-01T00:00:00Z',
        timeZone: 'UTC',
      }),
    );
  });
});
