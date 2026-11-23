import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { consumeHandoff } from '../../../entrypoints/workbench/handoff-consume';

/** Answers a request envelope with a matching success envelope. */
function respond(payload: unknown): (message: unknown) => Promise<unknown> {
  return (message) => {
    const { id, type } = message as { id: string; type: string };
    return Promise.resolve({ kind: 'response', type, id, ok: true, payload });
  };
}

function stubRuntime(sendMessage: (message: unknown) => Promise<unknown>): void {
  vi.stubGlobal('browser', { runtime: { sendMessage: vi.fn(sendMessage) } });
}

beforeEach(() => {
  window.history.replaceState(null, '', '/workbench.html#handoff=tok-1');
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/workbench.html');
});

describe('handoff consume URL hygiene (L)', () => {
  it('strips the token on success', async () => {
    stubRuntime(respond({ payload: { moduleId: 'base64', result: 'ok' } }));
    await expect(consumeHandoff('tok-1')).resolves.toMatchObject({ moduleId: 'base64', result: 'ok' });
    expect(window.location.hash).toBe('');
  });

  it('strips an expired token too', async () => {
    stubRuntime(respond({ payload: null }));
    await expect(consumeHandoff('tok-1')).resolves.toBeNull();
    // Leaving #handoff=<token> behind keeps a dead token in history and makes
    // a refresh look like it is re-requesting the payload.
    expect(window.location.hash).toBe('');
  });

  it('strips the token when the runtime call fails', async () => {
    stubRuntime(() => Promise.reject(new Error('service worker gone')));
    await expect(consumeHandoff('tok-1')).rejects.toThrow('service worker gone');
    // A still-live token must not survive a failed consume where a refresh
    // could replay it.
    expect(window.location.hash).toBe('');
  });

  it('keeps an unrelated module hash intact', async () => {
    window.history.replaceState(null, '', '/workbench.html#base64');
    stubRuntime(respond({ payload: null }));
    await expect(consumeHandoff('tok-1')).resolves.toBeNull();
    expect(window.location.hash).toBe('#base64');
  });
});
