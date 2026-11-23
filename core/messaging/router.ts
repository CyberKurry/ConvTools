import { type MessageEnvelope, type MessageMap, type MessageType, MessagingError, type Transport } from './protocol';

type Handler<M extends MessageMap, T extends MessageType<M>> = (
  payload: M[T]['request'],
) => M[T]['response'] | Promise<M[T]['response']>;

type AnyHandler = (payload: unknown) => unknown;

export interface MessageRouter<M extends MessageMap> {
  handle<T extends MessageType<M>>(type: T, handler: Handler<M, T>): void;
  attach(transport: Transport): () => void;
  /**
   * Dispatches one request envelope and returns the response envelope without
   * a Transport. Transports whose reply channel is the listener's return
   * value (runtime.onMessage) use this instead of attach().
   */
  dispatch(request: Extract<MessageEnvelope, { kind: 'request' }>): Promise<MessageEnvelope>;
}

export function createMessageRouter<M extends MessageMap>(): MessageRouter<M> {
  const handlers = new Map<string, AnyHandler>();

  return {
    handle(type, handler) {
      handlers.set(type, handler);
    },
    attach(transport) {
      return transport.subscribe((message) => {
        if (message.kind !== 'request') {
          return;
        }
        void dispatch(transport, handlers, message);
      });
    },
    dispatch(request) {
      // Reply into a captured sink: the response envelope is returned to the
      // caller (runtime.onMessage answers through the listener's promise).
      let reply: MessageEnvelope | undefined;
      const sinkTransport: Transport = {
        send(message) {
          reply = message;
        },
        subscribe() {
          return () => undefined;
        },
      };
      return dispatch(sinkTransport, handlers, request).then(() => {
        if (reply === undefined) {
          throw new Error('router produced no response');
        }
        return reply;
      });
    },
  };
}

async function dispatch(
  transport: Transport,
  handlers: Map<string, AnyHandler>,
  message: Extract<MessageEnvelope, { kind: 'request' }>,
): Promise<void> {
  const handler = handlers.get(message.type);
  if (!handler) {
    transport.send({
      kind: 'response',
      type: message.type,
      id: message.id,
      ok: false,
      error: { code: 'UNKNOWN_MESSAGE', message: 'The requested operation failed.' },
    });
    return;
  }
  try {
    const payload = await handler(message.payload);
    transport.send({
      kind: 'response',
      type: message.type,
      id: message.id,
      ok: true,
      payload,
    });
  } catch (error) {
    const code = error instanceof MessagingError ? error.code : 'HANDLER_FAILED';
    transport.send({
      kind: 'response',
      type: message.type,
      id: message.id,
      ok: false,
      error: { code, message: code === 'HANDLER_FAILED' ? 'The requested operation failed.' : errorMessage(error) },
    });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0 ? error.message : 'The request was rejected.';
}
