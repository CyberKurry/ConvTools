import type { StorageArea, StorageValue } from './browser-storage';

/**
 * Minimal structural type for the browser-provided storage area. Production
 * callers pass `browser.storage.sync` / `browser.storage.local`; tests pass a
 * fake with the same shape. Values are JSON-compatible, so the raw record is
 * safe to expose as StorageValue after the repository-level validators run.
 */
export interface RawBrowserStorageArea {
  get(key?: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string | string[]): Promise<void>;
  clear(): Promise<void>;
}

export class BrowserStorageArea implements StorageArea {
  constructor(private readonly raw: RawBrowserStorageArea) {}

  async get(keys?: readonly string[]): Promise<Record<string, StorageValue>> {
    const stored = keys ? await this.raw.get([...keys]) : await this.raw.get();
    return stored as Record<string, StorageValue>;
  }

  async set(items: Record<string, StorageValue>): Promise<void> {
    await this.raw.set(items);
  }

  async remove(keys: readonly string[]): Promise<void> {
    await this.raw.remove([...keys]);
  }

  async clear(): Promise<void> {
    await this.raw.clear();
  }
}
