import { describe, expect, it, vi } from 'vitest';
import { processFileJob } from '../../modules/base64/worker/process-file';
import type { FileJobRequest, FileWorkerMessage } from '../../modules/base64/worker/protocol';
import { createFileController, type FileWorkerHandle } from '../../modules/base64/worker/controller';

/**
 * A fake Worker that answers with the real processing logic, exercising the
 * full message protocol (postMessage → progress/result) without a runtime
 * Worker implementation.
 */
function fakeWorkerFactory(protocol: 'result' | 'error' | 'silent' = 'result') {
  const created: FakeWorker[] = [];
  class FakeWorker implements FileWorkerHandle {
    private messageListener: ((event: { data: FileWorkerMessage }) => void) | null = null;
    private errorListener: ((event: { message?: string }) => void) | null = null;
    transferred: ArrayBuffer[] = [];
    terminated = false;

    addEventListener(type: 'message', listener: (event: { data: FileWorkerMessage }) => void): void;
    addEventListener(type: 'error', listener: (event: { message?: string }) => void): void;
    addEventListener(type: 'message' | 'error', listener: (event: { data: FileWorkerMessage; message?: string }) => void): void {
      if (type === 'message') {
        this.messageListener = listener;
      } else {
        this.errorListener = listener as (event: { message?: string }) => void;
      }
    }

    removeEventListener(type: 'message' | 'error'): void {
      if (type === 'message') {
        this.messageListener = null;
      } else {
        this.errorListener = null;
      }
    }

    postMessage(message: FileJobRequest, transfer?: ArrayBuffer[]): void {
      this.transferred = transfer ?? [];
      if (protocol === 'error') {
        this.errorListener?.({ message: 'worker exploded' });
        return;
      }
      if (protocol === 'silent') {
        return;
      }
      void queueMicrotask(() => {
        try {
          const result = processFileJob(message, (progress) => {
            this.messageListener?.({ data: progress });
          });
          this.messageListener?.({ data: { type: 'result', ...result } });
        } catch (error) {
          this.messageListener?.({
            data: {
              type: 'error',
              code: error instanceof Error && 'code' in error ? String((error as { code: unknown }).code) : 'WORKER_FAILED',
              message: error instanceof Error ? error.message : 'worker failed',
            },
          });
        }
      });
    }

    terminate(): void {
      this.terminated = true;
    }
  }
  return {
    created,
    factory: (): FileWorkerHandle => {
      const worker = new FakeWorker();
      created.push(worker);
      return worker;
    },
  };
}

