import type { NamespacedStorage } from '../module-sdk/context';
import type { StorageArea, StorageValue } from './browser-storage';
import type { PersistenceGuard } from './persistence-guard';

export function moduleStorageKey(moduleId: string, key: string): string {
  return `module:${moduleId}:${key}`;
}

/**
 * A session-scoped overlay bag shared by every namespaced view created for
 * the same incognito background instance (spec §12A.1/§14: settings writes
 * live for the session, not for a single action).
 */
export interface IncognitoStorageSession {
  readonly overlay: Map<string, StorageValue>;
  readonly tombstones: Set<string>;
}

export function createIncognitoStorageSession(): IncognitoStorageSession {
  return { overlay: new Map(), tombstones: new Set() };
}

/**
 * Builds a module's namespaced settings view. In incognito the guard blocks
 * every persistent write, so writes, removes, and clears land in an in-memory
 * overlay instead (spec §14: no settings changes persist, but the UI keeps
 * working); reads consult the overlay before the shared area. The shared
 * area's existing values are never mutated or deleted in incognito. Pass a
 * shared `session` bag when several views must observe each other's writes.
 */
export function createModuleStorage(
  moduleId: string,
  area: StorageArea,
  guard: PersistenceGuard,
  session?: IncognitoStorageSession,
): NamespacedStorage {
  const prefix = `module:${moduleId}:`;

  if (!guard.blocked) {
    return {
      async get<T>(key: string): Promise<T | undefined> {
        const stored = await area.get([moduleStorageKey(moduleId, key)]);
        return stored[moduleStorageKey(moduleId, key)] as T | undefined;
      },
      async set<T>(key: string, value: T): Promise<void> {
        await guard.write(area, { [moduleStorageKey(moduleId, key)]: value as StorageValue });
      },
      async remove(key: string): Promise<void> {
        await guard.remove(area, [moduleStorageKey(moduleId, key)]);
      },
      async clear(): Promise<void> {
        const all = await area.get();
        const keys = Object.keys(all).filter((key) => key.startsWith(prefix));
        if (keys.length > 0) {
          await guard.remove(area, keys);
        }
      },
    };
  }

  const overlay = session?.overlay ?? new Map<string, StorageValue>();
  const tombstones = session?.tombstones ?? new Set<string>();

  return {
    async get<T>(key: string): Promise<T | undefined> {
      const fullKey = moduleStorageKey(moduleId, key);
      if (tombstones.has(fullKey)) {
        return undefined;
      }
      if (overlay.has(fullKey)) {
        return overlay.get(fullKey) as T | undefined;
      }
      const stored = await area.get([fullKey]);
      return stored[fullKey] as T | undefined;
    },
    set<T>(key: string, value: T): Promise<void> {
      const fullKey = moduleStorageKey(moduleId, key);
      tombstones.delete(fullKey);
      overlay.set(fullKey, value as StorageValue);
      return Promise.resolve();
    },
    remove(key: string): Promise<void> {
      const fullKey = moduleStorageKey(moduleId, key);
      overlay.delete(fullKey);
      tombstones.add(fullKey);
      return Promise.resolve();
    },
    async clear(): Promise<void> {
      const all = await area.get();
      for (const key of Object.keys(all)) {
        if (key.startsWith(prefix)) {
          tombstones.add(key);
        }
      }
      overlay.clear();
    },
  };
}
