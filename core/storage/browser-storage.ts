export type StorageValue = string | number | boolean | null | StorageValue[] | { [key: string]: StorageValue };

export interface StorageArea {
  get(keys?: readonly string[]): Promise<Record<string, StorageValue>>;
  set(items: Record<string, StorageValue>): Promise<void>;
  remove(keys: readonly string[]): Promise<void>;
  clear(): Promise<void>;
}

export class MemoryArea implements StorageArea {
  private readonly data: Record<string, StorageValue>;

  constructor(initial: Record<string, StorageValue> = {}) {
    this.data = { ...initial };
  }

  get(keys?: readonly string[]): Promise<Record<string, StorageValue>> {
    if (!keys) {
      return Promise.resolve({ ...this.data });
    }
    const result: Record<string, StorageValue> = {};
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(this.data, key)) {
        const value = this.data[key];
        if (value !== undefined) {
          result[key] = value;
        }
      }
    }
    return Promise.resolve(result);
  }

  set(items: Record<string, StorageValue>): Promise<void> {
    for (const key of Object.keys(items)) {
      // [[Set]] on '__proto__' would hit the inherited accessor instead of
      // creating a stored key; define an own data property so storage keys can
      // never mutate the prototype chain.
      Object.defineProperty(this.data, key, {
        value: items[key],
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return Promise.resolve();
  }

  remove(keys: readonly string[]): Promise<void> {
    for (const key of keys) {
      delete this.data[key];
    }
    return Promise.resolve();
  }

  clear(): Promise<void> {
    for (const key of Object.keys(this.data)) {
      delete this.data[key];
    }
    return Promise.resolve();
  }

  snapshot(): Record<string, StorageValue> {
    return { ...this.data };
  }
}