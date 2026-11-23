import { createCorrelationId, MessagingError } from './protocol';
import type { MessageMap, MessageType } from './protocol';

/**
 * Structural runtime surface; the WXT-injected global satisfies it, tests
 * pass a stub with the same shape.
 */
export interface RuntimeMessaging {
  onMessage?: {
    addListener(listener: (message: unknown) => unknown): void;
  };
  sendMessage(message: unknown): Promise<unknown>;
}

/** Client bound to `browser.runtime`: responses resolve from sendMessage. */
export interface RuntimeMessageClient<M extends MessageMap> {
  request<T extends MessageType<M>>(type: T, payload: M[T]['request']): Promise<M[T]['response']>;
}

/**
 * Client half of the typed message bus for `runtime` transports.
 *
 * `createMessageClient` expects a two-way Transport where responses arrive on
 * a subscription, but `runtime.sendMessage` already resolves with the
 * response, so this client sends one request envelope and settles from the
 * returned promise. Envelope shape and error codes match the protocol.
 */
export function createRuntimeMessageClient<M extends MessageMap>(
  runtime: RuntimeMessaging,
): RuntimeMessageClient<M> {
  return {
    async request(type, payload) {
      const response = await runtime.sendMessage({
        kind: 'request',
        type,
        id: createCorrelationId(),
        payload,
      });
      if (!isResponseEnvelope(response, type)) {
        throw new MessagingError('BAD_RESPONSE', `response for ${type} was not a protocol envelope`);
      }
      if (!response.ok) {
        const error = response.error ?? { code: 'HANDLER_FAILED', message: 'The requested operation failed.' };
        throw new MessagingError(error.code, error.message);
      }
      return response.payload;
    },
  };
}

interface ResponseShape {
  readonly kind: 'response';
  readonly type: string;
  readonly id: string;
  readonly ok: boolean;
  readonly payload?: unknown;
  readonly error?: { readonly code: string; readonly message: string };
}

function isResponseEnvelope(value: unknown, type: string): value is ResponseShape {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<ResponseShape>;
  return candidate.kind === 'response' && candidate.type === type && typeof candidate.id === 'string';
}
