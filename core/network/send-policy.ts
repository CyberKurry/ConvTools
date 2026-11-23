import type { StorageArea } from '../storage/browser-storage';
import type { PersistenceGuard } from '../storage/persistence-guard';

export interface SendPolicyView {
  readonly origin: string;
  readonly dataCategory: string;
}

export interface SendPolicyStore {
  isAlwaysAllowed(moduleId: string, origin: string, dataCategory: string): Promise<boolean>;
  allowAlways(moduleId: string, origin: string, dataCategory: string): Promise<void>;
  /** Every always-allow grant recorded for a module (spec §9.4). */
  listPolicies(moduleId: string): Promise<readonly SendPolicyView[]>;
  /** Revokes every always-allow grant recorded for a module. */
  clearPolicies(moduleId: string): Promise<void>;
}

/**
 * Each policy lives under its own storage key so concurrent "always allow"
 * confirmations can never clobber each other (a single shared object would
 * lose sibling policies on overlapping read-modify-write cycles).
 */
const POLICY_PREFIX = 'sendPolicy:';

// Segment encoding keeps '|' inside a category or origin from colliding with
// a different module/origin/category triple.
export function policyKey(moduleId: string, origin: string, dataCategory: string): string {
  return `${POLICY_PREFIX}${encodeURIComponent(moduleId)}|${encodeURIComponent(origin)}|${encodeURIComponent(dataCategory)}`;
}

function policyKeyPrefix(moduleId: string): string {
  return `${POLICY_PREFIX}${encodeURIComponent(moduleId)}|`;
}

function parsePolicyKey(key: string, moduleId: string): SendPolicyView | null {
  const prefix = policyKeyPrefix(moduleId);
  if (!key.startsWith(prefix)) {
    return null;
  }
  const rest = key.slice(prefix.length);
  // Encoded segments cannot contain '|', so the first '|' splits origin from
  // category; anything else is a malformed key and is ignored.
  const separator = rest.indexOf('|');
  if (separator < 0) {
    return null;
  }
  try {
    return {
      origin: decodeURIComponent(rest.slice(0, separator)),
      dataCategory: decodeURIComponent(rest.slice(separator + 1)),
    };
  } catch {
    return null;
  }
}

export function createSendPolicyStore(area: StorageArea, guard: PersistenceGuard): SendPolicyStore {
  return {
    async isAlwaysAllowed(moduleId, origin, dataCategory) {
      const key = policyKey(moduleId, origin, dataCategory);
      const stored = await area.get([key]);
      return stored[key] === true;
    },
    async allowAlways(moduleId, origin, dataCategory) {
      const key = policyKey(moduleId, origin, dataCategory);
      await guard.write(area, { [key]: true });
    },
    async listPolicies(moduleId) {
      const all = await area.get();
      const views: SendPolicyView[] = [];
      for (const key of Object.keys(all)) {
        if (all[key] !== true) {
          continue;
        }
        const view = parsePolicyKey(key, moduleId);
        if (view) {
          views.push(view);
        }
      }
      views.sort((a, b) => (a.origin === b.origin ? (a.dataCategory < b.dataCategory ? -1 : 1) : a.origin < b.origin ? -1 : 1));
      return views;
    },
    async clearPolicies(moduleId) {
      const prefix = policyKeyPrefix(moduleId);
      const all = await area.get();
      const keys = Object.keys(all).filter((key) => key.startsWith(prefix));
      if (keys.length > 0) {
        await guard.remove(area, keys);
      }
    },
  };
}
