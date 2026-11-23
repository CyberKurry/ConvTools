import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MessageEnvelope } from '../../../core/messaging/protocol';

/**
 * Drives the typed messaging transport that adapts `runtime.onMessage` to the
 * protocol envelopes: requests from extension contexts are dispatched through
 * the router, foreign messages pass through untouched, and responses ride the
 * listener's returned promise.
 */
function harness() {
  const messageListeners: Array<(message: unknown) => unknown> = [];
  const browserStub = {
    runtime: {
      getURL: (path: string) => `chrome-extension://test/${path}`,
      onInstalled: { addListener: vi.fn() },
      onStartup: { addListener: vi.fn() },
      onMessage: { addListener: (listener: (message: unknown) => unknown) => messageListeners.push(listener) },
      sendMessage: vi.fn(),
    },
    extension: { inIncognitoContext: false },
    storage: {
      sync: { get: vi.fn().mockResolvedValue({}), set: vi.fn(), remove: vi.fn() },
      session: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
        clear: vi.fn(),
      },
      local: { get: vi.fn().mockResolvedValue({}), set: vi.fn(), remove: vi.fn(), clear: vi.fn() },
      onChanged: { addListener: vi.fn() },
    },
    contextMenus: {
      removeAll: vi.fn().mockResolvedValue(undefined),
      create: vi.fn().mockResolvedValue(undefined),
      onClicked: { addListener: vi.fn() },
    },
    tabs: { create: vi.fn().mockResolvedValue(undefined), query: vi.fn().mockResolvedValue([]) },
    scripting: { executeScript: vi.fn().mockResolvedValue(undefined) },
  };
  vi.stubGlobal('browser', browserStub);
  vi.stubGlobal('defineBackground', (main: () => void) => main());
  return {
    browserStub,
    send: async (message: unknown): Promise<unknown> => {
      const results = await Promise.all(
        messageListeners.filter((listener) => listener.length >= 0).map((listener) => listener(message)),
      );
      return results.find((value) => value !== undefined && value !== false);
    },
    createTab: browserStub.tabs.create as ReturnType<typeof vi.fn>,
    executeScript: browserStub.scripting.executeScript as ReturnType<typeof vi.fn>,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

function envelope(type: string, id: string, payload: unknown): MessageEnvelope {
  return { kind: 'request', type, id, payload };
}

describe('background typed messaging (messaging layer wiring)', () => {
  it('answers a typed handoff-consume request through the router', async () => {
    const h = harness();
    await import('../../../entrypoints/background');
    const response = (await h.send(envelope('CONVTOOLS_HANDOFF_CONSUME', 'req-1', { token: 'missing-token' }))) as {
      kind: string;
      id: string;
      ok: boolean;
      payload?: unknown;
    };
    expect(response.kind).toBe('response');
    expect(response.id).toBe('req-1');
    expect(response.ok).toBe(true);
    expect(response.payload).toEqual({ payload: null });
  });

  it('answers a malformed handoff-open payload as a business failure', async () => {
    const h = harness();
    await import('../../../entrypoints/background');
    // Handlers still validate their payloads at runtime: a bad payload is an
    // expected outcome ({ ok: false }), not a transport-level error, matching
    // the pre-messaging behaviour the workbench and overlay already handle.
    const response = (await h.send(envelope('CONVTOOLS_HANDOFF_OPEN', 'req-2', { moduleId: 7 }))) as {
      ok: boolean;
      id: string;
      payload?: { ok?: boolean };
    };
    expect(response.ok).toBe(true);
    expect(response.id).toBe('req-2');
    expect(response.payload?.ok).toBe(false);
    // No tab is opened for a rejected expand.
    expect(h.createTab).not.toHaveBeenCalled();
  });

  it('ignores messages that are not protocol envelopes', async () => {
    const h = harness();
    await import('../../../entrypoints/background');
    const result = await h.send({ type: 'SOME_FOREIGN_MESSAGE', token: 'x' });
    expect(result).toBeUndefined();
  });

  it('registers the test-build overlay trigger as a typed message', async () => {
    const h = harness();
    vi.stubEnv('MODE', 'test');
    await import('../../../entrypoints/background');
    const response = (await h.send(
      envelope('CONVTOOLS_TEST_SHOW_OVERLAY', 'req-3', { moduleId: 'base64', actionId: 'decode', selectionText: 'SGVsbG8=' }),
    )) as { ok: boolean };
    expect(response.ok).toBe(true);
  });
});
