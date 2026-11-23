import type { ModuleCatalog } from '../registry/catalog';
import { readModuleIdList } from '../registry/module-ids';
import { PersistenceBlockedError } from './persistence-guard';
import type { StorageArea, StorageValue } from './browser-storage';
import type { PersistenceGuard } from './persistence-guard';
import {
  DEFAULT_LOCAL_SETTINGS,
  DEFAULT_SYNC_SETTINGS,
  type LocalSettings,
  type LocalePreference,
  type SyncSettings,
  type ThemePreference,
} from './schema';

export interface SettingsSnapshot {
  readonly sync: SyncSettings;
  readonly local: LocalSettings;
}

export interface SettingsRepository {
  read(): Promise<SettingsSnapshot>;
  writeSync(patch: Partial<SyncSettings>): Promise<void>;
  writeLocal(patch: Partial<LocalSettings>): Promise<void>;
  /** Writes any debounced patch immediately (pagehide before the popup closes). */
  flush(): Promise<void>;
}

const SYNC_KEYS = [
  'locale',
  'theme',
  'enabledModuleIds',
  'quickModuleIds',
  'lastQuickModuleId',
  'defaultTimezone',
] as const;

const LOCAL_KEYS = ['historyEnabled', 'schemaVersion'] as const;

// A transient storage failure gets a small, bounded number of retries with a
// growing delay. Unbounded retries turned a storage.sync quota error into an
// endless write loop; after the cap the patch stays buffered until the next
// user action (or an explicit flush) starts a fresh budget.
const MAX_FLUSH_RETRIES = 3;

export function createSettingsRepository(options: {
  sync: StorageArea;
  local: StorageArea;
  catalog: ModuleCatalog;
  guard: PersistenceGuard;
  debounceMs?: number;
}): SettingsRepository {
  const debounceMs = options.debounceMs ?? 0;
  let syncBuffer: Partial<SyncSettings> = {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  let flushRetries = 0;
  // Writes are serialized so a patch arriving during an in-flight write is
  // applied by the next chained write, never racing the current one.
  let writeChain: Promise<void> = Promise.resolve();
  let waiters: Array<{ resolve: () => void; reject: (error: unknown) => void }> = [];

  async function read(): Promise<SettingsSnapshot> {
    const [rawSync, rawLocal] = await Promise.all([options.sync.get([...SYNC_KEYS]), options.local.get([...LOCAL_KEYS])]);
    const known = new Set(options.catalog.modules.map((module) => module.id));
    // Same normalization the background applies to the same keys, so the
    // popup and the context menus can never disagree about a stored list.
    const enabled = readModuleIdList(rawSync.enabledModuleIds, known, options.catalog.defaultEnabledIds);
    const quick = readModuleIdList(rawSync.quickModuleIds, known, options.catalog.defaultQuickIds);
    const rawLast = rawSync.lastQuickModuleId;
    return {
      sync: {
        locale: readLocale(rawSync.locale),
        theme: readTheme(rawSync.theme),
        enabledModuleIds: enabled,
        quickModuleIds: quick,
        lastQuickModuleId:
          typeof rawLast === 'string' && known.has(rawLast) ? rawLast : (quick[0] ?? null),
        defaultTimezone: readNullableString(rawSync.defaultTimezone, DEFAULT_SYNC_SETTINGS.defaultTimezone),
      },
      local: {
        historyEnabled: readBoolean(rawLocal.historyEnabled, DEFAULT_LOCAL_SETTINGS.historyEnabled),
        schemaVersion: readNumber(rawLocal.schemaVersion, DEFAULT_LOCAL_SETTINGS.schemaVersion),
      },
    };
  }

  function flushNow(): void {
    const currentWaiters = waiters;
    waiters = [];
    const items = syncBuffer;
    syncBuffer = {};
    if (Object.keys(items).length === 0) {
      flushRetries = 0;
      for (const waiter of currentWaiters) {
        waiter.resolve();
      }
      return;
    }
    // One serialized consumer owns the whole write: resolving or rejecting the
    // waiters, restoring the buffer on failure, and scheduling a bounded
    // retry. Nothing rejects outward, so no unhandled rejections can escape
    // the chain.
    writeChain = writeChain.then(async () => {
      try {
        await options.guard.write(options.sync, toStorage(items));
        flushRetries = 0;
        for (const waiter of currentWaiters) {
          waiter.resolve();
        }
      } catch (error) {
        // The buffer was already detached; put the failed patch back so the
        // settings are not silently lost, then schedule a bounded retry for
        // transient storage failures. Incognito blocks must not loop, and the
        // retry budget is capped so a permanent failure cannot spin forever.
        syncBuffer = { ...items, ...syncBuffer };
        for (const waiter of currentWaiters) {
          waiter.reject(error);
        }
        if (!(error instanceof PersistenceBlockedError) && timer === undefined && flushRetries < MAX_FLUSH_RETRIES) {
          flushRetries += 1;
          const delay = Math.max(debounceMs, 100) * 4 * 2 ** (flushRetries - 1);
          timer = setTimeout(
            () => {
              timer = undefined;
              flushNow();
            },
            delay,
          );
        }
      }
    });
  }

  async function writeSync(patch: Partial<SyncSettings>): Promise<void> {
    syncBuffer = { ...syncBuffer, ...patch };
    // A fresh user action re-arms the retry budget even if the previous
    // attempt exhausted it.
    flushRetries = 0;
    await new Promise<void>((resolve, reject) => {
      waiters.push({ resolve, reject });
      if (!timer) {
        timer = setTimeout(() => {
          timer = undefined;
          flushNow();
        }, debounceMs);
      }
    });
  }

  async function flush(): Promise<void> {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    flushNow();
    // The chain swallows storage errors internally; pagehide callers must
    // never see a rejection here (there is no UI left to report it).
    await writeChain;
  }
  async function writeLocal(patch: Partial<LocalSettings>): Promise<void> {
    await options.guard.write(options.local, toStorage(patch));
  }


  return { read, writeSync, writeLocal, flush };
}

function readLocale(value: StorageValue | undefined): LocalePreference {
  return value === 'en' || value === 'zh_CN' || value === 'auto' ? value : DEFAULT_SYNC_SETTINGS.locale;
}

function readTheme(value: StorageValue | undefined): ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system' ? value : DEFAULT_SYNC_SETTINGS.theme;
}

function readNullableString(value: StorageValue | undefined, fallback: string | null): string | null {
  if (value === null) {
    return null;
  }
  return typeof value === 'string' ? value : fallback;
}

function readBoolean(value: StorageValue | undefined, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readNumber(value: StorageValue | undefined, fallback: number): number {
  return typeof value === 'number' ? value : fallback;
}

/** Widens a settings patch into plain storage values (readonly arrays included). */
function toStorage(patch: object): Record<string, StorageValue> {
  return { ...(patch as Record<string, StorageValue>) };
}
