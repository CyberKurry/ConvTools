import { createNetworkBroker, NetworkBrokerError } from '../network/network-broker';
import { NETWORK_DENIED } from '../network/network-broker';
import { createSendPolicyStore } from '../network/send-policy';
import type { ConfirmationChoice, NetworkRequestIntent } from '../network/types';
import { createPermissionService, UndeclaredCapabilityError, type PermissionService } from './permission-service';
import type { BrowserPermissionsApi, DeclaredCapabilities } from './types';
import type { StorageArea } from '../storage/browser-storage';
import type { PersistenceGuard } from '../storage/persistence-guard';

export interface CapabilityHost {
  /** Declared optional capabilities by module id (from the generated manifest). */
  readonly manifests: Readonly<Record<string, DeclaredCapabilities>>;
  /** Absent (e.g. in tests without a browser) means every request is denied. */
  readonly permissionsApi?: BrowserPermissionsApi;
  /** Absent means the network proxy resolves to undefined for every intent. */
  readonly fetchImpl?: typeof fetch;
  /**
   * Send-confirmation callback for "ask every time" (spec §13.2). Unwired
   * means deny: without a dialog there is no informed consent, so nothing is
   * ever sent.
   */
  readonly confirmSend?: (intent: NetworkRequestIntent) => Promise<ConfirmationChoice>;
  readonly policyArea: StorageArea;
  readonly guard: PersistenceGuard;
}

export interface WiredCapabilities {
  request(moduleId: string, permissions: readonly string[], origins: readonly string[]): Promise<boolean>;
  contains(moduleId: string, permissions: readonly string[], origins: readonly string[]): Promise<boolean>;
  /**
   * Resolves to undefined when the module has no network capability at all,
   * when the intent is malformed, or when the user denied the send.
   */
  requestNetwork(moduleId: string, intent: unknown, options?: { signal?: AbortSignal }): Promise<unknown>;
  revoke(moduleId: string): Promise<void>;
}

function isNetworkRequestIntent(value: unknown): value is NetworkRequestIntent {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const intent = value as Record<string, unknown>;
  const byteCount = intent.byteCount;
  const method = intent.method;
  const timeoutMs = intent.timeoutMs;
  const permission = intent.permission;
  return (
    typeof intent.moduleId === 'string' &&
    typeof intent.origin === 'string' &&
    typeof intent.dataCategory === 'string' &&
    typeof byteCount === 'number' &&
    Number.isSafeInteger(byteCount) &&
    byteCount >= 0 &&
    typeof method === 'string' &&
    method.length > 0 &&
    typeof timeoutMs === 'number' &&
    Number.isFinite(timeoutMs) &&
    timeoutMs >= 0 &&
    typeof intent.redactedPreview === 'string' &&
    typeof permission === 'string' &&
    permission.length > 0 &&
    (intent.body === undefined || typeof intent.body === 'string')
  );
}

/**
 * The single seam between the kernel's ModuleContext and the real permission /
 * network infrastructure (spec §8.1/§13.2). Modules never see the services
 * themselves, only the scoped proxies defined here.
 */
export function wireModuleCapabilities(host: CapabilityHost): WiredCapabilities {
  const declared = host.manifests;
  const service: PermissionService | null = host.permissionsApi
    ? createPermissionService({
        declared,
        api: host.permissionsApi,
        // Counts are shared through storage.local so a revoke in one context
        // releases claims made by another (spec §13.2).
        claims: { area: host.policyArea, guard: host.guard },
      })
    : null;
  const policies = createSendPolicyStore(host.policyArea, host.guard);
  const brokers = new Map<string, ReturnType<typeof createNetworkBroker>>();

  function declaredFor(moduleId: string): DeclaredCapabilities | null {
    return declared[moduleId] ?? null;
  }

  function brokerFor(moduleId: string) {
    const existing = brokers.get(moduleId);
    if (existing) {
      return existing;
    }
    const manifest = declaredFor(moduleId);
    if (!manifest || manifest.optionalHostPermissions.length === 0 || !host.fetchImpl) {
      return null;
    }
    const broker = createNetworkBroker({
      fetchImpl: host.fetchImpl,
      confirm: (intent) => (host.confirmSend ? host.confirmSend(intent) : Promise.resolve('deny')),
      policies,
      declaredOrigins: { [moduleId]: manifest.optionalHostPermissions },
      hasPermission: async (intent) => {
        if (!service) {
          return false;
        }
        try {
          return await service.request({
            moduleId,
            permissions: [],
            origins: [intent.permission],
          });
        } catch {
          return false;
        }
      },
    });
    brokers.set(moduleId, broker);
    return broker;
  }

  async function withService(action: (service: PermissionService) => Promise<boolean>): Promise<boolean> {
    if (!service) {
      return false;
    }
    try {
      return await action(service);
    } catch {
      // Undeclared capabilities are contract errors for the module developer;
      // from the module's perspective the answer is simply "not granted".
      return false;
    }
  }

  return {
    request(moduleId, permissions, origins) {
      return withService((service) => service.request({ moduleId, permissions, origins }));
    },
    contains(moduleId, permissions, origins) {
      return withService((service) => service.contains({ moduleId, permissions, origins }));
    },
    async requestNetwork(moduleId, rawIntent, requestOptions) {
      if (!isNetworkRequestIntent(rawIntent)) {
        return undefined;
      }
      const intent = rawIntent;
      if (intent.moduleId !== moduleId) {
        return undefined;
      }
      const broker = brokerFor(moduleId);
      if (!broker) {
        return undefined;
      }
      try {
        return await broker.request(intent, requestOptions);
      } catch (error) {
        if (error instanceof NetworkBrokerError && error.code === NETWORK_DENIED) {
          // A denial disables the network capability only; the module stays
          // functional otherwise (spec §13.2). Surface denial as undefined so
          // modules can fall back to their offline behavior.
          return undefined;
        }
        if (error instanceof UndeclaredCapabilityError) {
          // A malformed or undeclared target resolves to undefined per the
          // documented requestNetwork contract; modules take their offline
          // fallback instead of crashing on a bad intent.
          return undefined;
        }
        throw error;
      }
    },
    async revoke(moduleId) {
      if (service) {
        await service.releaseModule(moduleId);
      }
      // Reference counts are per-context in-memory claims: a revoke issued
      // from another context (or after a page reload) would otherwise be a
      // silent no-op while the browser grant stays live. Fall back to the
      // module's declared capabilities, skipping anything another module
      // still claims (shared-permission refcount, spec §13.2; the counts
      // themselves live in storage.local so every context sees them).
      const manifest = declaredFor(moduleId);
      if (!manifest || !host.permissionsApi) {
        return;
      }
      const unclaimed = async (values: readonly string[]): Promise<string[]> => {
        const held = new Set<string>();
        for (const value of values) {
          if (service && (await service.holders(value)).length > 0) {
            held.add(value);
          }
        }
        return values.filter((value) => !held.has(value));
      };
      const permissions = await unclaimed(manifest.optionalPermissions);
      const origins = await unclaimed(manifest.optionalHostPermissions);
      if (permissions.length > 0) {
        await host.permissionsApi.remove({ permissions });
      }
      if (origins.length > 0) {
        await host.permissionsApi.remove({ origins });
      }
    },
  };
}
