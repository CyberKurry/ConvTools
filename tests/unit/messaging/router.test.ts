import { describe, expect, it } from 'vitest';
import { createMessageClient } from '../../../core/messaging/client';
import { createMessageRouter } from '../../../core/messaging/router';
import type { MessageEnvelope, MessageMap, Transport } from '../../../core/messaging/protocol';

interface TestMessages extends MessageMap {
  ping: { request: { n: number }; response: { n: number } };
  fail: { request: Record<string, never>; response: never };
}

function memoryTransport(): { a: Transport; b: Transport } {
  const listenersA = new Set<(message: MessageEnvelope) => void>();
  const listenersB = new Set<(message: MessageEnvelope) => void>();
  return {
    a: {
      send(message) {
        for (const listener of listenersB) listener(message);
      },
      subscribe(listener) {
        listenersA.add(listener);
        return () => {
          listenersA.delete(listener);
        };
      },
    },
    b: {
      send(message) {
        for (const listener of listenersA) listener(message);
      },
      subscribe(listener) {
        listenersB.add(listener);
        return () => {
          listenersB.delete(listener);
        };
      },
    },
  };
}

describe('typed messaging', () => {
  it('correlates request and response', async () => {
    const { a, b } = memoryTransport();
    const router = createMessageRouter<TestMessages>();
    router.handle('ping', (payload) => ({ n: payload.n + 1 }));
    router.attach(b);
    const client = createMessageClient<TestMessages>(a);
    await expect(client.request('ping', { n: 1 })).resolves.toEqual({ n: 2 });
  });

  it('rejects an unknown message type', async () => {
    const { a, b } = memoryTransport();
    const router = createMessageRouter<TestMessages>();
    router.attach(b);
    const client = createMessageClient<TestMessages>(a);
    await expect(client.request('ping', { n: 1 })).rejects.toMatchObject({ code: 'UNKNOWN_MESSAGE' });
  });

  it('serializes thrown handlers as structured errors', async () => {
    const { a, b } = memoryTransport();
    const router = createMessageRouter<TestMessages>();
    router.handle('fail', () => {
      throw new Error('secret stack should not leak as payload');
    });
    router.attach(b);
    const client = createMessageClient<TestMessages>(a);
    await expect(client.request('fail', {})).rejects.toMatchObject({
      code: 'HANDLER_FAILED',
      message: 'The requested operation failed.',
    });
  });

  it('times out unmatched requests', async () => {
    const { a } = memoryTransport();
    const client = createMessageClient<TestMessages>(a, { timeoutMs: 20 });
    await expect(client.request('ping', { n: 1 })).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('aborts an in-flight request', async () => {
    const { a } = memoryTransport();
    const client = createMessageClient<TestMessages>(a, { timeoutMs: 5_000 });
    const controller = new AbortController();
    const pending = client.request('ping', { n: 1 }, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' });
  });

  it('cleans up and rejects when the transport cannot send', async () => {
    const transport: Transport = {
      send() {
        throw new Error('transport down');
      },
      subscribe() {
        return () => undefined;
      },
    };
    const client = createMessageClient<TestMessages>(transport, { timeoutMs: 5_000 });
    await expect(client.request('ping', { n: 1 })).rejects.toMatchObject({
      code: 'SEND_FAILED',
      message: 'The request could not be sent.',
    });
  });

  it('rejects a stale response whose correlation id is unknown', async () => {
    const listeners = new Set<(message: MessageEnvelope) => void>();
    const transport: Transport = {
      send() {},
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    };
    const client = createMessageClient<TestMessages>(transport, { timeoutMs: 30 });
    const pending = client.request('ping', { n: 1 });
    for (const listener of listeners) {
      listener({
        kind: 'response',
        type: 'ping',
        id: 'not-the-id',
        ok: true,
        payload: { n: 99 },
      });
    }
    const timeout = client.request('fail', {}, { timeoutMs: 10 }).catch((error: unknown) => error);
    await expect(timeout).resolves.toMatchObject({ code: 'TIMEOUT' });
    await expect(pending).rejects.toMatchObject({ code: 'TIMEOUT' });
  });
});
