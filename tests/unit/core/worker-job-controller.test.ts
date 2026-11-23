import { describe, expect, it, vi } from 'vitest';
import { createWorkerJobController, type WorkerJobHandle } from '../../../core/worker/job-controller';

type Request = { readonly id: number; readonly job: string };
type Message =
  | { readonly type: 'progress'; readonly done: number }
  | { readonly type: 'done'; readonly id: number; readonly value: string }
  | { readonly type: 'error'; readonly id: number; readonly code: string; readonly message: string };

const JOB_TIMEOUT = 'job timed out';

class FakeWorker implements WorkerJobHandle<Request, Message> {
  readonly requests: Request[] = [];
  readonly transfers: (ArrayBuffer[] | undefined)[] = [];
  terminated = false;
  private messageListener: ((event: { data: Message }) => void) | null = null;
  private errorListener: ((event: { message?: string }) => void) | null = null;

  postMessage(message: Request, transfer?: ArrayBuffer[]): void {
    this.requests.push(message);
    this.transfers.push(transfer);
  }

  terminate(): void {
    this.terminated = true;
  }

  addEventListener(type: 'message' | 'error', listener: never): void {
    if (type === 'message') {
      this.messageListener = listener;
    } else {
      this.errorListener = listener;
    }
  }

  removeEventListener(type: 'message' | 'error'): void {
    if (type === 'message') {
      this.messageListener = null;
    } else {
      this.errorListener = null;
    }
  }

  emit(message: Message): void {
    this.messageListener?.({ data: message });
  }

  crash(message = 'worker exploded'): void {
    this.errorListener?.({ message });
  }
}

function harness(options: { lifetime: 'per-job' | 'persistent'; timeoutMs?: number } = { lifetime: 'per-job' }) {
  const created: FakeWorker[] = [];
  const controller = createWorkerJobController<{ job: string }, Request, Message, string, number>({
    createWorker: () => {
      const worker = new FakeWorker();
      created.push(worker);
      return worker;
    },
    lifetime: options.lifetime,
    timeoutMessage: JOB_TIMEOUT,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    toRequest: (job, id) => ({ id, job: job.job }),
    idOf: (message) => (message.type === 'progress' ? undefined : message.id),
    interpret: (message) => {
      if (message.type === 'progress') {
        return { kind: 'progress' as const, progress: message.done };
      }
      if (message.type === 'done') {
        return { kind: 'result' as const, result: message.value };
      }
      return { kind: 'error' as const, code: message.code, message: message.message };
    },
  });
  return { controller, created };
}

