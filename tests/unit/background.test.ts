import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MessageEnvelope } from '../../core/messaging/protocol';
import { createHistoryService } from '../../core/history/history-service';
import { HISTORY_DB_NAME } from '../../core/history/indexed-db';

type MenuListener = (info: ContextMenuInfo, tab?: TabStub) => void;

interface StubOptions {
  readonly syncData?: Record<string, unknown>;
  readonly sessionData?: Record<string, unknown>;
  readonly localData?: Record<string, unknown>;
}

function makeBrowserStub(options: StubOptions = {}) {
  const clickListeners: MenuListener[] = [];
  const installListeners: Array<() => void> = [];
  const storageListeners: Array<(changes: Record<string, unknown>, areaName: string) => void> = [];
  const messageListeners: Array<(message: unknown) => unknown> = [];
  const executeScript = vi.fn().mockResolvedValue(undefined);
  const createMenu = vi.fn().mockResolvedValue(undefined);
  const removeAll = vi.fn().mockResolvedValue(undefined);
  const createTab = vi.fn().mockResolvedValue(undefined);
  const sessionState: Record<string, unknown> = { ...(options.sessionData ?? {}) };
  const sessionRemove = vi.fn((keys?: string | string[]) => {
    for (const key of typeof keys === 'string' ? [keys] : keys ?? Object.keys(sessionState)) {
      delete sessionState[key];
    }
    return Promise.resolve();
  });
  const sessionSet = vi.fn((items: Record<string, unknown>) => {
    Object.assign(sessionState, items);
    return Promise.resolve();
  });
  const get = vi.fn((keys?: string | string[] | null) => {
    if (Array.isArray(keys) && (keys.includes('locale') || keys.includes('theme'))) {
      return Promise.resolve({
        ...(options.syncData?.locale ? { locale: options.syncData.locale } : {}),
        ...(options.syncData?.theme ? { theme: options.syncData.theme } : {}),
      });
    }
    if (keys === 'enabledModuleIds') {
      return Promise.resolve(
        'enabledModuleIds' in (options.syncData ?? {})
          ? { enabledModuleIds: options.syncData?.enabledModuleIds }
          : {},
      );
    }
    return Promise.resolve({ ...sessionState });
  });
  const browserStub = {
    runtime: {
      getURL: (path: string) => `chrome-extension://test/${path}`,
      onInstalled: { addListener: (listener: () => void) => installListeners.push(listener) },
      onStartup: { addListener: (listener: () => void) => installListeners.push(listener) },
      onMessage: { addListener: (listener: (message: unknown) => unknown) => messageListeners.push(listener) },
      sendMessage: vi.fn().mockResolvedValue({ payload: null }),
    },
    extension: { inIncognitoContext: false },
    storage: {
      sync: { get, set: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined) },
      session: {
        get,
        set: sessionSet,
        remove: sessionRemove,
        clear: vi.fn().mockResolvedValue(undefined),
      },
      local: {
        get: vi.fn((keys?: string | string[] | null) => {
          if (Array.isArray(keys) && keys.includes('historyEnabled')) {
            return Promise.resolve(
              'historyEnabled' in (options.localData ?? {})
                ? { historyEnabled: options.localData?.historyEnabled }
                : {},
            );
          }
          return Promise.resolve({ ...(options.localData ?? {}) });
        }),
        set: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
        clear: vi.fn().mockResolvedValue(undefined),
      },
      onChanged: { addListener: (listener: (changes: Record<string, unknown>, areaName: string) => void) => storageListeners.push(listener) },
    },
    contextMenus: {
      removeAll,
      create: createMenu,
      onClicked: { addListener: (listener: MenuListener) => clickListeners.push(listener) },
    },
    tabs: { create: createTab },
    scripting: { executeScript },
  };
  return { browserStub, clickListeners, installListeners, storageListeners, messageListeners, executeScript, createMenu, removeAll, createTab, sessionRemove, get };
}

/** Request envelope helper for the typed message bus. */
function handoffOpenRequest(id: string, payload: Record<string, unknown>): unknown {
  return { kind: 'request', type: 'CONVTOOLS_HANDOFF_OPEN', id, payload };
}

async function loadBackground(stub: ReturnType<typeof makeBrowserStub>['browserStub']): Promise<void> {
  vi.stubGlobal('browser', stub);
  vi.stubGlobal('defineBackground', (main: () => void) => main());
  await import('../../entrypoints/background');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  void indexedDB.deleteDatabase(HISTORY_DB_NAME);
});

