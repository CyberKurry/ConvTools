import { describe, expect, it, vi } from 'vitest';
import { createNetworkBroker, NETWORK_CANCELLED } from '../../../core/network/network-broker';
import { createSendPolicyStore } from '../../../core/network/send-policy';
import { MemoryArea } from '../../../core/storage/browser-storage';
import { PersistenceGuard } from '../../../core/storage/persistence-guard';

const intent = {
  moduleId: 'probe-tool',
  origin: 'https://api.example.com',
  dataCategory: 'lookup',
  byteCount: 12,
  method: 'POST',
  timeoutMs: 1_000,
  redactedPreview: 'id=***',
  permission: 'https://api.example.com/*',
};

function makeBroker(overrides: Partial<Parameters<typeof createNetworkBroker>[0]> = {}) {
  const fetchImpl = vi.fn(() => Promise.resolve(new Response('ok', { status: 200 })));
  const confirm = vi.fn(() => Promise.resolve('once' as const));
  const area = new MemoryArea();
  const broker = createNetworkBroker({
    fetchImpl,
    confirm,
    policies: createSendPolicyStore(area, new PersistenceGuard(false)),
    declaredOrigins: { 'probe-tool': ['https://api.example.com/*'] },
    hasPermission: () => Promise.resolve(true),
    ...overrides,
  });
  return { broker, fetchImpl, confirm, area };
}

