import { createMessageRouter } from '../core/messaging/router';
import { attachRuntimeRouter } from '../core/messaging/runtime-transport';
import type { ConvToolsMessages } from '../core/messaging/messages';
import { readModuleIdList } from '../core/registry/module-ids';
import { listSelectionMenus, parseSelectionMenuId } from '../core/registry/selection-actions';
import { overlayLabelsFor, type OverlayPayload } from '../core/registry/overlay-payload';
import {
  collectPageProbe,
  createSelectionContextServices,
} from '../core/registry/selection-context';
import {
  createHandoffStore,
  HANDOFF_KEY_PREFIX,
} from '../core/handoff/session-handoff';
import { createSelectionHistoryRecorder } from '../core/history/selection-history';
import { chineseMessages, englishMessages, lookup, resolveLocale, type LocalePreference } from '../core/i18n/types';
import {
  isSelectionWorkbenchInputResult,
  type SelectionActionResult,
  type SelectionActionContext,
} from '../core/module-sdk/runtime';
import { createIncognitoStorageSession } from '../core/storage/module-storage';
import { BrowserStorageArea } from '../core/storage/browser-area';
import { PersistenceGuard } from '../core/storage/persistence-guard';
import {
  moduleDisplayNames,
  moduleManifests,
  moduleSelectionActionLabels,
} from '../generated/module-manifest';

/**
 * Selections ride through the service worker synchronously; an unclamped
 * multi-megabyte select-all would block the SW and flood storage.session
 * (spec §16 keeps long work out of the background). The overlay truncates at
 * 500 characters and the workbench at 2000, so this cap is invisible in
 * practice and only rejects pathological selections with a visible message.
 */
const MAX_SELECTION_TEXT_CHARS = 512 * 1024;

