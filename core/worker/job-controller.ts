/**
 * One worker-job controller for every module worker (spec §16: long jobs run
 * in a Web Worker with progress, cancellation and bounded lifetimes).
 *
 * The two former copies (base64 file jobs and share-card renders) differed
 * only in policy, so the policy is now explicit parameters:
 * - lifetime 'per-job' terminates the worker the moment its run settles;
 *   'persistent' keeps one lazy worker across runs and replaces it on
 *   cancel, crash, timeout, or dispose.
 * - 'idOf' enables request-id correlation; without it the single active run
 *   owns every message (single-job protocol).
 */

export interface WorkerJobHandle<Request, Message> {
  postMessage(message: Request, transfer?: ArrayBuffer[]): void;
  terminate(): void;
  addEventListener(type: 'message', listener: (event: { data: Message }) => void): void;
  addEventListener(type: 'error', listener: (event: { message?: string }) => void): void;
  removeEventListener(type: 'message', listener: (event: { data: Message }) => void): void;
  removeEventListener(type: 'error', listener: (event: { message?: string }) => void): void;
}

export type WorkerMessageOutcome<Result, Progress> =
  | { readonly kind: 'progress'; readonly progress: Progress }
  | { readonly kind: 'result'; readonly result: Result }
  | { readonly kind: 'error'; readonly code?: string; readonly message: string };

export interface WorkerJobControllerOptions<Job, Request, Message, Result, Progress> {
  /** Factory for new workers; called lazily, never after dispose. */
  readonly createWorker: () => WorkerJobHandle<Request, Message>;
  /** 'per-job': one worker per run, terminated when it settles. */
  readonly lifetime: 'per-job' | 'persistent';
  /** Correlation id inside responses; messages without one always match. */
  readonly idOf?: (message: Message) => number | undefined;
  /** Builds the wire request for a job. */
  readonly toRequest: (job: Job, id: number) => Request;
  /** Transfer list for the request, when the job owns a buffer. */
  readonly transfer?: (job: Job) => ArrayBuffer[] | undefined;
  /** Maps one worker message onto progress, result, or a structured error. */
  readonly interpret: (message: Message) => WorkerMessageOutcome<Result, Progress>;
  readonly timeoutMs?: number;
  readonly timeoutMessage?: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;

interface WorkerInstance<Request, Message> {
  readonly handle: WorkerJobHandle<Request, Message>;
  readonly detach: () => void;
}

interface ActiveRun<Result, Progress> {
  readonly id: number;
  readonly worker: WorkerInstance<unknown, unknown>;
  readonly resolve: (result: Result) => void;
  readonly reject: (error: Error) => void;
  readonly onProgress?: (progress: Progress) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

export function createWorkerJobController<Job, Request, Message, Result, Progress = never>(
  options: WorkerJobControllerOptions<Job, Request, Message, Result, Progress>,
): {
  run(job: Job, onProgress?: (progress: Progress) => void): Promise<Result>;
  cancel(): void;
  dispose(): void;
} {
  const timeoutMs = normalizeTimeout(options.timeoutMs);
  const timeoutMessage = options.timeoutMessage ?? 'worker timed out';
  let nextId = 1;
  let worker: WorkerInstance<Request, Message> | null = null;
  // Only the active run's worker is typed loosely here; the generic instance
  // is captured at creation and never crosses the boundary.
  let active: ActiveRun<Result, Progress> | null = null;
  let disposed = false;

  function abortError(): DOMException {
    return new DOMException('The operation was aborted.', 'AbortError');
  }

  function terminateWorker(instance: WorkerInstance<Request, Message> | null): void {
    if (!instance) {
      return;
    }
    instance.detach();
    instance.handle.terminate();
    if (worker === instance) {
      worker = null;
    }
  }

  function cancelActive(): void {
    const pending = active;
    if (!pending) {
      return;
    }
    active = null;
    clearTimeout(pending.timer);
    pending.reject(abortError());
    terminateWorker(pending.worker as WorkerInstance<Request, Message>);
  }

  function ensureWorker(): WorkerInstance<Request, Message> {
    if (worker) {
      return worker;
    }
    const handle = options.createWorker();
    const instance = attach(handle);
    worker = instance;
    return instance;
  }

  function attach(handle: WorkerJobHandle<Request, Message>): WorkerInstance<Request, Message> {
    const instance: WorkerInstance<Request, Message> = { handle, detach: () => {
      handle.removeEventListener('message', onMessage);
      handle.removeEventListener('error', onError);
    } };
    const onMessage = (event: { data: Message }): void => {
      const message = event.data;
      const pending = active;
      if (!pending || pending.worker !== (instance as unknown as WorkerInstance<unknown, unknown>)) {
        return;
      }
      const correlationId = options.idOf?.(message);
      if (correlationId !== undefined && correlationId !== pending.id) {
        return;
      }
      const outcome = options.interpret(message);
      if (outcome.kind === 'progress') {
        pending.onProgress?.(outcome.progress);
        return;
      }
      active = null;
      clearTimeout(pending.timer);
      if (outcome.kind === 'result') {
        // A finished job leaves nothing for this worker to do in per-job mode;
        // persistent mode keeps the warm worker for the next run.
        if (options.lifetime === 'per-job') {
          terminateWorker(instance);
        }
        pending.resolve(outcome.result);
        return;
      }
      const error = new Error(outcome.message);
      if (outcome.code !== undefined) {
        (error as Error & { code?: string }).code = outcome.code;
      }
      if (options.lifetime === 'per-job') {
        terminateWorker(instance);
      }
      pending.reject(error);
    };
    const onError = (event: { message?: string }): void => {
      const pending = active;
      if (pending?.worker === (instance as unknown as WorkerInstance<unknown, unknown>)) {
        active = null;
        clearTimeout(pending.timer);
        pending.reject(new Error(event.message ?? 'worker failed'));
      }
      // A crashed execution context must not be reused in either mode.
      terminateWorker(instance);
    };
    handle.addEventListener('message', onMessage);
    handle.addEventListener('error', onError);
    return instance;
  }

  return {
    run(job, onProgress) {
      return new Promise<Result>((resolve, reject) => {
        if (disposed) {
          reject(abortError());
          return;
        }
        cancelActive();
        const instance = ensureWorker();
        const id = nextId;
        nextId += 1;
        const timer = setTimeout(() => {
          const pending = active;
          if (!pending || pending.id !== id || pending.worker !== (instance as unknown as WorkerInstance<unknown, unknown>)) {
            return;
          }
          active = null;
          pending.reject(Object.assign(new Error(timeoutMessage), { code: 'WORKER_TIMEOUT' }));
          terminateWorker(instance);
        }, timeoutMs);
        active = {
          id,
          worker: instance as unknown as WorkerInstance<unknown, unknown>,
          resolve,
          reject,
          ...(onProgress ? { onProgress } : {}),
          timer,
        };
        try {
          const request = options.toRequest(job, id);
          instance.handle.postMessage(request, options.transfer?.(job));
        } catch (error) {
          active = null;
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
          terminateWorker(instance);
        }
      });
    },
    cancel() {
      cancelActive();
    },
    dispose() {
      disposed = true;
      cancelActive();
      terminateWorker(worker);
    },
  };
}

function normalizeTimeout(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_TIMEOUT_MS;
  }
  if (!Number.isFinite(value) || value < 1) {
    throw new Error('worker timeout must be a positive finite number');
  }
  return Math.floor(value);
}
