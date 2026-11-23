import type { StorageArea, StorageValue } from '../storage/browser-storage';
import type { PersistenceGuard } from '../storage/persistence-guard';
import { PermissionReferenceCounts } from './reference-counts';

/**
 * Where the shared-permission reference counts live (spec §13.2: a permission
 * shared by several modules is revoked only when the last holder releases it).
 *
 * The popup, the workbench and the options page each build their own kernel,
 * so per-instance memory would let the options page "revoke" a permission it
 * never saw claimed. Counts therefore live in `storage.local`, which every
 * context shares; the in-memory implementation remains the fallback for
 * contexts where persistent writes are blocked.
 */
export const PERMISSION_CLAIMS_KEY = 'permissionClaims';

export interface PermissionClaimStore {
  claim(moduleId: string, permission: string): Promise<void>;
  releaseAll(moduleId: string): Promise<readonly string[]>;
  /** Modules still holding a claim on the permission (spec §13.2). */
  holders(permission: string): Promise<readonly string[]>;
}

export function createMemoryClaimStore(counts = new PermissionReferenceCounts()): PermissionClaimStore {
  return {
    claim(moduleId, permission) {
      counts.claim(moduleId, permission);
      return Promise.resolve();
    },
    releaseAll(moduleId) {
      return Promise.resolve(counts.releaseAll(moduleId));
    },
    holders(permission) {
      return Promise.resolve(counts.holders(permission));
    },
  };
}

export function createStorageClaimStore(options: {
  area: StorageArea;
  guard: PersistenceGuard;
}): PermissionClaimStore {
  if (options.guard.blocked) {
    // Incognito: every persistent write is blocked, so keep the counts in
    // memory for this context rather than failing a user-gesture request.
    return createMemoryClaimStore();
  }

  async function load(): Promise<PermissionReferenceCounts> {
    const counts = new PermissionReferenceCounts();
    const stored = (await options.area.get([PERMISSION_CLAIMS_KEY]))[PERMISSION_CLAIMS_KEY];
    if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) {
      return counts;
    }
    for (const [permission, holders] of Object.entries(stored as Record<string, StorageValue>)) {
      if (!Array.isArray(holders)) {
        continue;
      }
      for (const holder of holders) {
        if (typeof holder === 'string') {
          counts.claim(holder, permission);
        }
      }
    }
    return counts;
  }

  async function save(counts: PermissionReferenceCounts): Promise<void> {
    // Read-modify-write per operation: claims change only on an explicit user
    // gesture, so a shared cache would risk clobbering another context's
    // claim for no measurable gain.
    await options.guard.write(options.area, { [PERMISSION_CLAIMS_KEY]: counts.snapshot() });
  }

  return {
    async claim(moduleId, permission) {
      const counts = await load();
      counts.claim(moduleId, permission);
      await save(counts);
    },
    async releaseAll(moduleId) {
      const counts = await load();
      const revoked = counts.releaseAll(moduleId);
      await save(counts);
      return revoked;
    },
    async holders(permission) {
      return (await load()).holders(permission);
    },
  };
}
