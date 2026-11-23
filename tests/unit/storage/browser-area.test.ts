import { describe, expect, it, vi } from 'vitest';
import { BrowserStorageArea } from '../../../core/storage/browser-area';

function fakeRaw() {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: vi.fn((key?: string | string[] | null) => {
      if (!key) {
        return Promise.resolve({ ...data });
      }
      const keys = Array.isArray(key) ? key : [key];
      const result: Record<string, unknown> = {};
      for (const item of keys) {
        // Own keys only, defined as data properties: the browser API returns
        // JSON-parsed records, so an own '__proto__' key must come back as an
        // own key rather than hitting the inherited setter.
        if (Object.prototype.hasOwnProperty.call(data, item)) {
          Object.defineProperty(result, item, {
            value: data[item],
            enumerable: true,
            writable: true,
            configurable: true,
          });
        }
      }
      return Promise.resolve(result);
    }),
    set: vi.fn((items: Record<string, unknown>) => {
      const serialized = JSON.parse(JSON.stringify(items)) as Record<string, unknown>;
      for (const key of Object.keys(serialized)) {
        Object.defineProperty(data, key, {
          value: serialized[key],
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return Promise.resolve();
    }),
    remove: vi.fn((key: string | string[]) => {
      for (const item of Array.isArray(key) ? key : [key]) {
        delete data[item];
      }
      return Promise.resolve();
    }),
    clear: vi.fn(() => {
      for (const item of Object.keys(data)) {
        delete data[item];
      }
      return Promise.resolve();
    }),
  };
}

describe('BrowserStorageArea', () => {
  it('maps get with key list onto the raw area and returns only requested keys', async () => {
    const raw = fakeRaw();
    await raw.set({ theme: 'dark', locale: 'zh_CN' });
    const area = new BrowserStorageArea(raw);
    const result = await area.get(['theme']);
    expect(raw.get).toHaveBeenCalledWith(['theme']);
    expect(result).toEqual({ theme: 'dark' });
  });

  it('reads the whole area when no keys are provided', async () => {
    const raw = fakeRaw();
    await raw.set({ theme: 'dark' });
    const area = new BrowserStorageArea(raw);
    expect(await area.get()).toEqual({ theme: 'dark' });
    expect(raw.get).toHaveBeenCalledWith();
  });

  it('forwards set, remove, and clear', async () => {
    const raw = fakeRaw();
    const area = new BrowserStorageArea(raw);
    await area.set({ enabledModuleIds: ['base64'] });
    expect(raw.data.enabledModuleIds).toEqual(['base64']);
    await area.remove(['enabledModuleIds']);
    expect(raw.data.enabledModuleIds).toBeUndefined();
    await area.set({ historyEnabled: true });
    await area.clear();
    expect(raw.data).toEqual({});
    expect(raw.clear).toHaveBeenCalledTimes(1);
  });

  it('treats __proto__ as a plain storage key in both directions', async () => {
    const raw = fakeRaw();
    const area = new BrowserStorageArea(raw);
    // An own '__proto__' key (what a JSON round-trip produces) must survive
    // the wrapper: it stays an own data property, and the prototype chain of
    // neither the stored record nor Object.prototype is touched.
    const payload = Object.defineProperty({}, '__proto__', {
      value: 'stored',
      enumerable: true,
      writable: true,
      configurable: true,
    }) as Record<string, string>;
    await area.set(payload);
    expect(Object.prototype).not.toHaveProperty('stored');
    expect(Object.getOwnPropertyDescriptor(raw.data, '__proto__')?.value).toBe('stored');

    const read = await area.get(['__proto__']);
    expect(Object.getOwnPropertyDescriptor(read, '__proto__')?.value).toBe('stored');
    await area.remove(['__proto__']);
    expect(Object.getOwnPropertyDescriptor(raw.data, '__proto__')).toBeUndefined();
  });
});
