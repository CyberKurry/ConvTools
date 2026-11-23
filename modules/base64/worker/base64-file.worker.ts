/// <reference lib="webworker" />
import { processFileJob } from './process-file';
import type { FileJobRequest, FileWorkerMessage } from './protocol';

const worker = self as DedicatedWorkerGlobalScope;

// Structured validation of the only message the worker accepts: anything else
// is answered with a typed error instead of trusting event.data blindly.
function isFileJobRequest(data: unknown): data is FileJobRequest {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  const job = data as Record<string, unknown>;
  return (
    (job.kind === 'encode' || job.kind === 'decode') &&
    job.buffer instanceof ArrayBuffer &&
    (job.format === 'standard' || job.format === 'url' || job.format === 'data-url') &&
    (job.mode === 'strict' || job.mode === 'tolerant')
  );
}

worker.addEventListener('message', (event: MessageEvent<FileJobRequest>) => {
  if (!isFileJobRequest(event.data)) {
    const message: FileWorkerMessage = {
      type: 'error',
      code: 'INVALID_JOB',
      message: 'invalid file job request',
    };
    worker.postMessage(message);
    return;
  }
  try {
    const result = processFileJob(event.data, (progress) => {
      const message: FileWorkerMessage = progress;
      worker.postMessage(message);
    });
    const message: FileWorkerMessage = { type: 'result', ...result };
    worker.postMessage(message, result.chunks);
  } catch (error) {
    const message: FileWorkerMessage = {
      type: 'error',
      code: error instanceof Error && 'code' in error ? String((error as { code: string }).code) : 'WORKER_FAILED',
      message: error instanceof Error ? error.message : 'worker failed',
    };
    worker.postMessage(message);
  }
});