export default defineBackground(() => {
  // Capture the browser APIs once: late async continuations (menu rebuilds,
  // handoff sweeps) must not re-read the global after teardown semantics.
  const runtime = browser.runtime;
  const storage = browser.storage;
  const contextMenus = browser.contextMenus;
  const tabs = browser.tabs;
  const scripting = browser.scripting;

  const store = createHandoffStore({
    // The split-incognito background instance knows its own mode; keeping the
    // memory map for incognito honors the plan's no-session-storage rule.
    incognito: browser.extension.inIncognitoContext === true,
    memory: new Map(),
    session: {
      get: (key) => storage.session.get(key).then((items) => items[key]),
      set: (key, value) => storage.session.set({ [key]: value }),
      remove: (key) => storage.session.remove(key),
      list: () => storage.session.get().then((items) => {
        return Object.entries(items)
          .filter(([key]) => key.startsWith(HANDOFF_KEY_PREFIX))
          .map(([key, value]) => ({ key, value }));
      }),
    },
  });

  // Lazy TTL sweep: no extra permission needed, keeps abandoned fallback
  // payloads from accumulating for the whole browser session.
  void store.expire();

  // The typed message bus every extension context talks to (spec §6.2).
  const messageRouter = createMessageRouter<ConvToolsMessages>();

  // Selection actions run without a kernel; history honoring lives here and
  // re-reads the toggle per action so settings changes apply immediately.
  const selectionHistory = createSelectionHistoryRecorder({
    incognito: browser.extension.inIncognitoContext === true,
    local: new BrowserStorageArea(browser.storage.local),
  });

  // One session-wide storage area/guard/overlay bag for selection actions:
  // per-action instances would evaporate incognito settings writes between
  // actions instead of living for the session (spec E2/§12A.1).
  const selectionStorageArea = new BrowserStorageArea(storage.local);
  const selectionGuard = new PersistenceGuard(browser.extension.inIncognitoContext === true);
  const selectionIncognitoSession = createIncognitoStorageSession();

  // Expand clicks arrive from the overlay; a hostile page can synthesize
  // clicks into the open shadow root, so open rate is bounded per burst.
  const openWindowMs = 10_000;
  const openWindowMax = 5;
  let openTimestamps: number[] = [];

  function allowWorkbenchOpen(): boolean {
    const now = Date.now();
    openTimestamps = openTimestamps.filter((timestamp) => now - timestamp < openWindowMs);
    if (openTimestamps.length >= openWindowMax) {
      return false;
    }
    openTimestamps.push(now);
    return true;
  }

  // Menu rebuilds must be serialized: concurrent removeAll/create batches
  // interleave and hit "duplicate id" errors on contextMenus.create.
  let menuRefreshChain: Promise<void> = Promise.resolve();
  function scheduleRefreshMenus(): void {
    menuRefreshChain = menuRefreshChain.then(refreshMenus, refreshMenus).catch((error: unknown) => {
      console.error('MENU_REFRESH_FAILED', error instanceof Error ? error.name : 'unknown');
    });
  }

  runtime.onInstalled.addListener(() => {
    scheduleRefreshMenus();
  });
  runtime.onStartup.addListener(() => {
    scheduleRefreshMenus();
  });
  // MV3 restarts the SW at any moment: menus persist across restarts, so a
  // rebuild that died mid-create would otherwise stay broken for the session
  // (and the split-incognito instance may never see onStartup).
  scheduleRefreshMenus();

  contextMenus.onClicked.addListener((info, tab) => {
    void (async () => {
      const parsed = parseSelectionMenuId(String(info.menuItemId));
      if (!parsed || !info.selectionText || !tab?.id) {
        return;
      }
      await runSelectionAction(tab, parsed.moduleId, parsed.actionId, info.selectionText);
    })();
  });

  /** Structural subset of the tabs API result the selection flow relies on. */
  interface SelectionTab {
    readonly id?: number;
    readonly url?: string;
    readonly title?: string;
  }

  async function runSelectionAction(
    tab: SelectionTab | undefined,
    moduleId: string,
    actionId: string,
    rawSelectionText: string,
  ): Promise<void> {
    if (typeof tab?.id !== 'number') {
      return;
    }
    if (!(await isSelectionActionEnabled(moduleId, actionId))) {
      return;
    }
    const locale = await readLocalePreference();
    const labels = overlayLabelsFor(locale);
    const displayActionLabel = actionLabelFor(moduleId, actionId, locale);
    const theme = await readThemePreference();
    const overlayTheme = theme === 'light' || theme === 'dark' ? theme : undefined;
    const tabId: number = tab.id;
    try {
      if (rawSelectionText.length > MAX_SELECTION_TEXT_CHARS) {
        throw new Error(lookup(resolveLocale(locale) === 'zh_CN' ? chineseMessages : englishMessages, 'errors.selectionTooLarge'));
      }
      const actionResult = await invokeAction(moduleId, actionId, rawSelectionText, tab);
      const { result } = actionResult;
      if (typeof result !== 'string') {
        if (isSelectionWorkbenchInputResult(result)) {
          // The module wants its editor: hand the input over once and let the
          // workbench render there. No overlay, no history yet — recording
          // happens when the user actually exports (spec §10).
          const token = await store.put({ moduleId, actionId, input: result.data });
          await openWorkbench(token);
          return;
        }
        // Image overlays ship with the approved SW appendix only.
        throw new Error('UNSUPPORTED_SELECTION_RESULT');
      }
      const token = await store.put({ moduleId, actionId, result });
      const payload: OverlayPayload = {
        result,
        actionLabel: displayActionLabel,
        moduleId,
        actionId,
        labels,
        ...(overlayTheme ? { theme: overlayTheme } : {}),
      };
      const injected = await injectOverlay(tabId, payload).catch((error: unknown) => {
        console.error('OVERLAY_INJECT_FAILED', error instanceof Error ? error.name : 'unknown');
        return null;
      });
      if (injected) {
        // The overlay shows the result; drop the fallback copy immediately.
        await store.consume(token).catch(() => undefined);
      } else {
        await openWorkbench(token);
      }
    } catch (error) {
      // Conversion failures must be visible (spec §15): show the failure in
      // the overlay instead of failing silently. Modules localize their own
      // messages, so surfacing the message reveals no user input.
      const payload: OverlayPayload = {
        result: error instanceof Error ? error.message : '',
        actionLabel: displayActionLabel,
        isError: true,
          labels,
        ...(overlayTheme ? { theme: overlayTheme } : {}),
      };
      const injected = await injectOverlay(tabId, payload).catch(() => undefined);
      if (!injected) {
        // Restricted page (menu exists, scripting refused): mirror the success
        // path's workbench fallback so the click still produces visible output.
        const token = await store
          .put({ moduleId, actionId, result: payload.result || labels.failed })
          .catch(() => null);
        if (token !== null) {
          await openWorkbench(token);
        }
      }
    }
  }

  // E2E-only overlay trigger: Playwright cannot drive native context menus,
  // so the test build (and only the test build) registers this handler; the
  // typed message keeps the payload contract checked at compile time.
  if (import.meta.env.MODE === 'test') {
    messageRouter.handle('CONVTOOLS_TEST_SHOW_OVERLAY', async (payload) => {
      const [tab] = await tabs.query({ active: true, currentWindow: true });
      await runSelectionAction(tab, payload.moduleId, payload.actionId, payload.selectionText);
      return { ok: true };
    });
  }

  async function readLocalePreference(): Promise<LocalePreference> {
    try {
      const stored = (await storage.sync.get(['locale'])) as { locale?: LocalePreference };
      return stored.locale ?? 'auto';
    } catch {
      return 'auto';
    }
  }

  async function readThemePreference(): Promise<'system' | 'light' | 'dark'> {
    try {
      const stored = (await storage.sync.get(['theme'])) as { theme?: unknown };
      return stored.theme === 'light' || stored.theme === 'dark' ? stored.theme : 'system';
    } catch {
      return 'system';
    }
  }

  async function readDefaultTimezone(): Promise<string | null> {
    try {
      const stored = (await storage.sync.get(['defaultTimezone'])) as { defaultTimezone?: unknown };
      return typeof stored.defaultTimezone === 'string' && stored.defaultTimezone.length > 0
        ? stored.defaultTimezone
        : null;
    } catch {
      return null;
    }
  }

  async function enabledModuleIds(): Promise<ReadonlySet<string>> {
    const knownIds = new Set(moduleManifests.map((module) => module.id as string));
    const defaults = moduleManifests
      .filter((module) => module.defaultEnabled)
      .map((module) => module.id as string);
    const settings = await storage.sync.get('enabledModuleIds').catch(() => ({}));
    const stored = (settings as { enabledModuleIds?: unknown }).enabledModuleIds;
    // Shared contract with the settings repository: a damaged list falls back
    // to the manifest defaults instead of silently emptying the menus.
    return new Set(readModuleIdList(stored, knownIds, defaults));
  }

  async function isSelectionActionEnabled(moduleId: string, actionId: string): Promise<boolean> {
    const module = moduleManifests.find((item) => item.id === moduleId);
    return Boolean(module?.surfaces.selectionActions.some((id) => id === actionId) && (await enabledModuleIds()).has(moduleId));
  }

  function actionLabelFor(moduleId: string, actionId: string, preference: LocalePreference): string {
    const resolved = resolveLocale(preference);
    const actionLabels = moduleSelectionActionLabels as Readonly<
      Record<string, Readonly<Record<string, Readonly<Record<'en' | 'zh_CN', string>>>>>
    >;
    return actionLabels[moduleId]?.[actionId]?.[resolved] ?? actionId;
  }

  async function openWorkbench(token: string): Promise<boolean> {
    try {
      await tabs.create({
        url: `${runtime.getURL('workbench.html')}#handoff=${encodeURIComponent(token)}`,
      });
      return true;
    } catch (error) {
      // Remove the one-time payload on an open failure; retaining user input
      // in session storage until TTL would be both misleading and unnecessary.
      await store.consume(token).catch(() => undefined);
      console.error('WORKBENCH_OPEN_FAILED', error instanceof Error ? error.name : 'unknown');
      return false;
    }
  }

  async function refreshMenus(): Promise<void> {
    await contextMenus.removeAll();
    const enabled = await enabledModuleIds();
    const locale = await readLocalePreference();
    const resolved = resolveLocale(locale);
    const titleFor = (moduleId: string, actionId: string): string => {
      const displayName = moduleDisplayNames[moduleId as keyof typeof moduleDisplayNames];
      const moduleLabels = moduleSelectionActionLabels[moduleId as keyof typeof moduleSelectionActionLabels];
      const actionLabel = moduleLabels?.[actionId as keyof typeof moduleLabels];
      const name = displayName ? displayName[resolved] : moduleId;
      const action = actionLabel ? actionLabel[resolved] : actionId;
      return `${name} · ${action}`;
    };
    for (const menu of listSelectionMenus(moduleManifests, enabled, titleFor)) {
      await contextMenus.create({
        id: menu.id,
        title: menu.title,
        contexts: ['selection'],
      });
    }
  }

  storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync') {
      return;
    }
    if ('enabledModuleIds' in changes || 'locale' in changes) {
      scheduleRefreshMenus();
    }
  });

  // Messages from extension contexts only (no externally_connectable): the
  // workbench consumes restricted-page fallback payloads (consume-delete), and
  // the overlay's Expand asks for a fresh handoff tab because MV3 blocks
  // window.open of chrome-extension:// pages from content contexts. Both ride
  // the typed message bus (spec §6.2): payloads are validated by the handler
  // instead of hand-sniffed field by field, and responses keep the
  // correlation id.
  messageRouter.handle('CONVTOOLS_HANDOFF_CONSUME', async (payload) => {
    if (typeof payload.token !== 'string') {
      return { payload: null };
    }
    return { payload: await store.consume(payload.token) };
  });
  messageRouter.handle('CONVTOOLS_HANDOFF_OPEN', async (payload) => {
    if (
      typeof payload.moduleId !== 'string' ||
      typeof payload.actionId !== 'string' ||
      typeof payload.result !== 'string'
    ) {
      return { ok: false };
    }
    const { moduleId, actionId, result } = payload;
    if (!allowWorkbenchOpen()) {
      // The overlay sits in an open shadow root on a hostile page: bound
      // the expand action so synthetic click floods cannot open endless
      // workbench tabs.
      return { ok: false };
    }
    if (!(await isSelectionActionEnabled(moduleId, actionId))) {
      return { ok: false };
    }
    try {
      const token = await store.put({ moduleId, actionId, result });
      return { ok: await openWorkbench(token) };
    } catch {
      return { ok: false };
    }
  });

  // Dispatch protocol envelopes through the router; foreign messages stay
  // untouched so other listeners keep their chance to answer them.
  attachRuntimeRouter(runtime, (request) => messageRouter.dispatch(request));

  async function invokeAction(
    moduleId: string,
    actionId: string,
    selectedText: string,
    tab: SelectionTab | undefined,
  ): Promise<{ result: SelectionActionResult; actionLabel: string }> {
    const loader = (await import('../generated/module-registry')).moduleLoaders as Record<
      string,
      () => Promise<{
        default: {
          surfaces: {
            selectionActions: readonly {
              id: string;
              label: string;
              run: (text: string, context: SelectionActionContext) => SelectionActionResult | Promise<SelectionActionResult>;
            }[];
          };
        };
      }>
    >;
    const factory = loader[moduleId];
    if (!factory) {
      throw new Error(`module ${moduleId} not found`);
    }
    const module = await factory();
    const action = module.default.surfaces.selectionActions.find((item) => item.id === actionId);
    if (!action) {
      throw new Error(`action ${actionId} not found in ${moduleId}`);
    }
    const services = createSelectionContextServices(moduleId, {
      tabUrl: typeof tab?.url === 'string' ? tab.url : null,
      tabTitle: typeof tab?.title === 'string' ? tab.title : null,
      probePage: () => probeTabPage(tab?.id),
      storageArea: selectionStorageArea,
      guard: selectionGuard,
      incognitoSession: selectionIncognitoSession,
      locale: await readLocalePreference(),
      defaultTimezone: await readDefaultTimezone(),
    });
    const context: SelectionActionContext = {
      history: selectionHistory.forModule(moduleId),
      storage: services.storage,
      i18n: services.i18n,
      defaultTimezone: services.defaultTimezone,
      signal: services.signal,
      page: services.page,
    };
    try {
      return { result: await action.run(selectedText, context), actionLabel: action.label };
    } finally {
      services.dispose();
    }
  }

  /** One best-effort metadata probe; empty when the page cannot be scripted. */
  async function probeTabPage(tabId: number | undefined): Promise<{ url: string | null; title: string | null; description: string | null; siteName: string | null }> {
    if (typeof tabId !== 'number') {
      throw new Error('NO_TAB');
    }
    const results = (await scripting.executeScript({
      target: { tabId },
      func: collectPageProbe,
      args: [],
    })) as Array<{ result?: { url: string | null; title: string | null; description: string | null; siteName: string | null } } | undefined>;
    const first = results?.[0];
    if (!first || typeof first !== 'object' || !first.result) {
      throw new Error('PAGE_PROBE_EMPTY');
    }
    return first.result;
  }

  async function injectOverlay(tabId: number, payload: OverlayPayload): Promise<boolean> {
    await scripting.executeScript({
      target: { tabId },
      func: (nextPayload: OverlayPayload): void => {
        const page = globalThis as typeof globalThis & { __CONVTOOLS_OVERLAY__?: OverlayPayload };
        page.__CONVTOOLS_OVERLAY__ = nextPayload;
      },
      args: [payload],
    });
    await scripting.executeScript({
      target: { tabId },
      files: ['selection-overlay.js'],
    });
    return true;
  }
});
