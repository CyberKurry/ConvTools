import { describe, expect, it, vi } from 'vitest';
import manifest from './module.json';
import timestampModule from './index';
import type { SelectionActionContext } from '../../core/module-sdk/runtime';
import { browserTimeZone } from './core/timezones';

describe('timestamp module', () => {
  it('declares a matching kebab-case id', () => {
    expect(manifest.id).toBe('timestamp');
    expect(manifest.defaultEnabled).toBe(true);
    expect(manifest.defaultQuickOrder).toBe(20);
  });

  it('rejects invalid selection input and records successful conversions', async () => {
    const append = vi.fn(() => Promise.resolve());
    const context: SelectionActionContext = {
      history: { append, list: () => Promise.resolve([]), clear: () => Promise.resolve() },
      storage: { get: () => Promise.resolve(undefined), set: () => Promise.resolve(), remove: () => Promise.resolve(), clear: () => Promise.resolve() },
      i18n: {
        locale: 'en',
        t: (key) => ({ invalidTimestamp: 'invalid timestamp', ambiguousUnitOverlay: 'ambiguous', outOfRange: 'out of range' }[key] ?? key),
      },
      defaultTimezone: 'UTC',
      signal: new AbortController().signal,
      page: () => Promise.resolve(null),
    };
    const action = timestampModule.surfaces.selectionActions[0];
    if (!action) {
      throw new Error('timestamp selection action missing');
    }
    expect(() => action.run('not-a-number', context)).toThrow('invalid timestamp');
    expect(action.run('0', context)).toContain('1970-01-01T00:00:00Z');
    await vi.waitFor(() => expect(append).toHaveBeenCalledTimes(1));
  });

  it('falls back to the browser timezone when the stored default is invalid', () => {
    const context: SelectionActionContext = {
      history: { append: vi.fn(() => Promise.resolve()), list: () => Promise.resolve([]), clear: () => Promise.resolve() },
      storage: { get: () => Promise.resolve(undefined), set: () => Promise.resolve(), remove: () => Promise.resolve(), clear: () => Promise.resolve() },
      i18n: { locale: 'en', t: (key) => key },
      defaultTimezone: 'Not/AZone',
      signal: new AbortController().signal,
      page: () => Promise.resolve(null),
    };
    expect(timestampModule.surfaces.selectionActions[0]?.run('0', context)).toContain(
      `(${globalThis.Temporal.Instant.fromEpochNanoseconds(0n).toZonedDateTimeISO(browserTimeZone()).toString()})`,
    );
  });
});
