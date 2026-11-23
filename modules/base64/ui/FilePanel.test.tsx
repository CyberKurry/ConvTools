import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModuleContext } from '../../../core/module-sdk/context';
import en from '../locales/en.json';
import type { ProcessFileResult } from '../worker/process-file';
import type { FileController } from '../worker/controller';
import type { FileJobRequest } from '../worker/protocol';
import type * as importType from '../worker/controller';
import { FilePanel } from './FilePanel';

const state: { result: ProcessFileResult | null; error: Error | null; lastJob: FileJobRequest | null } = {
  result: null,
  error: null,
  lastJob: null,
};
const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

vi.mock('../worker/controller', async (importOriginal) => {
  const original = await importOriginal<typeof importType>();
  return {
    ...original,
    createFileController: (): FileController => ({
    run: (job) => {
      state.lastJob = job;
      return state.error ? Promise.reject(state.error) : Promise.resolve(state.result as ProcessFileResult);
    },
      cancel: () => undefined,
      dispose: () => undefined,
    }),
  };
});

function makeResult(overrides: (Partial<ProcessFileResult> & { chunksText?: string }) = {}): ProcessFileResult {
  const chunk = new TextEncoder().encode(overrides.chunksText ?? 'abc').buffer;
  return {
    chunks: [chunk],
    mime: 'text/plain',
    textPreview: 'abc',
    textPreviewComplete: true,
    corrections: [],
    maxWorkingChunkBytes: 256,
    completedBytes: 3,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  state.result = null;
  state.error = null;
  state.lastJob = null;
  if (originalClipboardDescriptor) {
    Object.defineProperty(navigator, 'clipboard', originalClipboardDescriptor);
  } else {
    Reflect.deleteProperty(navigator, 'clipboard');
  }
  vi.unstubAllGlobals();
});

function stubContext(history = { append: vi.fn(() => Promise.resolve()) }): ModuleContext {
  return {
    moduleId: 'base64',
    storage: {
      get: () => Promise.resolve(undefined),
      set: () => Promise.resolve(),
      remove: () => Promise.resolve(),
      clear: () => Promise.resolve(),
    },
    history: {
      append: history.append,
      list: () => Promise.resolve([]),
      clear: () => Promise.resolve(),
    },
    i18n: {
      t: (key) => (en as Record<string, string>)[key] ?? key,
      locale: 'en',
    },
    theme: { scheme: 'light' },
    defaultTimezone: null,
    permissions: { request: () => Promise.resolve(false), contains: () => Promise.resolve(false) },
    network: { request: () => Promise.resolve(undefined) },
    log: { debug() {}, info() {}, warn() {}, error() {} },
    signal: new AbortController().signal,
  };
}

async function uploadFile(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  const input = screen.getByLabelText('Choose file');
  const file = new File([new Uint8Array([1, 2, 3])], 'sample.bin', { type: 'image/png' });
  await user.upload(input, file);
}

