import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHistoryService } from '../../core/history/history-service';
import { HISTORY_DB_NAME } from '../../core/history/indexed-db';

type MenuListener = (info: { menuItemId: unknown; selectionText?: string }, tab?: { id?: number; url?: string; title?: string }) => void;

// A fake module whose selection action returns a workbench-input result; the
// real bundled modules gain this with share-card, but the core contract is
// module-agnostic and must be proven without one.
vi.mock('../../generated/module-registry', () => ({
  moduleLoaders: {
    'mock-card': () =>
      Promise.resolve({
        default: {
          surfaces: {
            selectionActions: [
              {
                id: 'make',
                label: 'make',
                run: (selectedText: string) => ({
                  kind: 'workbench-input',
                  data: { version: 1, excerpt: selectedText },
                }),
              },
            ],
          },
        },
      }),
  },
}));

vi.mock('../../generated/module-manifest', () => ({
  moduleManifests: [
    {
      id: 'mock-card',
      version: '1.0.0',
      coreApiRange: '^1.0.0',
      icon: 'icon.svg',
      defaultEnabled: true,
      defaultQuickOrder: 1,
      surfaces: { popup: false, workbench: true, settings: false, selectionActions: ['make'] },
      permissions: { optionalPermissions: [], optionalHostPermissions: [] },
    },
  ],
  moduleDisplayNames: { 'mock-card': { en: 'Mock Card', zh_CN: '模拟卡片' } },
  moduleSelectionActionLabels: { 'mock-card': { make: { en: 'Make', zh_CN: '生成' } } },
  moduleLocales: { 'mock-card': { en: {}, zh_CN: {} } },
}));

function makeBrowserStub() {
  const clickListeners: MenuListener[] = [];
  const installListeners: Array<() => void> = [];
  const sessionStore = new Map<string, unknown>();
  const executeScript = vi.fn().mockResolvedValue(undefined);
  const createTab = vi.fn().mockResolvedValue(undefined);
  const browserStub = {
    runtime: {
      getURL: (path: string) => `chrome-extension://test/${path}`,
      onInstalled: { addListener: (listener: () => void) => installListeners.push(listener) },
      onStartup: { addListener: (listener: () => void) => installListeners.push(listener) },
      onMessage: { addListener: () => undefined },
      sendMessage: vi.fn().mockResolvedValue({ payload: null }),
    },
    extension: { inIncognitoContext: false },
    storage: {
      sync: {
        get: vi.fn(() => Promise.resolve({})),
        set: vi.fn(() => Promise.resolve()),
        remove: vi.fn(() => Promise.resolve()),
      },
      session: {
        get: (keys?: string | string[] | null) => {
          if (typeof keys === 'string') {
            return Promise.resolve(sessionStore.has(keys) ? { [keys]: sessionStore.get(keys) } : {});
          }
          return Promise.resolve(Object.fromEntries(sessionStore));
        },
        set: (items: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(items)) {
            sessionStore.set(key, value);
          }
          return Promise.resolve();
        },
        remove: (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            sessionStore.delete(key);
          }
          return Promise.resolve();
        },
        clear: () => {
          sessionStore.clear();
          return Promise.resolve();
        },
      },
      local: {
        get: vi.fn((keys?: string | string[] | null) => {
          if (Array.isArray(keys) && keys.includes('historyEnabled')) {
            return Promise.resolve({});
          }
          return Promise.resolve({});
        }),
        set: vi.fn(() => Promise.resolve()),
        remove: vi.fn(() => Promise.resolve()),
        clear: vi.fn(() => Promise.resolve()),
      },
      onChanged: { addListener: () => undefined },
    },
    contextMenus: {
      removeAll: vi.fn(() => Promise.resolve()),
      create: vi.fn(() => Promise.resolve()),
      onClicked: { addListener: (listener: MenuListener) => clickListeners.push(listener) },
    },
    tabs: { create: createTab },
    scripting: { executeScript },
  };
  return { browserStub, clickListeners, sessionStore, executeScript, createTab };
}

describe('background workbench-input hand-off', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    void indexedDB.deleteDatabase(HISTORY_DB_NAME);
  });

  it('opens the workbench with the module input instead of injecting an overlay', async () => {
    const stub = makeBrowserStub();
    vi.stubGlobal('browser', stub.browserStub);
    vi.stubGlobal('defineBackground', (main: () => void) => main());
    await import('../../entrypoints/background');
    const listener = stub.clickListeners[0];
    if (!listener) {
      throw new Error('background did not register a context menu listener');
    }

    listener(
      { menuItemId: 'convtools:mock-card:make', selectionText: 'a quote' },
      { id: 9, url: 'https://example.com/article', title: 'Article' },
    );

    await vi.waitFor(() => expect(stub.createTab).toHaveBeenCalled());
    const tab = stub.createTab.mock.calls[0]?.[0] as { url?: string } | undefined;
    expect(tab?.url).toMatch(/^chrome-extension:\/\/test\/workbench\.html#handoff=[0-9a-f-]+$/);
    // No overlay injection at all: the workbench is the destination.
    expect(stub.executeScript).not.toHaveBeenCalled();

    const stored = [...stub.sessionStore.values()] as Array<{
      moduleId?: string;
      actionId?: string;
      input?: unknown;
      result?: string;
    }>;
    const payload = stored[0];
    expect(payload?.moduleId).toBe('mock-card');
    expect(payload?.actionId).toBe('make');
    expect(payload?.input).toEqual({ version: 1, excerpt: 'a quote' });
    expect(payload?.result).toBeUndefined();
  });

  it('writes no module history for an input hand-off', async () => {
    const stub = makeBrowserStub();
    vi.stubGlobal('browser', stub.browserStub);
    vi.stubGlobal('defineBackground', (main: () => void) => main());
    await import('../../entrypoints/background');
    const listener = stub.clickListeners[0];
    if (!listener) {
      throw new Error('background did not register a context menu listener');
    }

    listener({ menuItemId: 'convtools:mock-card:make', selectionText: 'a quote' }, { id: 9 });

    await vi.waitFor(() => expect(stub.createTab).toHaveBeenCalled());
    const reader = createHistoryService({ enabled: true, incognito: false });
    await expect(reader.list('mock-card')).resolves.toEqual([]);
  });
});
