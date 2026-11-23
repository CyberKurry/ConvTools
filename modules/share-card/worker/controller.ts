import type { CardSpec, CardWorkerMessage, CardWorkerRequest } from './protocol';
import { createWorkerJobController } from '../../../core/worker/job-controller';

export interface CardRenderResult {
  readonly buffer: ArrayBuffer;
  readonly width: number;
  readonly height: number;
  readonly excerptTruncated: boolean;
}

export interface CardWorkerHandle {
  postMessage(request: CardWorkerRequest, transfer?: Transferable[]): void;
  terminate(): void;
  addEventListener(type: 'message', listener: (event: { data: CardWorkerMessage }) => void): void;
  addEventListener(type: 'error', listener: (event: { message?: string }) => void): void;
  removeEventListener(type: 'message', listener: (event: { data: CardWorkerMessage }) => void): void;
  removeEventListener(type: 'error', listener: (event: { message?: string }) => void): void;
}

export type CardWorkerFactory = () => CardWorkerHandle;

// A DOM Worker structurally satisfies the handle; no assertion needed.
export function defaultCardWorkerFactory(): CardWorkerHandle {
  return new Worker(new URL('./card-render.worker.ts', import.meta.url), { type: 'module' });
}

export interface CardController {
  run(job: { card: CardSpec; scale: 1 | 2 }): Promise<CardRenderResult>;
  cancel(): void;
  dispose(): void;
}

/**
 * One warm render worker at a time. A new preview or export cancels the old
 * job, terminates its worker, and starts from a clean execution context so a
 * stalled/corrupted render cannot consume resources indefinitely; a handled
 * (protocol-level) failure keeps the worker for the next run.
 */
export function createCardController(options: { createWorker?: CardWorkerFactory; timeoutMs?: number } = {}): CardController {
  const createWorker = options.createWorker ?? defaultCardWorkerFactory;
  const controller = createWorkerJobController<
    { card: CardSpec; scale: 1 | 2 },
    CardWorkerRequest,
    CardWorkerMessage,
    CardRenderResult,
    never
  >({
    createWorker,
    lifetime: 'persistent',
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    timeoutMessage: 'card worker timed out',
    idOf: (message) => message.id,
    toRequest: (job, id) => ({ id, card: job.card, scale: job.scale }),
    interpret: (message) => {
      if (message.type === 'done') {
        return {
          kind: 'result',
          result: {
            buffer: message.buffer,
            width: message.width,
            height: message.height,
            excerptTruncated: message.excerptTruncated,
          },
        };
      }
      return { kind: 'error', code: message.code, message: message.message };
    },
  });
  return {
    run: (job) => controller.run(job),
    cancel: () => controller.cancel(),
    dispose: () => controller.dispose(),
  };
}
