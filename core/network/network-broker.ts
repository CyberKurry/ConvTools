import { UNDECLARED_ORIGIN, UndeclaredCapabilityError } from '../permissions/permission-service';
import { PersistenceBlockedError } from '../storage/persistence-guard';
import type { SendPolicyStore } from './send-policy';
import type { ConfirmationChoice, NetworkBrokerResult, NetworkRequestIntent } from './types';

export const NETWORK_DENIED = 'NETWORK_DENIED';
export const NETWORK_FAILED = 'NETWORK_FAILED';
export const NETWORK_INVALID_INTENT = 'NETWORK_INVALID_INTENT';
export const NETWORK_TIMEOUT = 'NETWORK_TIMEOUT';
export const NETWORK_CANCELLED = 'NETWORK_CANCELLED';

export class NetworkBrokerError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'NetworkBrokerError';
    this.code = code;
  }
}

export interface NetworkBroker {
  request(intent: NetworkRequestIntent, options?: { signal?: AbortSignal }): Promise<NetworkBrokerResult>;
}

export function createNetworkBroker(options: {
  fetchImpl: typeof fetch;
  confirm: (intent: NetworkRequestIntent) => Promise<ConfirmationChoice>;
  policies: SendPolicyStore;
  declaredOrigins: Readonly<Record<string, readonly string[]>>;
  hasPermission: (intent: NetworkRequestIntent) => Promise<boolean>;
  maxResponseBytes?: number;
}): NetworkBroker {
  const maxResponseBytes = options.maxResponseBytes ?? 1024 * 1024;

  return {
    async request(intent, requestOptions) {
      const externalSignal = requestOptions?.signal;
      if (externalSignal?.aborted) {
        throw new NetworkBrokerError(NETWORK_CANCELLED, 'request cancelled');
      }

      const controller = new AbortController();
      let timedOut = false;
      let rejectCancellation: ((error: NetworkBrokerError) => void) | undefined;
      const cancellation = new Promise<never>((_, reject) => {
        rejectCancellation = reject;
      });
      const onExternalAbort = (): void => {
        controller.abort();
        rejectCancellation?.(new NetworkBrokerError(NETWORK_CANCELLED, 'request cancelled'));
      };
      externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
      const timeoutMs = clampTimeout(intent.timeoutMs);
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        rejectCancellation?.(new NetworkBrokerError(NETWORK_TIMEOUT, 'request timed out'));
      }, timeoutMs);

      const cancellable = <T>(operation: Promise<T>): Promise<T> =>
        Promise.race([operation, cancellation]);

      // Intent integrity (spec §13.2): the confirmation dialog shows
      // byteCount/preview, so the payload must not quietly diverge from what
      // the user approved, and timeouts must stay in a sane window.
      try {
        const body = intentBody(intent);
        if (body !== undefined) {
          const actualBytes = new TextEncoder().encode(body).length;
          if (!Number.isSafeInteger(intent.byteCount) || actualBytes !== intent.byteCount) {
            throw new NetworkBrokerError(
              NETWORK_INVALID_INTENT,
              'declared byteCount does not match the request body',
            );
          }
        } else if (!Number.isSafeInteger(intent.byteCount) || intent.byteCount < 0) {
          throw new NetworkBrokerError(NETWORK_INVALID_INTENT, 'invalid request byteCount');
        }

        const declared = options.declaredOrigins[intent.moduleId] ?? [];
        // The permission string is the exact host pattern the user approved.
        // Requiring it to be declared and to match the origin prevents a
        // module from showing consent for one target while sending to another.
        if (!declared.includes(intent.permission) || !originAllowed(intent.origin, [intent.permission])) {
          throw new UndeclaredCapabilityError(UNDECLARED_ORIGIN, `undeclared origin ${intent.origin}`);
        }

        const permitted = await cancellable(options.hasPermission(intent));
        if (!permitted) {
          throw new NetworkBrokerError(NETWORK_DENIED, 'missing host permission');
        }
        const always = await cancellable(
          options.policies.isAlwaysAllowed(intent.moduleId, intent.origin, intent.dataCategory),
        );
        if (!always) {
          const choice = await cancellable(options.confirm(intent));
          if (choice === 'deny') {
            throw new NetworkBrokerError(NETWORK_DENIED, 'user denied the request');
          }
          if (choice === 'always') {
            try {
              await cancellable(options.policies.allowAlways(intent.moduleId, intent.origin, intent.dataCategory));
            } catch (error) {
              // Incognito blocks policy persistence by design (spec §14); the
              // user's "always" then simply degrades to once-only semantics.
              if (!(error instanceof PersistenceBlockedError)) {
                throw error;
              }
            }
          }
        }

        const init: RequestInit = {
          method: intent.method,
          signal: controller.signal,
          redirect: 'error',
        };
        const requestBody = intentBody(intent);
        if (requestBody !== undefined) {
          init.body = requestBody;
        }
        const response = await cancellable(options.fetchImpl(intent.origin, init));
        const responseBody = await cancellable(readCapped(response, maxResponseBytes, controller.signal));
        return { ok: true, status: response.status, body: responseBody };
      } catch (error) {
        if (error instanceof NetworkBrokerError || error instanceof UndeclaredCapabilityError) {
          throw error;
        }
        if (externalSignal?.aborted) {
          throw new NetworkBrokerError(NETWORK_CANCELLED, 'request cancelled');
        }
        if (timedOut || (error instanceof DOMException && error.name === 'AbortError')) {
          throw new NetworkBrokerError(NETWORK_TIMEOUT, 'request timed out');
        }
        throw new NetworkBrokerError(NETWORK_FAILED, 'network request failed');
      } finally {
        clearTimeout(timer);
        externalSignal?.removeEventListener('abort', onExternalAbort);
      }
    },
  };
}

