import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CardWorkerMessage } from './protocol';

/**
 * Drives the real worker module through a stubbed `self` so the error mapping
 * between a render failure and the protocol message stays observable.
 */
async function runWorker(render: () => Promise<never>): Promise<CardWorkerMessage[]> {
  const posted: CardWorkerMessage[] = [];
  vi.resetModules();
  vi.doMock('./render', () => ({ renderCardToBuffer: render }));
  const ctx = {
    onmessage: undefined as ((event: { data: unknown }) => void) | undefined,
    postMessage: (message: CardWorkerMessage): void => {
      posted.push(message);
    },
  };
  vi.stubGlobal('self', ctx);
  await import('./card-render.worker');
  ctx.onmessage?.({ data: { id: 7, scale: 1, card: { excerpt: 'x' } } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  return posted;
}

afterEach(() => {
  vi.doUnmock('./render');
  vi.unstubAllGlobals();
});

describe('card render worker error codes', () => {
  it('preserves a structured error code instead of overwriting it (L)', async () => {
    const posted = await runWorker(() =>
      Promise.reject(Object.assign(new Error('qr text is empty'), { code: 'QR_ENCODE_FAILED' })),
    );
    expect(posted).toEqual([
      expect.objectContaining({ type: 'error', id: 7, code: 'QR_ENCODE_FAILED' }),
    ]);
  });

  it('keeps an error whose message is the code (L)', async () => {
    const posted = await runWorker(() => Promise.reject(new Error('CARD_CANVAS_UNAVAILABLE')));
    expect(posted).toEqual([
      expect.objectContaining({ type: 'error', id: 7, code: 'CARD_CANVAS_UNAVAILABLE' }),
    ]);
  });

  it('falls back to the generic code for unrecognized failures (L)', async () => {
    const posted = await runWorker(() => Promise.reject(new Error('canvas exploded')));
    expect(posted).toEqual([
      expect.objectContaining({ type: 'error', id: 7, code: 'CARD_RENDER_FAILED' }),
    ]);
  });
});
