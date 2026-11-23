import { isSelectionImageResult, type SelectionImageResult } from '../module-sdk/runtime';

export interface HandoffPayload {
  readonly token: string;
  readonly moduleId: string;
  readonly actionId: string;
  /** Result hand-off: the action's finished output (text today, image with the approved SW appendix). */
  readonly result?: string | SelectionImageResult;
  /**
   * Input hand-off: a module-defined, module-versioned payload for the
   * workbench to render from. The core never inspects its fields.
   */
  readonly input?: unknown;
  readonly createdAt: number;
}

export interface HandoffStore {
  put(payload: Omit<HandoffPayload, 'token' | 'createdAt'>): Promise<string>;
  consume(token: string): Promise<HandoffPayload | null>;
  expire(now?: number): Promise<void>;
}

export interface HandoffSessionEntry {
  readonly key: string;
  readonly value: unknown;
}

const TTL_MS = 5 * 60 * 1000;
export const HANDOFF_KEY_PREFIX = 'convtools:handoff:';

function storageKey(token: string): string {
  return `${HANDOFF_KEY_PREFIX}${token}`;
}

export function isHandoffPayload(value: unknown): value is HandoffPayload {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const payload = value as Record<string, unknown>;
  const token = payload.token;
  const moduleId = payload.moduleId;
  const actionId = payload.actionId;
  const createdAt = payload.createdAt;
  const hasResult = payload.result !== undefined;
  const hasInput = payload.input !== undefined;
  const validResult =
    (typeof payload.result === 'string' && payload.result.length > 0) ||
    isSelectionImageResult(payload.result);
  return (
    typeof token === 'string' &&
    token.length > 0 &&
    typeof moduleId === 'string' &&
    moduleId.length > 0 &&
    typeof actionId === 'string' &&
    actionId.length > 0 &&
    typeof createdAt === 'number' &&
    Number.isSafeInteger(createdAt) &&
    createdAt >= 0 &&
    hasResult !== hasInput &&
    (!hasResult || validResult)
  );
}

export function createHandoffStore(options: {
  incognito: boolean;
  session: {
    get(key: string): Promise<unknown>;
    set(key: string, value: HandoffPayload): Promise<void>;
    remove(key: string): Promise<void>;
    list(): Promise<readonly HandoffSessionEntry[]>;
  };
  memory: Map<string, HandoffPayload>;
  now?: () => number;
  randomToken?: () => string;
}): HandoffStore {
  const now = options.now ?? Date.now;
  const randomToken = options.randomToken ?? (() => crypto.randomUUID());
  const consuming = new Set<string>();

  function fresh(payload: HandoffPayload, at: number): boolean {
    const age = at - payload.createdAt;
    return age >= 0 && age <= TTL_MS;
  }

  async function sweep(at: number): Promise<void> {
    if (options.incognito) {
      for (const [token, payload] of options.memory) {
        if (!isHandoffPayload(payload) || !fresh(payload, at)) {
          options.memory.delete(token);
        }
      }
      return;
    }
    for (const entry of await options.session.list()) {
      const payload = entry.value;
      if (!isHandoffPayload(payload) || !fresh(payload, at) || entry.key !== storageKey(payload.token)) {
        await options.session.remove(entry.key);
      }
    }
  }

  return {
    async put(input) {
      // Exactly one hand-off kind per token: the workbench consumes the token
      // once and renders either a finished result or an editor prefill.
      const hasResult = input.result !== undefined;
      const hasInput = input.input !== undefined;
      if (hasResult === hasInput) {
        throw new Error('HANDOFF_PAYLOAD_MUST_BE_RESULT_XOR_INPUT');
      }
      if (hasResult && typeof input.result === 'string' && input.result.length === 0) {
        throw new Error('HANDOFF_PAYLOAD_MUST_BE_RESULT_XOR_INPUT');
      }
      if (input.moduleId.length === 0 || input.actionId.length === 0) {
        throw new Error('HANDOFF_PAYLOAD_MUST_IDENTIFY_ACTION');
      }
      const payload: HandoffPayload = {
        ...input,
        token: randomToken(),
        createdAt: now(),
      };
      if (options.incognito) {
        options.memory.set(payload.token, payload);
      } else {
        await options.session.set(storageKey(payload.token), payload);
      }
      // Rolling sweep: the startup-only sweep left expired payloads (possibly
      // multi-MB fallback results) in session storage for the SW's lifetime.
      void sweep(now()).catch(() => undefined);
      return payload.token;
    },
    async consume(token) {
      // storage.session has no compare-and-delete primitive. A background
      // service worker is the sole writer for this extension, so a short-lived
      // in-process claim closes the get/remove race between two workbench tabs.
      if (consuming.has(token)) {
        return null;
      }
      consuming.add(token);
      try {
        if (options.incognito) {
          const payload = options.memory.get(token) ?? null;
          options.memory.delete(token);
          return payload && isHandoffPayload(payload) && fresh(payload, now()) ? payload : null;
        }
        const payload = (await options.session.get(storageKey(token))) ?? null;
        if (!payload || !isHandoffPayload(payload) || payload.token !== token) {
          if (payload) {
            await options.session.remove(storageKey(token));
          }
          return null;
        }
        await options.session.remove(storageKey(token));
        return fresh(payload, now()) ? payload : null;
      } finally {
        consuming.delete(token);
      }
    },
    async expire(at = now()) {
      await sweep(at);
    },
  };
}
