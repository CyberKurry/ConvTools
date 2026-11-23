import { renderCardToBuffer } from './render';
import type { CardWorkerMessage, CardWorkerRequest } from './protocol';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (event: MessageEvent<unknown>): void => {
  const request = event.data;
  if (!isCardWorkerRequest(request)) {
    const message: CardWorkerMessage = {
      type: 'error',
      id: requestId(request),
      code: 'INVALID_CARD_JOB',
      message: 'invalid card render request',
    };
    ctx.postMessage(message);
    return;
  }
  void renderCardToBuffer(request.card, request.scale)
    .then(({ buffer, width, height, excerptTruncated }) => {
      const message: CardWorkerMessage = {
        type: 'done',
        id: request.id,
        buffer,
        width,
        height,
        excerptTruncated,
      };
      ctx.postMessage(message, [buffer]);
    })
    .catch((error: unknown) => {
      // Preserve the typed code (INVALID_CARD_JOB, QR_ENCODE_FAILED, …) so
      // callers can distinguish job-integrity failures from render crashes.
      const message: CardWorkerMessage = {
        type: 'error',
        id: request.id,
        code: errorCode(error),
        message: error instanceof Error ? error.message : 'unknown',
      };
      ctx.postMessage(message);
  });
};

/**
 * Keeps the most specific code available: a structured `code` property, or a
 * message that already is the code (`render.ts` throws bare Error instances
 * such as CARD_CANVAS_UNAVAILABLE). Losing the code here made every render
 * failure look identical in logs and in the controller's error channel.
 */
function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  if (typeof code === 'string' && code.length > 0) {
    return code;
  }
  if (error instanceof Error && /^[A-Z][A-Z0-9_]*$/.test(error.message)) {
    return error.message;
  }
  return 'CARD_RENDER_FAILED';
}

function isCardWorkerRequest(value: unknown): value is CardWorkerRequest {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const request = value as Record<string, unknown>;
  return typeof request.id === 'number' && Number.isSafeInteger(request.id) && request.id > 0 &&
    (request.scale === 1 || request.scale === 2) &&
    typeof request.card === 'object' && request.card !== null;
}

function requestId(value: unknown): number {
  if (typeof value === 'object' && value !== null) {
    const id = (value as Record<string, unknown>).id;
    if (typeof id === 'number' && Number.isSafeInteger(id) && id >= 0) {
      return id;
    }
  }
  return 0;
}
