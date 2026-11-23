import { createHistoryService } from './history/history-service';
import { createNamespacedHistory } from './history/namespaced-history';
import { GLOBAL_HISTORY_BYTES, MODULE_HISTORY_LIMIT } from './history/quota';
import type { ModuleHistoryInput } from './history/record';
import { resolveLocale } from './i18n/types';
import { createModuleI18n } from './i18n/module-i18n';
import { CURRENT_SCHEMA_VERSION, type SyncSettings } from './storage/schema';
import { createSendPolicyStore, type SendPolicyStore } from './network/send-policy';
import { PersistenceBlockedError } from './storage/persistence-guard';
import { moduleLoaders } from '../generated/module-registry';
import type { HistoryRecord } from './history/types';
import { moduleDisplayNames, moduleManifests } from '../generated/module-manifest';
import type { ModuleContext, NamespacedHistory } from './module-sdk/context';
import type { ToolModuleDefinition } from './module-sdk/runtime';
import { createCatalog } from './registry/catalog';
import { createModuleLoader } from './registry/load-module';
import { createLifecycle } from './registry/lifecycle';
import { createModuleStorage } from './storage/module-storage';
import { runModuleMigrations } from './storage/module-migrations';
import { PersistenceGuard } from './storage/persistence-guard';
import { createSettingsRepository } from './storage/settings-repository';
import { wireModuleCapabilities, type WiredCapabilities } from './permissions/capabilities';
import type { BrowserPermissionsApi } from './permissions/types';
import type { ConfirmationChoice, NetworkRequestIntent } from './network/types';
import { MemoryArea } from './storage/browser-storage';
import type { StorageArea } from './storage/browser-storage';

export type { NamespacedHistory, ModuleHistoryInput };

export interface KernelSnapshot extends SettingsLike {
  readonly modules: readonly KernelModule[];
  readonly quickModuleIds: readonly string[];
  readonly historyEnabled: boolean;
}

export interface KernelModule {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly definition: ToolModuleDefinition | null;
  /**
   * True when the module's UI chunk exists but failed to load (spec §15:
   * a load failure is recoverable and must read differently from a module
   * that does not exist at all).
   */
  readonly loadFailed: boolean;
}

export interface SendPolicyView {
  readonly origin: string;
  readonly dataCategory: string;
}

export interface SettingsLike {
  readonly locale: 'auto' | 'en' | 'zh_CN';
  readonly theme: 'system' | 'light' | 'dark';
  readonly timezone: string | null;
  readonly enabledModuleIds: readonly string[];
  readonly lastQuickModuleId: string | null;
}



interface KernelOptions {
  readonly storageSync?: StorageArea;
  readonly storageLocal?: StorageArea;
  readonly incognito?: boolean;
  /** Browser permissions API; absent means optional permissions are denied. */
  readonly permissionsApi?: BrowserPermissionsApi;
  /** Transport for the network broker; absent means no network capability. */
  readonly fetchImpl?: typeof fetch;
  /** Send confirmation ("ask every time"); absent means deny (no UI = no consent). */
  readonly confirmSend?: (intent: NetworkRequestIntent) => Promise<ConfirmationChoice>;
}

export interface Kernel {
  snapshot(): Promise<KernelSnapshot>;
  subscribe(listener: () => void): () => void;
  setup(): Promise<void>;
  setLocale(value: SettingsLike['locale']): Promise<void>;
  setTheme(value: SettingsLike['theme']): Promise<void>;
  setHistoryEnabled(value: boolean): Promise<void>;
  setTimezone(value: string | null): Promise<void>;
  enableModule(id: string): Promise<void>;
  disableModule(id: string, deleteData: boolean): Promise<void>;
  addQuick(id: string): Promise<void>;
  removeQuick(id: string): Promise<void>;
  reorderQuick(id: string, toIndex: number): Promise<void>;
  moveQuick(id: string, direction: 'left' | 'right'): Promise<void>;
  selectQuick(id: string): Promise<void>;
  revokePermission(id: string): Promise<void>;
  /** "Always allow" send policies recorded for a module (spec §9.4). */
  listSendPolicies(id: string): Promise<readonly SendPolicyView[]>;
  /** Clears every "always allow" send policy recorded for a module. */
  clearSendPolicies(id: string): Promise<void>;
  clearHistory(id?: string): Promise<void>;
  listHistory(id: string): Promise<readonly HistoryRecord[]>;
  /** Writes any debounced settings write immediately (pagehide/beforeunload). */
  flushSettings(): Promise<void>;
}



