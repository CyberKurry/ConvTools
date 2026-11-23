import { describe, expect, it } from 'vitest';
import { createHandoffStore, type HandoffPayload } from '../../core/handoff/session-handoff';

describe('session handoff', () => {
  it('writes a payload with a random token to storage.session in normal mode and consumes once', async () => {
    const session = new Map<string, HandoffPayload>();
    const store = createHandoffStore({
      incognito: false,
      memory: new Map(),
      session: {
        get: (key) => Promise.resolve(session.get(key)),
        set: (key, value) => {
          session.set(key, value);
          return Promise.resolve();
        },
        remove: (key) => {
          session.delete(key);
          return Promise.resolve();
        },
        list: () => Promise.resolve([...session.entries()].map(([key, value]) => ({ key, value }))),
      },
      randomToken: () => 'tok-123',
    });
    const token = await store.put({ moduleId: 'base64', actionId: 'encode', result: 'YQ==' });
    expect(token).toBe('tok-123');
    expect([...session.keys()]).toEqual(['convtools:handoff:tok-123']);
    const first = await store.consume(token);
    expect(first?.result).toBe('YQ==');
    expect(await store.consume(token)).toBeNull();
  });

  it('atomically claims a normal-mode token when consumers race', async () => {
    const session = new Map<string, HandoffPayload>();
    let releaseRead: (() => void) | undefined;
    const readReleased = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const store = createHandoffStore({
      incognito: false,
      memory: new Map(),
      session: {
        get: async (key) => {
          await readReleased;
          return session.get(key);
        },
        set: (key, value) => {
          session.set(key, value);
          return Promise.resolve();
        },
        remove: (key) => {
          session.delete(key);
          return Promise.resolve();
        },
        list: () => Promise.resolve([...session.entries()].map(([key, value]) => ({ key, value }))),
      },
      randomToken: () => 'race-token',
    });
    await store.put({ moduleId: 'share-card', actionId: 'generate', input: { version: 1 } });

    const first = store.consume('race-token');
    await Promise.resolve();
    const second = store.consume('race-token');
    releaseRead?.();

    const results = await Promise.all([first, second]);
    expect(results.filter((result) => result !== null)).toHaveLength(1);
  });

  it('keeps incognito payloads in memory only', async () => {
    const memory = new Map<string, HandoffPayload>();
    let sessionWrites = 0;
    const store = createHandoffStore({
      incognito: true,
      memory,
      session: {
        get: () => Promise.resolve(undefined),
        set: () => {
          sessionWrites += 1;
          return Promise.resolve();
        },
        remove: () => Promise.resolve(),
        list: () => Promise.resolve([]),
      },
      randomToken: () => 'incognito-token',
    });
    await store.put({ moduleId: 'base64', actionId: 'decode', result: 'hello' });
    expect(sessionWrites).toBe(0);
    expect(memory.size).toBe(1);
  });

  it('expires abandoned entries', async () => {
    const session = new Map<string, HandoffPayload>();
    const store = createHandoffStore({
      incognito: false,
      memory: new Map(),
      session: {
        get: (key) => Promise.resolve(session.get(key)),
        set: (key, value) => {
          session.set(key, value);
          return Promise.resolve();
        },
        remove: (key) => {
          session.delete(key);
          return Promise.resolve();
        },
        list: () => Promise.resolve([...session.entries()].map(([key, value]) => ({ key, value }))),
      },
      randomToken: () => 'old-token',
      now: () => 0,
    });
    await store.put({ moduleId: 'base64', actionId: 'encode', result: 'x' });
    await store.expire(6 * 60 * 1000);
    expect(session.size).toBe(0);
  });

  it('removes malformed prefixed session entries during expiry', async () => {
    const session = new Map<string, HandoffPayload>([
      ['convtools:handoff:bad', { token: 'bad', moduleId: '', actionId: '', createdAt: 0, result: '' }],
    ]);
    const store = createHandoffStore({
      incognito: false,
      memory: new Map(),
      session: {
        get: (key) => Promise.resolve(session.get(key)),
        set: (key, value) => {
          session.set(key, value);
          return Promise.resolve();
        },
        remove: (key) => {
          session.delete(key);
          return Promise.resolve();
        },
        list: () => Promise.resolve([...session.entries()].map(([key, value]) => ({ key, value }))),
      },
      now: () => 0,
    });
    await store.expire();
    expect(session.size).toBe(0);
  });

  it('stores and consumes a module-input payload exactly like a result payload', async () => {
    const session = new Map<string, HandoffPayload>();
    const store = createHandoffStore({
      incognito: false,
      memory: new Map(),
      session: {
        get: (key) => Promise.resolve(session.get(key)),
        set: (key, value) => {
          session.set(key, value);
          return Promise.resolve();
        },
        remove: (key) => {
          session.delete(key);
          return Promise.resolve();
        },
        list: () => Promise.resolve([...session.entries()].map(([key, value]) => ({ key, value }))),
      },
      randomToken: () => 'input-token',
    });
    const token = await store.put({
      moduleId: 'share-card',
      actionId: 'generate',
      input: { version: 1, excerpt: 'quoted text' },
    });
    const payload = await store.consume(token);
    expect(payload?.moduleId).toBe('share-card');
    expect(payload?.input).toEqual({ version: 1, excerpt: 'quoted text' });
    expect(await store.consume(token)).toBeNull();
  });

  it('rejects payloads that carry neither, both, or empty result and input', async () => {
    const session = new Map<string, HandoffPayload>();
    const store = createHandoffStore({
      incognito: false,
      memory: new Map(),
      session: {
        get: (key) => Promise.resolve(session.get(key)),
        set: (key, value) => {
          session.set(key, value);
          return Promise.resolve();
        },
        remove: (key) => {
          session.delete(key);
          return Promise.resolve();
        },
        list: () => Promise.resolve([...session.entries()].map(([key, value]) => ({ key, value }))),
      },
    });
    await expect(store.put({ moduleId: 'm', actionId: 'a' })).rejects.toThrow();
    await expect(
      store.put({ moduleId: 'm', actionId: 'a', result: 'x', input: { version: 1 } }),
    ).rejects.toThrow();
    await expect(store.put({ moduleId: 'm', actionId: 'a', result: '' })).rejects.toThrow();
    expect(session.size).toBe(0);
  });
});