describe('network broker', () => {
  it('confirms per request by default and can always-allow a module+origin+category', async () => {
    const confirm = vi.fn(() => Promise.resolve('always' as const));
    const { broker, fetchImpl } = makeBroker({ confirm });
    await broker.request(intent);
    await broker.request(intent);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not fetch after denial', async () => {
    const { broker, fetchImpl } = makeBroker({ confirm: () => Promise.resolve('deny') });
    await expect(broker.request(intent)).rejects.toMatchObject({ code: 'NETWORK_DENIED' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('enforces exact origin declarations and redacts errors', async () => {
    const { broker } = makeBroker({
      fetchImpl: () => Promise.reject(new Error('secret failure')),
    });
    await expect(
      broker.request({ ...intent, origin: 'https://other.example.com' }),
    ).rejects.toMatchObject({ code: 'UNDECLARED_ORIGIN' });
    await expect(broker.request(intent)).rejects.toMatchObject({ code: 'NETWORK_FAILED' });
  });

  it('parses origins instead of trusting string prefixes', async () => {
    const { broker } = makeBroker();
    // Path/userinfo/query tricks must not satisfy the declaration.
    await expect(
      broker.request({ ...intent, origin: 'https://api.example.com/evil?x=1' }),
    ).rejects.toMatchObject({ code: 'UNDECLARED_ORIGIN' });
    await expect(
      broker.request({ ...intent, origin: 'https://user@api.example.com/' }),
    ).rejects.toMatchObject({ code: 'UNDECLARED_ORIGIN' });
    // A trailing slash on the origin itself is still the same origin.
    await expect(broker.request({ ...intent, origin: 'https://api.example.com/' })).resolves.toMatchObject({
      ok: true,
    });
  });

  it('degrades always-allow to once-only in incognito and still fetches', async () => {
    const area = new MemoryArea();
    const { broker, fetchImpl } = makeBroker({
      confirm: () => Promise.resolve('always'),
      policies: createSendPolicyStore(area, new PersistenceGuard(true)),
    });
    await expect(broker.request(intent)).resolves.toMatchObject({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(area.snapshot()).toEqual({});
  });

  it('maps an external cancel signal to NETWORK_CANCELLED', async () => {
    const fetchImpl = vi.fn(
      (_input: unknown, init?: { signal?: AbortSignal }) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    const { broker } = makeBroker({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const controller = new AbortController();
    const pending = broker.request(intent, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: NETWORK_CANCELLED });
  });

  it('cancels a pending response reader when the request signal aborts', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const fetchImpl = vi.fn(() => Promise.resolve(new Response(stream, { status: 200 })));
    const { broker } = makeBroker({ fetchImpl });
    const controller = new AbortController();
    const pending = broker.request(intent, { signal: controller.signal });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: NETWORK_CANCELLED });
    expect(cancelled).toBe(true);
  });

  it('rejects immediately when the declared content length exceeds the cap', async () => {
    const { broker } = makeBroker({
      fetchImpl: () => Promise.resolve(new Response('x', { status: 200, headers: { 'content-length': '1048577' } })),
      maxResponseBytes: 1024 * 1024,
    });
    await expect(broker.request(intent)).rejects.toMatchObject({ code: 'NETWORK_FAILED' });
  });

  it('aborts mid-stream when the body exceeds the cap', async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(2048));
      },
    });
    const { broker } = makeBroker({
      fetchImpl: () => Promise.resolve(new Response(stream, { status: 200 })),
      maxResponseBytes: 1024,
    });
    await expect(broker.request(intent)).rejects.toMatchObject({ code: 'NETWORK_FAILED' });
  });

  it('sends the intent body when one is attached', async () => {
    const fetchImpl = vi.fn((_input: unknown, _init?: { body?: string }) => Promise.resolve(new Response('ok')));
    const { broker } = makeBroker({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await broker.request({ ...intent, byteCount: 7, body: 'payload' });
    const init = fetchImpl.mock.calls[0]?.[1] as { body?: string } | undefined;
    expect(init?.body).toBe('payload');
  });

  it('times out with a structured error', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn(
        (_input: unknown, init?: { signal?: AbortSignal }) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
          }),
      );
      const { broker } = makeBroker({
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      const pending = broker.request({ ...intent, timeoutMs: 10 });
      const assertion = expect(pending).rejects.toMatchObject({ code: 'NETWORK_TIMEOUT' });
      await vi.advanceTimersByTimeAsync(20);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('network broker intent hardening (ultrareview batch 7)', () => {
  it('rejects a body whose byte length contradicts the declared byteCount', async () => {
    const { broker, fetchImpl } = makeBroker();
    await expect(
      broker.request({ ...intent, byteCount: 3, body: 'payload' }),
    ).rejects.toMatchObject({ code: 'NETWORK_INVALID_INTENT' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('accepts a body whose byte length matches the declaration', async () => {
    const { broker, fetchImpl } = makeBroker();
    await expect(
      broker.request({ ...intent, byteCount: 7, body: 'payload' }),
    ).resolves.toMatchObject({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('clamps non-positive timeouts instead of aborting instantly', async () => {
    const { broker } = makeBroker();
    await expect(broker.request({ ...intent, timeoutMs: 0 })).resolves.toMatchObject({ ok: true });
    await expect(broker.request({ ...intent, timeoutMs: Number.NaN })).resolves.toMatchObject({ ok: true });
  });

  it('caps runaway timeouts at sixty seconds', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn(
        (_input: unknown, init?: { signal?: AbortSignal }) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          }),
      );
      const { broker } = makeBroker({ fetchImpl: fetchImpl as unknown as typeof fetch });
      const pending = broker.request({ ...intent, timeoutMs: Number.MAX_SAFE_INTEGER });
      const assertion = expect(pending).rejects.toMatchObject({ code: 'NETWORK_TIMEOUT' });
      await vi.advanceTimersByTimeAsync(60_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects bodyless 200 responses instead of reading unbounded text', async () => {
    const { broker } = makeBroker({
      fetchImpl: () => Promise.resolve(new Response(null, { status: 200 })),
    });
    await expect(broker.request(intent)).rejects.toMatchObject({ code: 'NETWORK_FAILED' });
  });

  it('accepts bodyless 204 responses with an empty body', async () => {
    const { broker } = makeBroker({
      fetchImpl: () => Promise.resolve(new Response(null, { status: 204 })),
    });
    await expect(broker.request(intent)).resolves.toMatchObject({ ok: true, body: '' });
  });

  it('requires the approved permission pattern to authorize the requested origin', async () => {
    const { broker, fetchImpl } = makeBroker({
      declaredOrigins: {
        'probe-tool': ['https://api.example.com/*', 'https://other.example.com/*'],
      },
    });
    await expect(
      broker.request({
        ...intent,
        permission: 'https://other.example.com/*',
      }),
    ).rejects.toMatchObject({ code: 'UNDECLARED_ORIGIN' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('send policy key encoding (ultrareview batch 7)', () => {
  it('keeps categories containing the separator distinct', async () => {
    const area = new MemoryArea();
    const policies = createSendPolicyStore(area, new PersistenceGuard(false));
    await policies.allowAlways('probe-tool', 'https://api.example.com', 'a|b');
    expect(await policies.isAlwaysAllowed('probe-tool', 'https://api.example.com', 'a|b')).toBe(true);
    expect(await policies.isAlwaysAllowed('probe-tool', 'https://api.example.com', 'a')).toBe(false);
    expect(Object.keys(area.snapshot()).some((key) => key.includes('%7C'))).toBe(true);
  });
});
