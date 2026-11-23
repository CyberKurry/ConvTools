import { createMemoryClaimStore, createStorageClaimStore, type PermissionClaimStore } from './claim-store';
import type { BrowserPermissionsApi, DeclaredCapabilities, PermissionRequest } from './types';
import type { StorageArea } from '../storage/browser-storage';
import type { PersistenceGuard } from '../storage/persistence-guard';

export const UNDECLARED_PERMISSION = 'UNDECLARED_PERMISSION';
export const UNDECLARED_ORIGIN = 'UNDECLARED_ORIGIN';

export class UndeclaredCapabilityError extends Error {
  readonly code: typeof UNDECLARED_PERMISSION | typeof UNDECLARED_ORIGIN;

  constructor(code: typeof UNDECLARED_PERMISSION | typeof UNDECLARED_ORIGIN, message: string) {
    super(message);
    this.name = 'UndeclaredCapabilityError';
    this.code = code;
  }
}

export interface PermissionService {
  request(input: PermissionRequest): Promise<boolean>;
  releaseModule(moduleId: string): Promise<void>;
  contains(input: PermissionRequest): Promise<boolean>;
  /** Modules still holding a claim on the permission in this context. */
  holders(permission: string): Promise<readonly string[]>;
}

export function createPermissionService(options: {
  declared: Readonly<Record<string, DeclaredCapabilities>>;
  api: BrowserPermissionsApi;
  /**
   * Durable claim storage shared by every context. Absent means counts are
   * private to this instance (tests and non-persistent hosts).
   */
  claims?: { area: StorageArea; guard: PersistenceGuard };
}): PermissionService {
  const counts: PermissionClaimStore = options.claims
    ? createStorageClaimStore(options.claims)
    : createMemoryClaimStore();

  function assertDeclared(input: PermissionRequest): DeclaredCapabilities {
    const declared = options.declared[input.moduleId];
    if (!declared) {
      throw new UndeclaredCapabilityError(UNDECLARED_PERMISSION, `unknown module ${input.moduleId}`);
    }
    for (const permission of input.permissions) {
      if (!declared.optionalPermissions.includes(permission)) {
        throw new UndeclaredCapabilityError(UNDECLARED_PERMISSION, `undeclared permission ${permission}`);
      }
    }
    for (const origin of input.origins) {
      if (!declared.optionalHostPermissions.includes(origin)) {
        throw new UndeclaredCapabilityError(UNDECLARED_ORIGIN, `undeclared origin ${origin}`);
      }
    }
    return declared;
  }

  return {
    async request(input) {
      assertDeclared(input);
      const granted = await options.api.contains({
        permissions: [...input.permissions],
        origins: [...input.origins],
      });
      const ok = granted
        ? true
        : await options.api.request({
            permissions: [...input.permissions],
            origins: [...input.origins],
          });
      if (ok) {
        for (const permission of input.permissions) {
          await counts.claim(input.moduleId, permission);
        }
        for (const origin of input.origins) {
          await counts.claim(input.moduleId, origin);
        }
      }
      return ok;
    },
    async contains(input) {
      assertDeclared(input);
      return options.api.contains({
        permissions: [...input.permissions],
        origins: [...input.origins],
      });
    },
    async releaseModule(moduleId) {
      const revoked = await counts.releaseAll(moduleId);
      const permissions = revoked.filter((item) => !item.includes('://'));
      const origins = revoked.filter((item) => item.includes('://'));
      if (permissions.length > 0) {
        await options.api.remove({ permissions });
      }
      if (origins.length > 0) {
        await options.api.remove({ origins });
      }
    },
    holders(permission) {
      return counts.holders(permission);
    },
  };
}