describe('background selection actions', () => {
  it('passes the converted result to the injected selection overlay', async () => {
    const stub = makeBrowserStub();
    await loadBackground(stub.browserStub);
    const listener = stub.clickListeners[0];
    if (!listener) {
      throw new Error('background did not register a context menu listener');
    }

    listener({ menuItemId: 'convtools:base64:decode', selectionText: 'SGVsbG8=' }, { id: 42 });

    await vi.waitFor(() => expect(stub.executeScript).toHaveBeenCalled());
    const calls = stub.executeScript.mock.calls as Array<
      [{ target: { tabId: number }; args?: Array<Record<string, unknown>>; files?: string[] }]
    >;
    const payloadCall = calls.find((call) => call[0].args !== undefined)?.[0];
    const payload = payloadCall?.args?.[0] as
      | { result?: string; actionLabel?: string; labels?: { copy?: string } }
      | undefined;
    expect(payload?.result).toBe('Hello');
    expect(payload?.actionLabel).toBe('Decode');
    expect(typeof payload?.labels?.copy).toBe('string');
    expect(calls).toEqual(expect.arrayContaining([[{ target: { tabId: 42 }, files: ['selection-overlay.js'] }]]));
  });

  it('creates localized context menus for stored enabled modules', async () => {
    const stub = makeBrowserStub({ syncData: { enabledModuleIds: ['timestamp'] } });
    await loadBackground(stub.browserStub);
    stub.installListeners[0]?.();

    await vi.waitFor(() => expect(stub.createMenu).toHaveBeenCalled());
    expect(stub.createMenu).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'convtools:timestamp:convert', title: 'Timestamp · Convert' }),
    );
    expect(stub.createMenu).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'convtools:base64:encode' }));
  });

  it('treats an explicitly empty enabled list as no menus', async () => {
    const stub = makeBrowserStub({ syncData: { enabledModuleIds: [] } });
    await loadBackground(stub.browserStub);
    stub.installListeners[0]?.();

    await vi.waitFor(() => expect(stub.removeAll).toHaveBeenCalled());
    expect(stub.createMenu).not.toHaveBeenCalled();
  });

  it('falls back to defaults for a corrupted enabled list, matching the settings view (M11)', async () => {
    // A mixed-type array is "corrupt" for the settings repository (which
    // falls back to manifest defaults); filtering it per item here would show
    // no menus while the popup still lists the default modules as enabled.
    const stub = makeBrowserStub({ syncData: { enabledModuleIds: ['timestamp', 42] } });
    await loadBackground(stub.browserStub);
    stub.installListeners[0]?.();

    await vi.waitFor(() => expect(stub.createMenu).toHaveBeenCalled());
    expect(stub.createMenu).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'convtools:base64:encode' }),
    );
    expect(stub.createMenu).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'convtools:timestamp:convert' }),
    );
  });

  it('rejects an oversized selection before running the module (L)', async () => {
    const stub = makeBrowserStub();
    await loadBackground(stub.browserStub);
    const listener = stub.clickListeners[0];
    if (!listener) {
      throw new Error('background did not register a context menu listener');
    }
    listener({ menuItemId: 'convtools:base64:decode', selectionText: 'A'.repeat(1_000_001) }, { id: 42 });
    await vi.waitFor(() => expect(stub.executeScript).toHaveBeenCalled());
    const calls = stub.executeScript.mock.calls as Array<
      [{ args?: Array<Record<string, unknown>> }]
    >;
    const payload = calls.find((call) => call[0].args !== undefined)?.[0].args?.[0] as
      | { isError?: boolean; result?: string }
      | undefined;
    expect(payload?.isError).toBe(true);
    expect(payload?.result).toBe('The selection is too large to convert here. Select a smaller passage.');
  });

  it('does not execute a stale click after the module was disabled', async () => {
    const stub = makeBrowserStub({ syncData: { enabledModuleIds: [] } });
    await loadBackground(stub.browserStub);
    const listener = stub.clickListeners[0];
    if (!listener) {
      throw new Error('background did not register a context menu listener');
    }

    listener({ menuItemId: 'convtools:base64:decode', selectionText: 'SGVsbG8=' }, { id: 42 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(stub.executeScript).not.toHaveBeenCalled();
  });

  it('passes a manually selected dark theme to the injected overlay', async () => {
    const stub = makeBrowserStub({ syncData: { theme: 'dark' } });
    await loadBackground(stub.browserStub);
    const listener = stub.clickListeners[0];
    if (!listener) {
      throw new Error('background did not register a context menu listener');
    }

    listener({ menuItemId: 'convtools:base64:decode', selectionText: 'SGVsbG8=' }, { id: 42 });
    await vi.waitFor(() => expect(stub.executeScript).toHaveBeenCalled());
    const calls = stub.executeScript.mock.calls as Array<[{ args?: Array<Record<string, unknown>> }]>;
    const payload = calls.find((call) => call[0].args !== undefined)?.[0].args?.[0] as
      | { theme?: string }
      | undefined;
    expect(payload?.theme).toBe('dark');
  });

  it('falls back to manifest defaults when the enabled list was never stored', async () => {
    const stub = makeBrowserStub();
    await loadBackground(stub.browserStub);
    stub.installListeners[0]?.();

    await vi.waitFor(() => expect(stub.createMenu).toHaveBeenCalled());
    expect(stub.createMenu).toHaveBeenCalledWith(expect.objectContaining({ id: 'convtools:base64:encode' }));
    expect(stub.createMenu).toHaveBeenCalledWith(expect.objectContaining({ id: 'convtools:timestamp:convert' }));
  });

  it('surfaces a localized module failure instead of a raw i18n key', async () => {
    const stub = makeBrowserStub({ syncData: { locale: 'zh_CN' } });
    await loadBackground(stub.browserStub);
    const listener = stub.clickListeners[0];
    if (!listener) {
      throw new Error('background did not register a context menu listener');
    }

    listener({ menuItemId: 'convtools:base64:decode', selectionText: '!!!' }, { id: 42 });

    await vi.waitFor(() => expect(stub.executeScript).toHaveBeenCalled());
    const calls = stub.executeScript.mock.calls as Array<
      [{ target: { tabId: number }; args?: Array<Record<string, unknown>>; files?: string[] }]
    >;
    const payloadCall = calls.find((call) => call[0].args !== undefined)?.[0];
    const payload = payloadCall?.args?.[0] as { isError?: boolean; result?: string } | undefined;
    expect(payload?.isError).toBe(true);
    expect(payload?.result).toBe('Base64 输入中存在无效字符。');
  });

  it('rebuilds menus when the enabled list changes in sync storage', async () => {
    const syncState: Record<string, unknown> = { enabledModuleIds: ['timestamp'] };
    const stub = makeBrowserStub({ syncData: syncState });
    const order: string[] = [];
    stub.removeAll.mockImplementation(() => {
      order.push('removeAll');
      return Promise.resolve();
    });
    stub.createMenu.mockImplementation(() => {
      order.push('create');
      return Promise.resolve();
    });
    await loadBackground(stub.browserStub);
    stub.installListeners[0]?.();
    // The SW-start refresh plus the onInstalled refresh both run (serialized,
    // idempotent) so a mid-session SW restart can no longer leave the persisted
    // menu set broken.
    await vi.waitFor(() => expect(order).toEqual(['removeAll', 'create', 'removeAll', 'create']));

    const rebuild = stub.storageListeners[0];
    if (!rebuild) {
      throw new Error('background did not register a storage listener');
    }
    syncState.enabledModuleIds = [];
    rebuild({ enabledModuleIds: { newValue: [] } }, 'sync');
    await vi.waitFor(() => expect(order).toEqual(['removeAll', 'create', 'removeAll', 'create', 'removeAll']));
    expect(stub.createMenu).toHaveBeenCalledTimes(2);
  });

  it('serializes concurrent menu rebuilds so creates never race removeAll', async () => {
    const stub = makeBrowserStub({ syncData: { enabledModuleIds: ['base64'] } });
    const order: string[] = [];
    stub.removeAll.mockImplementation(async () => {
      order.push('removeAll');
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    stub.createMenu.mockImplementation(async () => {
      order.push('create');
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    await loadBackground(stub.browserStub);
    stub.installListeners[0]?.();
    const rebuild = stub.storageListeners[0];
    if (!rebuild) {
      throw new Error('background did not register a storage listener');
    }
    rebuild({ enabledModuleIds: { newValue: ['base64'] } }, 'sync');
    rebuild({ locale: { newValue: 'en' } }, 'sync');
    await vi.waitFor(() => expect(order.filter((item) => item === 'create').length).toBeGreaterThanOrEqual(6));
    // The invariant is serialization, not an exact schedule: startup, the
    // install listener, and the two storage events each queue one full
    // rebuild, and every rebuild is a clean removeAll -> create cycle with no
    // interleaving (how many batches raced onto the chain depends on timing).
    for (let index = 0; index < order.length; index += 1) {
      if (order[index] === 'removeAll') {
        // A batch starts: everything after it up to the next removeAll must
        // be creates.
        let cursor = index + 1;
        while (cursor < order.length && order[cursor] !== 'removeAll') {
          expect(order[cursor]).toBe('create');
          cursor += 1;
        }
      } else {
        expect(order[index]).toBe('create');
      }
    }
    // At least the startup rebuild plus the two event rebuilds completed.
    expect(order.filter((item) => item === 'removeAll').length).toBeGreaterThanOrEqual(3);
  });

  it('writes a successful selection action into module history when enabled', async () => {
    const stub = makeBrowserStub({ localData: { historyEnabled: true } });
    await loadBackground(stub.browserStub);
    const listener = stub.clickListeners[0];
    if (!listener) {
      throw new Error('background did not register a context menu listener');
    }

    listener({ menuItemId: 'convtools:base64:decode', selectionText: 'SGVsbG8=' }, { id: 42 });

    const reader = createHistoryService({ enabled: true, incognito: false });
    await vi.waitFor(async () => {
      expect(await reader.list('base64')).toHaveLength(1);
    });
    const records = await reader.list('base64');
    expect(records[0]).toMatchObject({
      moduleId: 'base64',
      kind: 'text',
      action: 'decode',
      input: 'SGVsbG8=',
      output: 'Hello',
    });
    // The overlay was still injected as usual.
    await vi.waitFor(() => expect(stub.executeScript).toHaveBeenCalled());
  });

  it('writes no selection history when the local toggle is off', async () => {
    const stub = makeBrowserStub();
    await loadBackground(stub.browserStub);
    const listener = stub.clickListeners[0];
    if (!listener) {
      throw new Error('background did not register a context menu listener');
    }

    listener({ menuItemId: 'convtools:base64:encode', selectionText: 'hello' }, { id: 42 });

    await vi.waitFor(() => expect(stub.executeScript).toHaveBeenCalled());
    const reader = createHistoryService({ enabled: true, incognito: false });
    await expect(reader.list('base64')).resolves.toEqual([]);
  });

  it('opens the workbench fallback with the handoff token when injection fails', async () => {
    const stub = makeBrowserStub();
    stub.executeScript.mockRejectedValue(new Error('cannot inject into chrome://'));
    await loadBackground(stub.browserStub);
    const listener = stub.clickListeners[0];
    if (!listener) {
      throw new Error('background did not register a context menu listener');
    }

    listener({ menuItemId: 'convtools:base64:encode', selectionText: 'hello' }, { id: 7 });

    await vi.waitFor(() => expect(stub.createTab).toHaveBeenCalled());
    const fallbackUrl = stub.createTab.mock.calls[0]?.[0] as { url?: string } | undefined;
    expect(fallbackUrl?.url).toMatch(/^chrome-extension:\/\/test\/workbench\.html#handoff=[0-9a-f-]+$/);
  });
});

describe('background overlay expand (ultrareview batch 5)', () => {
  it('re-stores the payload and opens a workbench handoff tab on expand', async () => {
    const stub = makeBrowserStub();
    await loadBackground(stub.browserStub);
    // The test build registers a test-only listener first; the production
    // handoff listener is the last one registered.
    const listener = stub.messageListeners.at(-1);
    if (!listener) {
      throw new Error('background did not register an onMessage listener');
    }
    const response = (await listener(handoffOpenRequest('req-a', {
      moduleId: 'base64',
      actionId: 'decode',
      result: 'Hello',
    }))) as MessageEnvelope;
    expect(response).toMatchObject({ kind: 'response', ok: true, id: 'req-a', payload: { ok: true } });
    await vi.waitFor(() => expect(stub.createTab).toHaveBeenCalled());
    const tab = stub.createTab.mock.calls[0]?.[0] as { url?: string } | undefined;
    expect(tab?.url).toMatch(/^chrome-extension:\/\/test\/workbench\.html#handoff=[0-9a-f-]+$/);
  });

  it('rejects expand requests without a valid module and action id', async () => {
    const stub = makeBrowserStub();
    await loadBackground(stub.browserStub);
    const listener = stub.messageListeners.at(-1);
    if (!listener) {
      throw new Error('background did not register an onMessage listener');
    }
    const response = (await listener(handoffOpenRequest('req-b', { moduleId: 7 }))) as MessageEnvelope;
    // A malformed payload is an expected business outcome, not a transport
    // failure: the handler answers with ok:false inside a success envelope.
    expect(response).toMatchObject({ kind: 'response', ok: true, id: 'req-b', payload: { ok: false } });
    expect(stub.createTab).not.toHaveBeenCalled();
  });

  it('returns an error and removes the token when expand cannot open a tab', async () => {
    const stub = makeBrowserStub();
    stub.createTab.mockRejectedValue(new Error('tab creation failed'));
    await loadBackground(stub.browserStub);
    const listener = stub.messageListeners.at(-1);
    if (!listener) {
      throw new Error('background did not register an onMessage listener');
    }

    const response = (await listener(handoffOpenRequest('req-c', {
      moduleId: 'base64',
      actionId: 'decode',
      result: 'Hello',
    }))) as MessageEnvelope;
    expect(response).toMatchObject({ kind: 'response', ok: true, id: 'req-c', payload: { ok: false } });
    expect(stub.sessionRemove).toHaveBeenCalled();
  });
});
