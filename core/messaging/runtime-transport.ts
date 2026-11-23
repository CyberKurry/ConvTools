import type { MessageEnvelope } from './protocol';

/**
 * Structural runtime surface the transport needs; the WXT-injected global
 * satisfies it, tests pass a stub with the same shape.
 */
interface RuntimeMessaging {
  onMessage: {
    addListener(listener: (message: unknown) => unknown): void;
  };
  sendMessage(message: unknown): Promise<unknown>;
}

/** Narrow untrusted runtime traffic to a protocol envelope before use. */
export function isEnvelope(value: unknown): value is MessageEnvelope {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<MessageEnvelope>;
  return (
    (candidate.kind === 'request' || candidate.kind === 'response') &&
    typeof candidate.type === 'string' &&
    typeof candidate.id === 'string'
  );
}

/**
 * Server-side adapter: dispatches request envelopes observed on
 * `runtime.onMessage` and answers through the listener's returned promise.
 *
 * Messages from other extension contexts may also be observed by other
 * listeners, so the listener returns a value only for protocol envelopes;
 * returning a promise for a foreign message would swallow it.
 */
export function attachRuntimeRouter(
  runtime: RuntimeMessaging,
  dispatch: (request: Extract<MessageEnvelope, { kind: 'request' }>) => Promise<MessageEnvelope>,
): void {
  runtime.onMessage.addListener((message) => {
    if (!isEnvelope(message) || message.kind !== 'request') {
      return undefined;
    }
    return dispatch(message);
  });
}