describe('worker job controller', () => {
  it('correlates the response by request id and resolves the result', async () => {
    const { controller, created } = harness();
    const pending = controller.run({ job: 'a' });
    const worker = created[0];
    expect(worker?.requests[0]).toMatchObject({ job: 'a' });
    worker?.emit({ type: 'done', id: worker.requests[0]?.id ?? -1, value: 'ok' });
    await expect(pending).resolves.toBe('ok');
  });

  it('ignores responses for a stale request id', async () => {
    const { controller, created } = harness();
    const pending = controller.run({ job: 'a' });
    created[0]?.emit({ type: 'done', id: 999, value: 'stale' });
    created[0]?.emit({ type: 'done', id: created[0]?.requests[0]?.id ?? -1, value: 'fresh' });
    await expect(pending).resolves.toBe('fresh');
  });

  it('routes progress messages to the per-run callback', async () => {
    const { controller, created } = harness();
    const progress: number[] = [];
    const pending = controller.run({ job: 'a' }, (value) => progress.push(value));
    const worker = created[0];
    worker?.emit({ type: 'progress', done: 1 });
    worker?.emit({ type: 'progress', done: 2 });
    worker?.emit({ type: 'done', id: worker.requests[0]?.id ?? -1, value: 'ok' });
    await pending;
    expect(progress).toEqual([1, 2]);
  });

  it('forwards the transfer list', async () => {
    const created: FakeWorker[] = [];
    const controller = createWorkerJobController<{ buffer: ArrayBuffer }, Request, Message, string, never>({
      createWorker: () => {
        const worker = new FakeWorker();
        created.push(worker);
        return worker;
      },
      lifetime: 'per-job',
      toRequest: (_job, id) => ({ id, job: 'transfer' }),
      transfer: (job) => [job.buffer],
      interpret: (message): { kind: 'result'; result: string } => ({ kind: 'result', result: message.type }),
    });
    const buffer = new ArrayBuffer(4);
    const pending = controller.run({ buffer });
    expect(created[0]?.transfers[0]).toEqual([buffer]);
    created[0]?.emit({ type: 'done', id: created[0].requests[0]?.id ?? 0, value: 'ok' });
    await pending;
  });

  it('terminates the worker once a per-job run settles', async () => {
    const { controller, created } = harness({ lifetime: 'per-job' });
    const first = controller.run({ job: 'a' });
    created[0]?.emit({ type: 'done', id: created[0].requests[0]?.id ?? -1, value: 'one' });
    await first;
    expect(created[0]?.terminated).toBe(true);

    const second = controller.run({ job: 'b' });
    expect(created).toHaveLength(2);
    created[1]?.emit({ type: 'done', id: created[1].requests[0]?.id ?? -1, value: 'two' });
    await expect(second).resolves.toBe('two');
  });

  it('reuses one worker across runs in persistent mode', async () => {
    const { controller, created } = harness({ lifetime: 'persistent' });
    const first = controller.run({ job: 'a' });
    created[0]?.emit({ type: 'done', id: created[0].requests[0]?.id ?? -1, value: 'one' });
    await first;
    expect(created[0]?.terminated).toBe(false);

    const second = controller.run({ job: 'b' });
    expect(created).toHaveLength(1);
    created[0]?.emit({ type: 'done', id: created[0].requests[1]?.id ?? -1, value: 'two' });
    await expect(second).resolves.toBe('two');
  });

  it('keeps a persistent worker after a protocol-level error but drops a per-job one', async () => {
    const persistent = harness({ lifetime: 'persistent' });
    const first = persistent.controller.run({ job: 'a' });
    const worker = persistent.created[0];
    worker?.emit({ type: 'error', id: worker.requests[0]?.id ?? -1, code: 'BAD_INPUT', message: 'nope' });
    await expect(first).rejects.toMatchObject({ code: 'BAD_INPUT', message: 'nope' });
    expect(worker?.terminated).toBe(false);

    const ephemeral = harness({ lifetime: 'per-job' });
    const run = ephemeral.controller.run({ job: 'a' });
    const once = ephemeral.created[0];
    once?.emit({ type: 'error', id: once.requests[0]?.id ?? -1, code: 'BAD_INPUT', message: 'nope' });
    await expect(run).rejects.toMatchObject({ code: 'BAD_INPUT' });
    expect(once?.terminated).toBe(true);
  });

  it('rejects a superseded run and starts the new one on a fresh worker', async () => {
    const { controller, created } = harness({ lifetime: 'persistent' });
    const first = controller.run({ job: 'a' });
    const second = controller.run({ job: 'b' });
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    expect(created[0]?.terminated).toBe(true);
    expect(created).toHaveLength(2);
    created[1]?.emit({ type: 'done', id: created[1].requests[0]?.id ?? -1, value: 'two' });
    await expect(second).resolves.toBe('two');
  });

  it('rejects and terminates on a worker crash', async () => {
    const { controller, created } = harness({ lifetime: 'persistent' });
    const pending = controller.run({ job: 'a' });
    created[0]?.crash('boom');
    await expect(pending).rejects.toThrow('boom');
    expect(created[0]?.terminated).toBe(true);

    const next = controller.run({ job: 'b' });
    expect(created).toHaveLength(2);
    created[1]?.emit({ type: 'done', id: created[1].requests[0]?.id ?? -1, value: 'recovered' });
    await expect(next).resolves.toBe('recovered');
  });

  it('rejects with WORKER_TIMEOUT and terminates a silent worker', async () => {
    vi.useFakeTimers();
    try {
      const { controller, created } = harness({ lifetime: 'persistent', timeoutMs: 10 });
      const pending = controller.run({ job: 'a' });
      const assertion = expect(pending).rejects.toMatchObject({ code: 'WORKER_TIMEOUT', message: JOB_TIMEOUT });
      await vi.advanceTimersByTimeAsync(11);
      await assertion;
      expect(created[0]?.terminated).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects the pending run and later runs after dispose', async () => {
    const { controller, created } = harness({ lifetime: 'persistent' });
    const pending = controller.run({ job: 'a' });
    controller.dispose();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(created[0]?.terminated).toBe(true);
    await expect(controller.run({ job: 'b' })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects a postMessage that throws and terminates that worker', async () => {
    const created: FakeWorker[] = [];
    const controller = createWorkerJobController<{ job: string }, Request, Message, string, never>({
      createWorker: () => {
        const worker = new FakeWorker();
        worker.postMessage = () => {
          throw new Error('clone failed');
        };
        created.push(worker);
        return worker;
      },
      lifetime: 'persistent',
      toRequest: (_job, id) => ({ id, job: 'x' }),
      interpret: (message) => ({ kind: 'result', result: message.type }),
    });
    await expect(controller.run({ job: 'a' })).rejects.toThrow('clone failed');
    expect(created[0]?.terminated).toBe(true);
  });

  it('rejects an invalid timeout instead of arming a broken timer', () => {
    expect(() =>
      createWorkerJobController<{ job: string }, Request, Message, string, never>({
        createWorker: () => new FakeWorker(),
        lifetime: 'per-job',
        timeoutMs: 0,
        toRequest: (_job, id) => ({ id, job: 'x' }),
        interpret: (message) => ({ kind: 'result', result: message.type }),
      }),
    ).toThrow(/timeout/);
  });
});
