import { describe, expect, it, vi } from 'vitest';
import { createCardController, type CardWorkerHandle } from './controller';
import type { CardSpec, CardWorkerMessage, CardWorkerRequest } from './protocol';

function spec(): CardSpec {
  return {
    excerpt: '摘录',
    title: '标题',
    summary: null,
    url: 'https://example.com/a',
    siteName: 'Example',
    templateId: 'paper',
    sizeId: 'portrait',
    dateIso: '2026-09-07',
    locale: 'zh_CN',
    watermarkText: 'W',
    qrHint: '扫码',
  };
}

interface FakeHandle extends CardWorkerHandle {
  emit(message: CardWorkerMessage): void;
  fail(message: string): void;
  requests: CardWorkerRequest[];
  terminated: boolean;
  messageListener: ((event: { data: CardWorkerMessage }) => void) | null;
  errorListener: ((event: { message?: string }) => void) | null;
}

function fakeHandle(): FakeHandle {
  const handle: FakeHandle = {
    requests: [],
    terminated: false,
    messageListener: null,
    errorListener: null,
    postMessage(request: CardWorkerRequest) {
      handle.requests.push(request);
    },
    terminate() {
      handle.terminated = true;
      handle.messageListener = null;
    },
    addEventListener(type: 'message' | 'error', listener: (event: never) => void) {
      if (type === 'message') {
        handle.messageListener = listener as (event: { data: CardWorkerMessage }) => void;
      } else {
        handle.errorListener = listener as (event: { message?: string }) => void;
      }
    },
    removeEventListener(type: 'message' | 'error') {
      if (type === 'message') {
        handle.messageListener = null;
      } else {
        handle.errorListener = null;
      }
    },
    emit(message: CardWorkerMessage) {
      handle.messageListener?.({ data: message });
    },
    fail(message: string) {
      handle.errorListener?.({ message });
    },
  };
  return handle;
}

function doneFor(request: CardWorkerRequest | undefined, bytes = 8): CardWorkerMessage {
  if (!request) {
    throw new Error('request missing');
  }
  return { type: 'done', id: request.id, buffer: new ArrayBuffer(bytes), width: 2160, height: 2880, excerptTruncated: false };
}

