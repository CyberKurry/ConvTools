import {
  createCorrelationId,
  type MessageEnvelope,
  type MessageMap,
  type MessageType,
  MessagingError,
  type Transport,
} from './protocol';

export interface RequestOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface MessageClient<M extends MessageMap> {
  request<T extends MessageType<M>>(
    type: T,
    payload: M[T]['request'],
    options?: RequestOptions,
  ): Promise<M[T]['response']>;
}

interface Pending {
  readonly type: string;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: MessagingError) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

export function createMessageClient<M extends MessageMap>(
  transport: Transport,
  defaults: { timeoutMs?: number } = {},
): MessageClient<M> {
  const pending = new Map<string, Pending>();
  transport.subscribe((message) => {
    if (message.kind !== 'response') {
      return;
    }
    settle(pending, message);
  });

  return {
    request(type, payload, options = {}) {
      const id = createCorrelationId();
      const timeoutMs = options.timeoutMs ?? defaults.timeoutMs ?? 5_000;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          options.signal?.removeEventListener('abort', onAbort);
          pending.delete(id);
          reject(new MessagingError('TIMEOUT', `timed out waiting for ${type}`));
        }, timeoutMs);
        const onAbort = (): void => {
          clearTimeout(timer);
          pending.delete(id);
          reject(new MessagingError('ABORTED', `request ${type} aborted`));
        };
        if (options.signal) {
          if (options.signal.aborted) {
            clearTimeout(timer);
            onAbort();
            return;
          }
          options.signal.addEventListener('abort', onAbort, { once: true });
        }
        pending.set(id, {
          type,
          resolve: (value) => {
            clearTimeout(timer);
            options.signal?.removeEventListener('abort', onAbort);
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timer);
            options.signal?.removeEventListener('abort', onAbort);
            reject(error);
          },
          timer,
        });
        try {
          transport.send({ kind: 'request', type, id, payload });
        } catch {
          clearTimeout(timer);
          options.signal?.removeEventListener('abort', onAbort);
          pending.delete(id);
          reject(new MessagingError('SEND_FAILED', 'The request could not be sent.'));
        }
      });
    },
  };
}

function settle(pending: Map<string, Pending>, message: Extract<MessageEnvelope, { kind: 'response' }>): void {
  const waiter = pending.get(message.id);
  if (!waiter || waiter.type !== message.type) {
    return;
  }
  pending.delete(message.id);
  if (message.ok) {
    waiter.resolve(message.payload);
    return;
  }
  waiter.reject(new MessagingError(message.error.code, message.error.message));
}