function intentBody(intent: NetworkRequestIntent): string | undefined {
  // The confirmation dialog already showed byteCount/preview; only send the
  // payload when the module actually carries one.
  return intent.body;
}

const MIN_TIMEOUT_MS = 1;
const MAX_TIMEOUT_MS = 60_000;

function clampTimeout(value: number): number {
  if (!Number.isFinite(value)) {
    return MAX_TIMEOUT_MS;
  }
  return Math.min(Math.max(Math.floor(value), MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);
}

/**
 * Reads at most maxResponseBytes from the body and aborts the connection as
 * soon as the cap is exceeded, so a hostile endpoint cannot stream unbounded
 * data into extension memory (spec §13.2 response size limit).
 */
async function readCapped(response: Response, maxResponseBytes: number, signal?: AbortSignal): Promise<string> {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null && Number(declaredLength) > maxResponseBytes) {
    throw new NetworkBrokerError(NETWORK_FAILED, 'response too large');
  }
  const reader = response.body?.getReader();
  if (!reader) {
    // Without a stream the cap cannot be enforced mid-read: only truly
    // bodyless statuses (204/304) are accepted, everything else is refused
    // instead of reading an unbounded body into memory.
    if (response.status === 204 || response.status === 304) {
      return '';
    }
    throw new NetworkBrokerError(NETWORK_FAILED, 'response body is not readable');
  }
  const decoder = new TextDecoder();
  let received = 0;
  let text = '';
  const onAbort = (): void => {
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    for (;;) {
      if (signal?.aborted) {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      received += value.byteLength;
      if (received > maxResponseBytes) {
        void reader.cancel().catch(() => undefined);
        throw new NetworkBrokerError(NETWORK_FAILED, 'response too large');
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return enforceCap(text, maxResponseBytes);
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}

function enforceCap(text: string, maxResponseBytes: number): string {
  if (new TextEncoder().encode(text).length > maxResponseBytes) {
    throw new NetworkBrokerError(NETWORK_FAILED, 'response too large');
  }
  return text;
}

/**
 * Compares parsed URL components instead of raw string prefixes: path/query/
 * userinfo tricks (`https://example.com/evil`, `https://user@host/`) and
 * case games cannot smuggle an undeclared target through the check.
 */
function originAllowed(origin: string, patterns: readonly string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  const pathOk = parsed.pathname === '/' || parsed.pathname === '';
  if (!pathOk || parsed.search !== '' || parsed.hash !== '' || parsed.username !== '' || parsed.password !== '') {
    return false;
  }
  return patterns.some((pattern) => {
    if (pattern.endsWith('/*')) {
      return sameOrigin(pattern.slice(0, -2), parsed);
    }
    return sameOrigin(pattern, parsed);
  });
}

function sameOrigin(candidate: string, parsed: URL): boolean {
  try {
    const other = new URL(candidate);
    return other.protocol === parsed.protocol && other.hostname === parsed.hostname && other.port === parsed.port;
  } catch {
    return false;
  }
}
