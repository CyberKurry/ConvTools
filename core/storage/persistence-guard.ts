import type { StorageArea, StorageValue } from './browser-storage';

export const PERSISTENCE_BLOCKED = 'PERSISTENCE_BLOCKED';

export class PersistenceBlockedError extends Error {
  readonly code = PERSISTENCE_BLOCKED;

  constructor(message = 'persistent writes are blocked in incognito') {
    super(message);
    this.name = 'PersistenceBlockedError';
  }
}

export class PersistenceGuard {
  constructor(private readonly incognito: boolean) {}

  get blocked(): boolean {
    return this.incognito;
  }

  async write(area: StorageArea, items: Record<string, StorageValue>): Promise<void> {
    if (this.incognito) {
      throw new PersistenceBlockedError();
    }
    await area.set(items);
  }

  async remove(area: StorageArea, keys: readonly string[]): Promise<void> {
    if (this.incognito) {
      throw new PersistenceBlockedError();
    }
    await area.remove(keys);
  }
}