describe('createCardController', () => {
  it('pairs done results by request id and resolves with the buffer', async () => {
    const handle = fakeHandle();
    const controller = createCardController({ createWorker: () => handle });
    const promise = controller.run({ card: spec(), scale: 2 });
    handle.emit(doneFor(handle.requests[0]));
    await expect(promise).resolves.toMatchObject({ width: 2160, height: 2880, excerptTruncated: false });
    controller.dispose();
  });

  it('drops stale ids instead of settling the wrong job', async () => {
    const handle = fakeHandle();
    const controller = createCardController({ createWorker: () => handle });
    const promise = controller.run({ card: spec(), scale: 1 });
    // A late message for an unknown id must be ignored entirely.
    handle.emit({ type: 'done', id: 999, buffer: new ArrayBuffer(1), width: 1, height: 1, excerptTruncated: false });
    handle.emit({
      type: 'done',
      id: handle.requests[0]?.id ?? 0,
      buffer: new ArrayBuffer(4),
      width: 2160,
      height: 2880,
      excerptTruncated: true,
    });
    await expect(promise).resolves.toMatchObject({ width: 2160, excerptTruncated: true });
    controller.dispose();
  });

  it('keeps only one active job and terminates the superseded worker', async () => {
    const created: FakeHandle[] = [];
    const controller = createCardController({
      createWorker: () => {
        const handle = fakeHandle();
        created.push(handle);
        return handle;
      },
    });
    const first = controller.run({ card: spec(), scale: 2 });
    const second = controller.run({ card: spec(), scale: 1 });

    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    expect(created[0]?.terminated).toBe(true);
    expect(created).toHaveLength(2);
    created[1]?.emit(doneFor(created[1]?.requests[0]));
    await expect(second).resolves.toMatchObject({ width: 2160 });
    controller.dispose();
  });

  it('surfaces structured worker errors with their code', async () => {
    const handle = fakeHandle();
    const controller = createCardController({ createWorker: () => handle });
    const promise = controller.run({ card: spec(), scale: 1 });
    handle.emit({ type: 'error', id: handle.requests[0]?.id ?? 0, code: 'CRASH', message: 'layout exploded' });
    await expect(promise).rejects.toMatchObject({ code: 'CRASH' });
    controller.dispose();
  });

  it('cancel rejects every in-flight job and the controller keeps working', async () => {
    const handle = fakeHandle();
    const controller = createCardController({ createWorker: () => handle });
    const running = controller.run({ card: spec(), scale: 1 });
    const second = controller.run({ card: spec(), scale: 2 });
    controller.cancel();
    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    await expect(second).rejects.toMatchObject({ name: 'AbortError' });
    expect(handle.terminated).toBe(true);

    // The controller keeps working after a cancel.
    const after = controller.run({ card: spec(), scale: 1 });
    handle.emit(doneFor(handle.requests.at(-1)));
    await expect(after).resolves.toMatchObject({ width: 2160 });
    controller.dispose();
  });

  it('dispose terminates the worker and fails every pending job', async () => {
    const handle = fakeHandle();
    const controller = createCardController({ createWorker: () => handle });
    const running = controller.run({ card: spec(), scale: 1 });
    const queued = controller.run({ card: spec(), scale: 1 });
    controller.dispose();
    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    await expect(queued).rejects.toMatchObject({ name: 'AbortError' });
    expect(handle.terminated).toBe(true);
  });

  it('rejects runs after dispose', async () => {
    const handle = fakeHandle();
    const controller = createCardController({ createWorker: () => handle });
    controller.dispose();
    await expect(controller.run({ card: spec(), scale: 1 })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('survives a worker crash and recovers on the next run', async () => {
    const created: FakeHandle[] = [];
    const controller = createCardController({
      createWorker: () => {
        const handle = fakeHandle();
        created.push(handle);
        return handle;
      },
    });
    const first = controller.run({ card: spec(), scale: 1 });
    created[0]?.fail('worker exploded');
    await expect(first).rejects.toMatchObject({ message: 'worker exploded' });
    expect(created[0]?.terminated).toBe(true);

    const second = controller.run({ card: spec(), scale: 1 });
    created[1]?.emit(doneFor(created[1]?.requests.at(-1)));
    await expect(second).resolves.toMatchObject({ width: 2160 });
    controller.dispose();
  });

  it('keeps one lazy worker alive across runs', async () => {
    const created: FakeHandle[] = [];
    const controller = createCardController({
      createWorker: () => {
        const handle = fakeHandle();
        created.push(handle);
        return handle;
      },
    });
    const first = controller.run({ card: spec(), scale: 1 });
    created[0]?.emit(doneFor(created[0]?.requests[0]));
    await first;
    const second = controller.run({ card: spec(), scale: 1 });
    created[0]?.emit(doneFor(created[0]?.requests[1]));
    await second;
    expect(created).toHaveLength(1);
    controller.dispose();
  });

  it('times out a non-responsive worker and resets it for the next run', async () => {
    vi.useFakeTimers();
    try {
      const created: FakeHandle[] = [];
      const controller = createCardController({
        createWorker: () => {
          const handle = fakeHandle();
          created.push(handle);
          return handle;
        },
        timeoutMs: 10,
      });
      const pending = controller.run({ card: spec(), scale: 1 });
      const assertion = expect(pending).rejects.toMatchObject({ code: 'WORKER_TIMEOUT' });
      await vi.advanceTimersByTimeAsync(11);
      await assertion;
      expect(created[0]?.terminated).toBe(true);
      controller.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