export function createKernel(options: KernelOptions = {}): Kernel {
  const catalog = createCatalog(moduleManifests);
  const syncArea = options.storageSync ?? new MemoryArea();
  const localArea = options.storageLocal ?? new MemoryArea();
  const guard = new PersistenceGuard(options.incognito ?? false);
  const repository = createSettingsRepository({
    sync: syncArea,
    local: localArea,
    catalog,
    guard,
    debounceMs: 250,
  });
  const loader = createModuleLoader({ loaders: moduleLoaders });
  const historyService = createHistoryService({
    // History is opt-in and setup loads the persisted toggle before any
    // module can append a record.
    enabled: false,
    incognito: options.incognito ?? false,
    moduleLimit: MODULE_HISTORY_LIMIT,
    globalByteLimit: GLOBAL_HISTORY_BYTES,
  });

  const capabilities: WiredCapabilities = wireModuleCapabilities({
    manifests: Object.fromEntries(
      moduleManifests.map((module) => [module.id as string, module.permissions]),
    ),
    // exactOptionalPropertyTypes: only forward provided hooks.
    ...(options.permissionsApi ? { permissionsApi: options.permissionsApi } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.confirmSend ? { confirmSend: options.confirmSend } : {}),
    policyArea: localArea,
    guard,
  });

  const lifecycle = createLifecycle({
    load: (id) => loader.load(id),
    createContext: (moduleId, signal): ModuleContext => {
      const moduleStorage = createModuleStorage(moduleId, localArea, guard);
      const namespacedHistory = createNamespacedHistory(historyService, moduleId);
      return {
        moduleId,
        storage: moduleStorage,
        history: namespacedHistory,
        i18n: createModuleI18n(moduleId, getLocale),
        theme: {
          get scheme() {
            return getTheme() === 'dark' ? 'dark' : 'light';
          },
        },
        get defaultTimezone() {
          return timezone;
        },
        permissions: {
          request: (permissions, origins) => capabilities.request(moduleId, permissions, origins ?? []),
          contains: (permissions, origins) => capabilities.contains(moduleId, permissions, origins ?? []),
        },
        network: { request: (intent) => capabilities.requestNetwork(moduleId, intent, { signal }) },
        log: { debug() {}, info() {}, warn() {}, error() {} },
        signal,
      };
    },
  });

  let locale: SettingsLike['locale'] = 'auto';
  let theme: SettingsLike['theme'] = 'system';
  let timezone: string | null = null;
  let historyEnabled = false;
  let enabledIds = new Set(catalog.defaultEnabledIds);
  let quickIds = [...catalog.defaultQuickIds];
  let lastQuickId: string | null = quickIds[0] ?? null;
  const listeners = new Set<() => void>();
  // Only settings keys this context actually touched are persisted. Every
  // entrypoint owns an independent kernel over the same storage areas, so a
  // full-state write from one context would silently revert fresh changes made
  // by another context (popup vs. options vs. workbench).
  const dirtySync = new Set<keyof SyncSettings>();
  let dirtyLocal = false;
  const sendPolicies: SendPolicyStore = createSendPolicyStore(localArea, guard);

  /** A module only qualifies for the popup quick bar when it declares the surface. */
  function supportsPopup(id: string): boolean {
    return moduleManifests.some((module) => module.id === id && module.surfaces.popup);
  }

  function getLocale(): SettingsLike['locale'] {
    return locale;
  }
  function getTheme(): SettingsLike['theme'] {
    return theme;
  }

  function notify(): void {
    for (const listener of listeners) {
      listener();
    }
  }

  async function loadSettings(): Promise<void> {
    const settings = await repository.read();
    locale = settings.sync.locale;
    theme = settings.sync.theme;
    timezone = settings.sync.defaultTimezone;
    historyEnabled = settings.local.historyEnabled;
    enabledIds = new Set(settings.sync.enabledModuleIds);
    quickIds = settings.sync.quickModuleIds.filter((id) => enabledIds.has(id) && supportsPopup(id));
    lastQuickId = quickIds.includes(settings.sync.lastQuickModuleId ?? '')
      ? settings.sync.lastQuickModuleId
      : (quickIds[0] ?? null);
  }

  function syncPatch(): Partial<SyncSettings> {
    // Only the keys this context mutated are written; untouched keys keep the
    // values stored by whichever context changed them last.
    const patch: { -readonly [K in keyof SyncSettings]+?: SyncSettings[K] } = {};
    if (dirtySync.has('locale')) {
      patch.locale = locale;
    }
    if (dirtySync.has('theme')) {
      patch.theme = theme;
    }
    if (dirtySync.has('enabledModuleIds')) {
      patch.enabledModuleIds = [...enabledIds];
    }
    if (dirtySync.has('quickModuleIds')) {
      patch.quickModuleIds = quickIds;
    }
    if (dirtySync.has('lastQuickModuleId')) {
      patch.lastQuickModuleId = lastQuickId;
    }
    if (dirtySync.has('defaultTimezone')) {
      patch.defaultTimezone = timezone;
    }
    return patch;
  }

  async function persist(): Promise<void> {
    try {
      if (dirtySync.size > 0) {
        await repository.writeSync(syncPatch());
      }
      if (dirtyLocal) {
        await repository.writeLocal({ historyEnabled });
      }
      dirtySync.clear();
      dirtyLocal = false;
    } catch (error) {
      // Spec §14: incognito skips persistence but the UI keeps working on the
      // in-memory state. Storage failures must never break or reverse a user
      // action, and must never surface input data (spec §15 log redaction).
      if (!(error instanceof PersistenceBlockedError)) {
        console.error('SETTINGS_PERSIST_FAILED', error instanceof Error ? error.name : 'unknown');
      }
    }
  }

  async function persistAndNotify(): Promise<void> {
    // Notify first so listeners observe the in-memory state immediately; a
    // failed (or incognito-skipped) persist must not leave stale UI behind.
    notify();
    await persist();
  }

  /**
   * Applies a module's declared storage migrations before it activates (spec
   * §8.3). Failures roll back and are reported, never fatal: a module with
   * unmigratable data still loads and reports its own problem (spec §15).
   */
  async function migrateModuleStorage(id: string): Promise<void> {
    const definition = await loader.load(id);
    if (!definition.migrations || definition.migrations.length === 0) {
      return;
    }
    await runModuleMigrations({
      moduleId: id,
      migrations: definition.migrations,
      area: localArea,
      guard,
    });
  }

  async function setup(): Promise<void> {
    await loadSettings();
    historyService.setEnabled(historyEnabled);
    // Schema guard: a stored version from a newer build must not be silently
    // migrated downward; surface the failure code per spec §15.
    const storedVersion = await localArea.get(['schemaVersion']);
    const version = storedVersion.schemaVersion;
    if (typeof version === 'number' && version > CURRENT_SCHEMA_VERSION) {
      console.error(
        `STORAGE_MIGRATION_FAILED: local schema ${version} is newer than supported ${CURRENT_SCHEMA_VERSION}`,
      );
    } else if (version !== CURRENT_SCHEMA_VERSION) {
      await repository.writeLocal({ schemaVersion: CURRENT_SCHEMA_VERSION }).catch(() => undefined);
    }
    let activationFailed = false;
    for (const id of enabledIds) {
      if (!catalog.modules.some((module) => module.id === id)) {
        continue;
      }
      try {
        await migrateModuleStorage(id);
        await lifecycle.enable(id);
      } catch (error) {
        // A module that fails to activate must not advertise itself as enabled
        // (spec §15): the user sees it disabled instead of a blank surface.
        enabledIds.delete(id);
        activationFailed = true;
        console.error('MODULE_ACTIVATION_FAILED', id, error instanceof Error ? error.name : 'unknown');
      }
    }
    // An activation failure must also drop the module from the quick bar so
    // the snapshot never advertises an enabled:false quick entry.
    quickIds = quickIds.filter((id) => enabledIds.has(id) && supportsPopup(id));
    if (lastQuickId !== null && !quickIds.includes(lastQuickId)) {
      lastQuickId = quickIds[0] ?? null;
    }
    if (activationFailed) {
      // The disabled state must be written out here, not just held in memory:
      // the background reads storage directly for its context menus, so an
      // in-memory-only deletion would leave the popup and the menu disagreeing
      // until some unrelated setter happened to persist the new state.
      dirtySync.add('enabledModuleIds');
      dirtySync.add('quickModuleIds');
      dirtySync.add('lastQuickModuleId');
      await persist();
    }
  }

  async function snapshot(): Promise<KernelSnapshot> {
    // The kernel's in-memory state is the single source of truth: re-reading
    // storage here would clobber changes whose debounced write is still in
    // flight (and undo incognito in-memory settings).
    const definitions = await Promise.all(
      catalog.modules.map(async (module) => {
        let definition: ToolModuleDefinition | null = null;
        let loadFailed = false;
        try {
          definition = await loader.load(module.id);
        } catch {
          definition = null;
          loadFailed = true;
        }
        return { id: module.id, definition, loadFailed };
      }),
    );
    const resolvedLocale = resolveLocale(locale);
    const modules = catalog.modules.map((module, index) => ({
      id: module.id,
      name: moduleDisplayNames[module.id as keyof typeof moduleDisplayNames]?.[resolvedLocale] ?? module.id,
      enabled: enabledIds.has(module.id),
      definition: definitions[index]?.definition ?? null,
      loadFailed: definitions[index]?.loadFailed ?? false,
    }));
    return {
      locale,
      theme,
      timezone,
      historyEnabled,
      enabledModuleIds: [...enabledIds],
      lastQuickModuleId: lastQuickId,
      modules,
      quickModuleIds: quickIds,
    };
  }

  return {
    snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setup,
    async setLocale(value) {
      locale = value;
      dirtySync.add('locale');
      await persistAndNotify();
    },
    async setTheme(value) {
      theme = value;
      dirtySync.add('theme');
      await persistAndNotify();
    },
    async setHistoryEnabled(value) {
      historyEnabled = value;
      historyService.setEnabled(value);
      dirtyLocal = true;
      await persistAndNotify();
    },
    async setTimezone(value) {
      timezone = value;
      dirtySync.add('defaultTimezone');
      await persistAndNotify();
    },
    async enableModule(id) {
      if (!catalog.modules.some((module) => module.id === id)) {
        return;
      }
      try {
        await migrateModuleStorage(id);
        await lifecycle.enable(id);
      } catch (error) {
        // Entrypoints consume this with `void`, so a rejection would surface
        // only as an unhandled rejection. Mirror setup(): log the code and
        // leave the module disabled instead of throwing into the void.
        console.error('MODULE_ACTIVATION_FAILED', id, error instanceof Error ? error.name : 'unknown');
        return;
      }
      enabledIds.add(id);
      dirtySync.add('enabledModuleIds');
      await persistAndNotify();
    },
    async disableModule(id, deleteData) {
      enabledIds.delete(id);
      quickIds = quickIds.filter((item) => item !== id);
      if (lastQuickId === id) {
        lastQuickId = quickIds[0] ?? null;
      }
      // Mark the three keys this method mutates as dirty, exactly as
      // enableModule does: persist() only writes the keys in dirtySync, so
      // omitting them silently dropped the disable (the in-memory state
      // changed while storage kept advertising the module as enabled).
      dirtySync.add('enabledModuleIds');
      dirtySync.add('quickModuleIds');
      dirtySync.add('lastQuickModuleId');
      try {
        await lifecycle.disable(id);
      } catch (error) {
        // A throwing disposer must not skip data deletion or persistence.
        // The failure is reported through the console channel only: the
        // entrypoints call this method with `void`, so rethrowing after the
        // state change would produce an unhandled rejection that no UI
        // surface can act on (spec §15 logs error codes, not user prose).
        console.error('MODULE_DISPOSER_FAILED', id, error instanceof Error ? error.name : 'unknown');
      }
      try {
        await capabilities.revoke(id);
      } catch (error) {
        // A failed browser removal is still reported without exposing the
        // permission target or request details to logs.
        console.error('MODULE_PERMISSION_REVOKE_FAILED', error instanceof Error ? error.name : 'unknown');
      }
      if (deleteData) {
        const moduleStorage = createModuleStorage(id, localArea, guard);
        await moduleStorage.clear().catch(() => undefined);
        // Send policies are module data too (spec §13.2/§9.4): "disable and
        // delete data" revokes every recorded always-allow grant.
        await sendPolicies.clearPolicies(id).catch(() => undefined);
        // "Disable and delete data" covers the module's history too (spec
        // §8.3); incognito blocks the delete and is swallowed like above.
        await historyService.clear(id).catch(() => undefined);
      }
      await persistAndNotify();
    },
    async addQuick(id) {
      if (!enabledIds.has(id) || !supportsPopup(id)) {
        return;
      }
      if (!quickIds.includes(id)) {
        quickIds.push(id);
      }
      dirtySync.add('quickModuleIds');
      await persistAndNotify();
    },
    async removeQuick(id) {
      quickIds = quickIds.filter((item) => item !== id);
      if (lastQuickId === id) {
        lastQuickId = quickIds[0] ?? null;
        dirtySync.add('lastQuickModuleId');
      }
      dirtySync.add('quickModuleIds');
      await persistAndNotify();
    },
    async reorderQuick(id, toIndex) {
      const from = quickIds.indexOf(id);
      if (from < 0 || toIndex < 0 || toIndex >= quickIds.length || toIndex === from) {
        return;
      }
      const next = [...quickIds];
      const [moved] = next.splice(from, 1);
      if (moved) {
        next.splice(toIndex, 0, moved);
      }
      quickIds = next;
      dirtySync.add('quickModuleIds');
      await persistAndNotify();
    },
    async moveQuick(id, direction) {
      const index = quickIds.indexOf(id);
      if (index < 0) {
        return;
      }
      const target = direction === 'left' ? index - 1 : index + 1;
      if (target < 0 || target >= quickIds.length) {
        return;
      }
      // A one-step nudge is a reorder to the adjacent index; keep the splice
      // and dirty-marking logic in one place.
      return this.reorderQuick(id, target);
    },
    async selectQuick(id) {
      if (!enabledIds.has(id) || !quickIds.includes(id)) {
        return;
      }
      lastQuickId = id;
      dirtySync.add('lastQuickModuleId');
      await persistAndNotify();
    },
    revokePermission(id) {
      // Revocation releases the module's held claims through the permission
      // service; modules without claims are a safe no-op.
      return capabilities.revoke(id);
    },
    async listSendPolicies(id) {
      return sendPolicies.listPolicies(id);
    },
    async clearSendPolicies(id) {
      await sendPolicies.clearPolicies(id);
    },
    async clearHistory(id) {
      // Incognito blocks history deletion (it is a persistent change) but the
      // UI fires this with `void`: swallowing the block keeps the action a
      // visible no-op instead of an unhandled rejection.
      await historyService.clear(id).catch(() => undefined);
    },
    listHistory(id) {
      return historyService.list(id);
    },
    flushSettings() {
      // Settings writes are debounced; a popup closing inside the window
      // would otherwise drop the last change (spec §9.1 keyboard-only flows
      // included). Errors are already swallowed by the repository chain.
      return repository.flush();
    },
  };
}
