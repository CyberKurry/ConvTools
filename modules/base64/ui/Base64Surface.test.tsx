import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModuleContext } from '../../../core/module-sdk/context';
import en from '../locales/en.json';
import { Base64Surface } from './Base64Surface';

// Shrink the input ceiling so the guard is observable without building a
// 50 MB string; the byte math itself is covered in limits.test.ts.
vi.mock('../core/limits', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, exceedsInputLimit: (value: string) => value.length > 8 };
});

afterEach(() => {
  cleanup();
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

describe('Base64Surface', () => {
  it('encodes and decodes text, swaps, and clears', async () => {
    const user = userEvent.setup();
    const context = stubContext();
    render(<Base64Surface context={context} mode="workbench" />);
    const textPanel = within(screen.getByLabelText('Input').closest('section') ?? document.body);
    await user.type(screen.getByLabelText('Input'), 'hello');
    await user.click(textPanel.getByRole('button', { name: 'Encode' }));
    expect(screen.getByLabelText('Output')).toHaveValue('aGVsbG8=');
    await user.click(textPanel.getByRole('button', { name: 'Swap' }));
    expect(screen.getByLabelText('Input')).toHaveValue('aGVsbG8=');
    await user.click(textPanel.getByRole('button', { name: 'Decode' }));
    expect(screen.getByLabelText('Output')).toHaveValue('hello');
    await user.click(textPanel.getByRole('button', { name: 'Clear' }));
    expect(screen.getByLabelText('Input')).toHaveValue('');
    expect(screen.getByLabelText('Output')).toHaveValue('');
  });

  it('shows a correction summary in tolerant mode and rejects invalid strict input', async () => {
    const user = userEvent.setup();
    render(<Base64Surface context={stubContext()} mode="popup" />);
    await user.type(screen.getByLabelText('Input'), 'aGk');
    await user.click(screen.getByRole('button', { name: 'Decode' }));
    expect(screen.getByText(/Corrections/)).toBeInTheDocument();
    await user.click(screen.getByLabelText('Input'));
    await user.clear(screen.getByLabelText('Input'));
    // "aGk " is invalid in strict mode (whitespace). Note: unpadded "aGk"
    // alone is now the canonical URL-safe form and is accepted even in
    // strict mode (encode/decode symmetry, RFC 4648 §5).
    await user.type(screen.getByLabelText('Input'), 'aGk ');
    await user.click(screen.getByRole('checkbox', { name: 'Strict mode' }));
    await user.click(screen.getByRole('button', { name: 'Decode' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('offers file tools only through the workbench in popup mode', () => {
    render(<Base64Surface context={stubContext()} mode="popup" />);
    expect(screen.getByRole('link', { name: 'Open file tools in workbench' })).toBeInTheDocument();
    expect(screen.queryByText('Files')).not.toBeInTheDocument();
  });

  it('rejects a 50 MB-plus file before reading it', async () => {
    const user = userEvent.setup();
    render(<Base64Surface context={stubContext()} mode="workbench" />);
    const input = screen.getByLabelText('Choose file');
    const file = new File([new Uint8Array(1)], 'huge.bin');
    Object.defineProperty(file, 'size', { value: 50 * 1024 * 1024 + 1 });
    await user.upload(input, file);
    expect(screen.getByRole('alert')).toHaveTextContent('File exceeds 50 MB');
  });
});

describe('Base64Surface error and notice handling (ultrareview batch 3)', () => {
  it('maps decode failures to localized messages instead of internal ones', async () => {
    const user = userEvent.setup();
    render(<Base64Surface context={stubContext()} mode="popup" />);
    await user.type(screen.getByLabelText('Input'), '!!!!');
    await user.click(screen.getByRole('button', { name: 'Decode' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid character in Base64 input.');
    expect(screen.getByRole('alert')).not.toHaveTextContent('invalid Base64');
  });

  it('shows a binary notice and skips history when a decode yields no text', async () => {
    const user = userEvent.setup();
    const history = { append: vi.fn(() => Promise.resolve()) };
    render(<Base64Surface context={stubContext(history)} mode="popup" />);
    await user.type(screen.getByLabelText('Input'), '/9j/4AAQ');
    await user.click(screen.getByRole('button', { name: 'Decode' }));
    expect(screen.getByText('Binary output. Download as .bin.')).toBeInTheDocument();
    expect(screen.getByLabelText('Output')).toHaveValue('');
    expect(history.append).not.toHaveBeenCalled();
  });

  it('clears stale errors and corrections when swapping input and output', async () => {
    const user = userEvent.setup();
    render(<Base64Surface context={stubContext()} mode="popup" />);
    await user.type(screen.getByLabelText('Input'), '!!!!');
    await user.click(screen.getByRole('button', { name: 'Decode' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Swap' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('rejects text beyond the shared input ceiling before encoding (L)', async () => {
    const user = userEvent.setup();
    render(<Base64Surface context={stubContext()} mode="popup" />);
    await user.type(screen.getByLabelText('Input'), '0123456789');
    await user.click(screen.getByRole('button', { name: 'Encode' }));
    // Reuses the shared 50 MB copy (approved decision) rather than inventing
    // a second limit message.
    expect(screen.getByRole('alert')).toHaveTextContent('File exceeds 50 MB');
    expect(screen.getByLabelText('Output')).toHaveValue('');
  });

  it('does not record history for an empty encode', async () => {
    const user = userEvent.setup();
    const history = { append: vi.fn(() => Promise.resolve()) };
    render(<Base64Surface context={stubContext(history)} mode="popup" />);
    await user.click(screen.getByRole('button', { name: 'Encode' }));
    expect(history.append).not.toHaveBeenCalled();
  });

  it('keeps a successful text conversion when history storage fails', async () => {
    const user = userEvent.setup();
    const history = { append: vi.fn(() => Promise.reject(new Error('storage unavailable'))) };
    render(<Base64Surface context={stubContext(history)} mode="popup" />);
    await user.type(screen.getByLabelText('Input'), 'hello');
    await user.click(screen.getByRole('button', { name: 'Encode' }));
    expect(screen.getByLabelText('Output')).toHaveValue('aGVsbG8=');
    expect(await screen.findByText('History could not be saved.')).toBeInTheDocument();
  });

  it('ignores a stale history failure after the panel was cleared (M9)', async () => {
    const user = userEvent.setup();
    const pending: Array<{ reject: (error: unknown) => void }> = [];
    const history = {
      append: vi.fn(
        () =>
          new Promise<void>((_resolve, reject) => {
            pending.push({ reject });
          }),
      ),
    };
    render(<Base64Surface context={stubContext(history)} mode="popup" />);
    await user.type(screen.getByLabelText('Input'), 'hello');
    await user.click(screen.getByRole('button', { name: 'Encode' }));
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    pending[0]?.reject(new Error('storage unavailable'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText('History could not be saved.')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Output')).toHaveValue('');
  });
});