describe('base64 file controller (worker protocol)', () => {
  it('posts the job with the buffer transferred and resolves the result', async () => {
    const { factory, created } = fakeWorkerFactory();
    const controller = createFileController({ createWorker: factory });
    const buffer = new TextEncoder().encode('hello').buffer;
    const result = await controller.run({ kind: 'encode', buffer, format: 'standard', mode: 'tolerant' });
    expect(result.chunks.map((chunk) => new TextDecoder().decode(chunk)).join('')).toBe('aGVsbG8=');
    expect(created[0]?.transferred).toEqual([buffer]);
    // Every settle terminates the per-run worker (spec §15): a worker left
    // idle after success leaked one isolate per conversion.
    expect(created[0]?.terminated).toBe(true);
  });

  it('terminates the worker after a completed protocol-level error too', async () => {
    const { factory, created } = fakeWorkerFactory();
    const controller = createFileController({ createWorker: factory });
    const invalid = new TextEncoder().encode('!!!!');
    await expect(
      controller.run({ kind: 'decode', buffer: invalid.buffer, format: 'standard', mode: 'strict' }),
    ).rejects.toMatchObject({ code: 'INVALID_CHARACTER' });
    expect(created[0]?.terminated).toBe(true);
  });

  it('streams progress events from the worker', async () => {
    const { factory } = fakeWorkerFactory();
    const controller = createFileController({ createWorker: factory });
    const progress: number[] = [];
    await controller.run(
      { kind: 'encode', buffer: new Uint8Array([1, 2, 3, 4]).buffer, format: 'standard', mode: 'tolerant', chunkSize: 1 },
      (event) => progress.push(event.completedBytes),
    );
    expect(progress.length).toBeGreaterThan(0);
    for (let i = 1; i < progress.length; i += 1) {
      expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1] ?? 0);
    }
  });

  it('rejects with AbortError and terminates the worker on cancel', async () => {
    const { factory, created } = fakeWorkerFactory();
    const controller = createFileController({ createWorker: factory });
    const pending = controller.run({
      kind: 'encode',
      buffer: new TextEncoder().encode('hello').buffer,
      format: 'standard',
      mode: 'tolerant',
    });
    controller.cancel();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(created[0]?.terminated).toBe(true);
  });

  it('surfaces worker error messages and terminates', async () => {
    const { factory, created } = fakeWorkerFactory('error');
    const controller = createFileController({ createWorker: factory });
    await expect(
      controller.run({ kind: 'encode', buffer: new ArrayBuffer(3), format: 'standard', mode: 'tolerant' }),
    ).rejects.toThrow('worker exploded');
    // A runtime worker error invalidates the worker instance so a later run
    // cannot reuse a poisoned execution context.
    expect(created[0]?.terminated).toBe(true);
  });

  it('propagates decode failures with their codes', async () => {
    const { factory } = fakeWorkerFactory();
    const controller = createFileController({ createWorker: factory });
    const invalid = new TextEncoder().encode('Q=Q=');
    await expect(
      controller.run({ kind: 'decode', buffer: invalid.buffer, format: 'standard', mode: 'strict' }),
    ).rejects.toMatchObject({ code: 'INVALID_PADDING' });
  });

  it('rejects oversized jobs before any worker is created', async () => {
    const { factory, created } = fakeWorkerFactory();
    const controller = createFileController({ createWorker: factory });
    await expect(
      controller.run({ kind: 'encode', buffer: new ArrayBuffer(51 * 1024 * 1024), format: 'standard', mode: 'tolerant' }),
    ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
    expect(created).toHaveLength(0);
  });
});
describe('controller lifecycle settlement (ultrareview batch 3)', () => {
  it('rejects a superseded run instead of leaving it pending forever', async () => {
    const { factory } = fakeWorkerFactory();
    const controller = createFileController({ createWorker: factory });
    const first = controller.run({
      kind: 'encode',
      buffer: new TextEncoder().encode('first').buffer,
      format: 'standard',
      mode: 'tolerant',
    });
    const second = controller.run({
      kind: 'encode',
      buffer: new TextEncoder().encode('second').buffer,
      format: 'standard',
      mode: 'tolerant',
    });
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await expect(second).resolves.toMatchObject({ type: 'result' });
  });

  it('rejects the pending run on dispose so closures do not leak', async () => {
    const { factory } = fakeWorkerFactory();
    const controller = createFileController({ createWorker: factory });
    const pending = controller.run({
      kind: 'encode',
      buffer: new TextEncoder().encode('hello').buffer,
      format: 'standard',
      mode: 'tolerant',
    });
    controller.dispose();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('times out a worker that stops responding and terminates it', async () => {
    vi.useFakeTimers();
    try {
      const { factory, created } = fakeWorkerFactory('silent');
      const controller = createFileController({ createWorker: factory, timeoutMs: 10 });
      const pending = controller.run({
        kind: 'encode',
        buffer: new ArrayBuffer(1),
        format: 'standard',
        mode: 'tolerant',
      });
      const assertion = expect(pending).rejects.toMatchObject({ code: 'WORKER_TIMEOUT' });
      await vi.advanceTimersByTimeAsync(11);
      await assertion;
      expect(created[0]?.terminated).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
