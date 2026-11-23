import type { LocalePreference } from '../i18n/types';
import { createModuleI18n } from '../i18n/module-i18n';
import type { ModuleI18n, NamespacedStorage } from '../module-sdk/context';
import type { SelectionPageMeta } from '../module-sdk/runtime';
import { createModuleStorage, type IncognitoStorageSession } from '../storage/module-storage';
import type { StorageArea } from '../storage/browser-storage';
import type { PersistenceGuard } from '../storage/persistence-guard';

/** What the injected page probe reports; absent fields stay null. */
export interface PageProbe {
  readonly url: string | null;
  readonly title: string | null;
  readonly description: string | null;
  readonly siteName: string | null;
}

/**
 * Self-contained probe serialized into the page via `scripting.executeScript`.
 * It must not close over imports: og fields win over their fallbacks, and an
 * empty page yields nulls instead of empty strings.
 */
export function collectPageProbe(): PageProbe {
  const readMeta = (selector: string): string | null => {
    const element = document.head?.querySelector(selector);
    const value = element?.getAttribute('content');
    return typeof value === 'string' && value.trim() !== '' ? value : null;
  };
  const og = (property: string): string | null => readMeta(`meta[property="${property}"]`);
  const named = (name: string): string | null => readMeta(`meta[name="${name}"]`);
  const href = typeof location !== 'undefined' && typeof location.href === 'string' && location.href !== ''
    ? location.href
    : null;
  const docTitle = typeof document.title === 'string' && document.title.trim() !== '' ? document.title : null;
  return {
    url: href,
    title: og('og:title') ?? docTitle,
    description: og('og:description') ?? named('description'),
    siteName: og('og:site_name'),
  };
}

export interface SelectionContextServices {
  readonly storage: NamespacedStorage;
  readonly i18n: ModuleI18n;
  readonly defaultTimezone: string | null;
  /** Aborts when the whole selection action outlives its budget. */
  readonly signal: AbortSignal;
  /** Lazily collects page metadata once per call; null when nothing is known. */
  readonly page: () => Promise<SelectionPageMeta | null>;
  /** Clears the signal timer; the background calls it after the action settles. */
  readonly dispose: () => void;
}

export interface SelectionContextDeps {
  readonly tabUrl: string | null;
  readonly tabTitle: string | null;
  /** Runs the serialized page probe; rejects when injection is impossible. */
  readonly probePage: () => Promise<PageProbe>;
  readonly storageArea: StorageArea;
  readonly guard: PersistenceGuard;
  /**
   * Shared incognito overlay bag: passing the background instance's session
   * keeps module settings writes visible across selection actions (spec E2)
   * instead of evaporating after each action.
   */
  readonly incognitoSession?: IncognitoStorageSession;
  readonly locale: LocalePreference;
  readonly defaultTimezone?: string | null;
  readonly probeTimeoutMs?: number;
  readonly signalTimeoutMs?: number;
}

function firstString(...values: readonly (string | null | undefined)[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') {
      return value;
    }
  }
  return null;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('PAGE_PROBE_TIMEOUT')), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * Builds the non-history half of a selection action's context: namespaced
 * storage (kernel-compatible keys), module-localized i18n, an action-scoped
 * abort signal, and lazy page metadata. Mirrors the kernel's context assembly
 * without a kernel instance (the background has none).
 */
export function createSelectionContextServices(moduleId: string, deps: SelectionContextDeps): SelectionContextServices {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.signalTimeoutMs ?? 10_000);

  return {
    storage: createModuleStorage(moduleId, deps.storageArea, deps.guard, deps.incognitoSession),
    // The locale of one selection action never changes mid-flight, so the
    // getter simply reads the captured preference.
    i18n: createModuleI18n(moduleId, () => deps.locale),
    defaultTimezone: deps.defaultTimezone ?? null,
    signal: controller.signal,
    async page() {
      let probe: PageProbe = { url: null, title: null, description: null, siteName: null };
      try {
        const reported = await withTimeout(deps.probePage(), deps.probeTimeoutMs ?? 2000);
        if (reported) {
          probe = reported;
        }
      } catch {
        // Injection failure or timeout: degrade to whatever the tab API knew.
      }
      const url = firstString(probe.url, deps.tabUrl);
      const title = firstString(probe.title, deps.tabTitle);
      const description = firstString(probe.description);
      const siteName = firstString(probe.siteName);
      if (url === null && title === null && description === null && siteName === null) {
        return null;
      }
      return { url, title, description, siteName };
    },
    dispose() {
      clearTimeout(timer);
    },
  };
}
