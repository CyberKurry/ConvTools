import { describe, expect, it } from 'vitest';
import { MemoryArea, type StorageValue } from '../../../core/storage/browser-storage';

describe('MemoryArea', () => {
  it('stores prototype-suspicious keys as own data properties', async () => {
    const area = new MemoryArea();
    const malicious = JSON.parse('{"__proto__": {"polluted": true}}') as Record<string, StorageValue>;
    await area.set(malicious);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    const snapshot = area.snapshot();
    expect(Object.prototype.hasOwnProperty.call(snapshot, '__proto__')).toBe(true);
    expect(Object.getOwnPropertyDescriptor(snapshot, '__proto__')?.value).toEqual({ polluted: true });
  });
});
