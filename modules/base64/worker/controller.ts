import { assertFileSize, type ProcessFileResult } from './process-file';
import type { FileJobRequest, FileProgressMessage, FileWorkerMessage } from './protocol';
import { createWorkerJobController } from '../../../core/worker/job-controller';

export interface FileController {
  run(job: FileJobRequest, onProgress?: (progress: FileProgressMessage) => void): Promise<ProcessFileResult>;
  cancel(): void;
  dispose(): void;
}

/**
 * Minimal structural Worker surface so tests can drive the message protocol
 * without a real Worker implementation.
 */
export interface FileWorkerHandle {
  postMessage(message: FileJobRequest, transfer?: ArrayBuffer[]): void;
  terminate(): void;
  addEventListener(type: 'message', listener: (event: { data: FileWorkerMessage }) => void): void;
  addEventListener(type: 'error', listener: (event: { message?: string }) => void): void;
  removeEventListener(type: 'message', listener: (event: { data: FileWorkerMessage }) => void): void;
  removeEventListener(type: 'error', listener: (event: { message?: string }) => void): void;
}

export type FileWorkerFactory = () => FileWorkerHandle;

export function defaultFileWorkerFactory(): FileWorkerHandle {
  return new Worker(new URL('./base64-file.worker.ts', import.meta.url), { type: 'module' }) as unknown as FileWorkerHandle;
}

/**
 * One worker per file job: a completed or failed run terminates its worker
 * instead of leaving idle workers behind across consecutive conversions.
 */
export function createFileController(options: {
  createWorker?: FileWorkerFactory;
  timeoutMs?: number;
} = {}): FileController {
  const createWorker = options.createWorker ?? defaultFileWorkerFactory;
  const controller = createWorkerJobController<
    FileJobRequest,
    FileJobRequest,
    FileWorkerMessage,
    ProcessFileResult,
    FileProgressMessage
  >({
    createWorker,
    lifetime: 'per-job',
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    timeoutMessage: 'worker timed out',
    // Single-job protocol: no request ids; the buffer transfers to the worker.
    toRequest: (job) => job,
    transfer: (job) => [job.buffer],
    interpret: (message) => {
      if (message.type === 'progress') {
        return { kind: 'progress', progress: message };
      }
      if (message.type === 'result') {
        return { kind: 'result', result: message };
      }
      return { kind: 'error', code: message.code, message: message.message };
    },
  });
  return {
    run(job, onProgress) {
      try {
        // Reject oversized files before any buffer transfer (spec §11.2).
        assertFileSize(job.buffer.byteLength);
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
      return controller.run(job, onProgress);
    },
    cancel: () => controller.cancel(),
    dispose: () => controller.dispose(),
  };
}