describe('FilePanel copy and notices (ultrareview batch 3)', () => {
  it('gives an explicit fallback when Blob clipboard writes are unavailable', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    state.result = makeResult({ chunksText: 'abcdef', textPreview: 'abc', textPreviewComplete: false });
    render(<FilePanel context={stubContext()} />);
    await uploadFile(user);
    const copy = await screen.findByRole('button', { name: 'Copy' });
    await user.click(copy);
    expect(writeText).not.toHaveBeenCalled();
    expect(await screen.findByText('Select the result and copy it manually.')).toBeInTheDocument();
  });

  it('shows a truncation notice when the preview is only a sample', async () => {
    const user = userEvent.setup();
    state.result = makeResult({ textPreview: 'abc', textPreviewComplete: false });
    render(<FilePanel context={stubContext()} />);
    await uploadFile(user);
    expect(await screen.findByText(/shown as a preview/)).toBeInTheDocument();
  });

  it('reports cancellation as a neutral notice, not an error alert', async () => {
    const user = userEvent.setup();
    state.error = new DOMException('The operation was aborted.', 'AbortError');
    render(<FilePanel context={stubContext()} />);
    await uploadFile(user);
    expect(await screen.findByText('Cancel')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('passes the source MIME to Data URL encoding', async () => {
    const user = userEvent.setup();
    state.result = makeResult();
    render(<FilePanel context={stubContext()} />);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Format' }), 'data-url');
    await uploadFile(user);
    expect(state.lastJob?.mime).toBe('image/png');
  });

  it('does not offer the URL-safe format for file encoding', () => {
    // Spec 11.2 defines file encode output as standard Base64 or Data URL
    // only; the worker never implemented a URL alphabet for files.
    render(<FilePanel context={stubContext()} />);
    const options = Array.from(screen.getByRole('combobox', { name: 'Format' }).querySelectorAll('option'));
    expect(options.map((option) => option.value)).toEqual(['standard', 'data-url']);
  });

  it('names a Data URL decode download after the declared MIME', async () => {
    const user = userEvent.setup();
    state.result = makeResult({ mime: 'image/png', textPreview: null });
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    let downloadedName = '';
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloadedName = this.download;
    });
    render(<FilePanel context={stubContext()} />);
    await user.click(screen.getByRole('button', { name: 'Decode' }));
    await uploadFile(user);
    await user.click(screen.getByRole('button', { name: 'Download' }));
    expect(downloadedName).toBe('download.png');
    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
    click.mockRestore();
  });

  it('keeps the completed result kind when the action selector changes before download', async () => {
    const user = userEvent.setup();
    state.result = makeResult();
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    let downloadedName = '';
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloadedName = this.download;
    });
    render(<FilePanel context={stubContext()} />);
    await uploadFile(user);
    await user.click(screen.getByRole('button', { name: 'Decode' }));
    await user.click(screen.getByRole('button', { name: 'Download' }));
    expect(downloadedName).toBe('download.txt');
    expect(createObjectURL).toHaveBeenCalled();
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalled());
    click.mockRestore();
    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
  });

  it('uses a Blob clipboard item without rebuilding the complete output string', async () => {
    const user = userEvent.setup();
    const write = vi.fn((_items: readonly unknown[]) => Promise.resolve());
    class ClipboardItemStub {
      readonly items: Record<string, Blob>;
      constructor(items: Record<string, Blob>) {
        this.items = items;
      }
    }
    vi.stubGlobal('ClipboardItem', ClipboardItemStub);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write } });
    state.result = makeResult({ chunksText: 'abcdef' });
    render(<FilePanel context={stubContext()} />);
    await uploadFile(user);
    await user.click(await screen.findByRole('button', { name: 'Copy' }));
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[0]?.[0]).toBeInstanceOf(ClipboardItemStub);
  });

  it('shows a history warning without turning a successful conversion into an error', async () => {
    const user = userEvent.setup();
    state.result = makeResult();
    const history = { append: vi.fn(() => Promise.reject(new Error('storage unavailable'))) };
    render(<FilePanel context={stubContext(history)} />);
    await uploadFile(user);
    expect(await screen.findByRole('status')).toHaveTextContent('History could not be saved');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('abc')).toBeInTheDocument();
  });

  it('resets the file input so the same file can be chosen again (L)', async () => {
    const user = userEvent.setup();
    state.result = makeResult();
    render(<FilePanel context={stubContext()} />);
    await uploadFile(user);
    const input = screen.getByLabelText<HTMLInputElement>('Choose file');
    // Browsers only fire `change` when the value actually changes; leaving the
    // previous path in place makes re-picking the same file a no-op.
    expect(input.value).toBe('');
  });

  it('releases the retained result buffers when the output is dismissed (L)', async () => {
    const user = userEvent.setup();
    state.result = makeResult();
    render(<FilePanel context={stubContext()} />);
    await uploadFile(user);
    expect(await screen.findByRole('button', { name: 'Download' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear result' }));
    // The result card (and with it the up-to-66 MB chunk array) is gone
    // without waiting for the next file or a page unload.
    expect(screen.queryByRole('button', { name: 'Download' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Output')).not.toBeInTheDocument();
  });

  it('ignores a stale history failure once a newer run has started (M9)', async () => {
    const user = userEvent.setup();
    state.result = makeResult();
    const pending: Array<{ reject: (error: unknown) => void }> = [];
    const history = {
      append: vi.fn(
        () =>
          new Promise<void>((_resolve, reject) => {
            pending.push({ reject });
          }),
      ),
    };
    render(<FilePanel context={stubContext(history)} />);
    await uploadFile(user);
    await waitFor(() => expect(history.append).toHaveBeenCalledTimes(1));
    await uploadFile(user);
    await waitFor(() => expect(history.append).toHaveBeenCalledTimes(2));
    // The first run's history write fails after the second run already reset
    // the panel; its notice must not surface over the current run.
    pending[0]?.reject(new Error('storage unavailable'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText('History could not be saved.')).not.toBeInTheDocument();
    pending[1]?.reject(new Error('storage unavailable'));
    expect(await screen.findByText('History could not be saved.')).toBeInTheDocument();
  });
});
