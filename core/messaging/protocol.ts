export interface MessageMap {
  [type: string]: {
    request: unknown;
    response: unknown;
  };
}

export type MessageType<M extends MessageMap> = Extract<keyof M, string>;

export interface RequestEnvelope<M extends MessageMap = MessageMap, T extends MessageType<M> = MessageType<M>> {
  readonly kind: 'request';
  readonly type: T;
  readonly id: string;
  readonly payload: M[T]['request'];
}

export interface SuccessEnvelope<M extends MessageMap = MessageMap, T extends MessageType<M> = MessageType<M>> {
  readonly kind: 'response';
  readonly type: T;
  readonly id: string;
  readonly ok: true;
  readonly payload: M[T]['response'];
}

export interface FailureEnvelope {
  readonly kind: 'response';
  readonly type: string;
  readonly id: string;
  readonly ok: false;
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

export type MessageEnvelope<M extends MessageMap = MessageMap> =
  | RequestEnvelope<M>
  | SuccessEnvelope<M>
  | FailureEnvelope;

export interface Transport {
  send(message: MessageEnvelope): void;
  subscribe(listener: (message: MessageEnvelope) => void): () => void;
}

export class MessagingError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'MessagingError';
    this.code = code;
  }
}

let fallbackCorrelationSequence = 0;

export function createCorrelationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return `msg-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  }
  fallbackCorrelationSequence = (fallbackCorrelationSequence + 1) % Number.MAX_SAFE_INTEGER;
  return `msg-${Date.now()}-${fallbackCorrelationSequence}`;
}
