import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryArea, type StorageArea } from '../../../core/storage/browser-storage';
import { PersistenceGuard } from '../../../core/storage/persistence-guard';
import { createModuleStorage } from '../../../core/storage/module-storage';
import type { ModuleContext } from '../../../core/module-sdk/context';
import type { CardSpec } from '../worker/protocol';
import { CardSurface } from './CardSurface';
import { createCardController, type CardController, type CardRenderResult } from '../worker/controller';

vi.mock('./CardSurface.module.css', () => ({
  default: new Proxy({}, { get: (_target, key: string) => key }),
}));

const runMock = vi.fn<(job: { card: CardSpec; scale: 1 | 2 }) => Promise<CardRenderResult>>();
const disposeMock = vi.fn();

vi.mock('../worker/controller', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    createCardController: vi.fn(() => ({
      run: runMock,
      cancel: vi.fn(),
      dispose: disposeMock,
    }) satisfies CardController),
  };
});

function contextStub(area: StorageArea): ModuleContext {
  return {
    moduleId: 'share-card',
    storage: createModuleStorage('share-card', area, new PersistenceGuard(false)),
    history: {
      append: vi.fn(() => Promise.resolve()),
      list: vi.fn(() => Promise.resolve([])),
      clear: vi.fn(() => Promise.resolve()),
    },
    i18n: { locale: 'en', t: (key) => key },
    theme: { scheme: 'light' },
    defaultTimezone: null,
    permissions: { request: vi.fn(), contains: vi.fn() },
    network: { request: vi.fn() },
    log: { debug() {}, info() {}, warn() {}, error() {} },
    signal: new AbortController().signal,
  };
}

function makeDoneBuffer(bytes = 8): ArrayBuffer {
  return new ArrayBuffer(bytes);
}

beforeEach(() => {
  runMock.mockReset().mockResolvedValue({ buffer: makeDoneBuffer(), width: 1080, height: 1440, excerptTruncated: false });
  disposeMock.mockReset();
  vi.mocked(createCardController).mockClear();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:preview') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  // jsdom has no ClipboardItem; the component guards on `typeof`.
  vi.stubGlobal('ClipboardItem', class {
    readonly types: readonly string[];
    constructor(public readonly data: Record<string, Blob>) {
      this.types = Object.keys(data);
    }
  });
});

afterEach(() => {
  Reflect.deleteProperty(URL, 'createObjectURL');
  Reflect.deleteProperty(URL, 'revokeObjectURL');
  vi.unstubAllGlobals();
});

function renderSurface(initialInput?: unknown, area: StorageArea = new MemoryArea()) {
  const context = contextStub(area);
  render(<CardSurface context={context} initialInput={initialInput} />);
  return { context };
}

describe('CardSurface', () => {
  it('renders the editor form and an accessible preview canvas', async () => {
    renderSurface();
    expect(screen.getByLabelText('excerpt')).toBeInTheDocument();
    expect(screen.getByLabelText('title')).toBeInTheDocument();
    expect(screen.getByLabelText('summary')).toBeInTheDocument();
    expect(screen.getByLabelText('url')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('img', { name: /previewLabel/ })).toBeInTheDocument());
  });

  it('prefills every field from a versioned input payload', () => {
    renderSurface({
      version: 1,
      excerpt: 'quoted text',
      title: 'Article',
      summary: 'Digest',
      url: 'https://example.com/a',
      siteName: 'Example',
    });
    expect(screen.getByLabelText('excerpt')).toHaveValue('quoted text');
    expect(screen.getByLabelText('title')).toHaveValue('Article');
    expect(screen.getByLabelText('summary')).toHaveValue('Digest');
    expect(screen.getByLabelText('url')).toHaveValue('https://example.com/a');
    expect(screen.getByLabelText('siteName')).toHaveValue('Example');
  });

  it('ignores input payloads with an unknown version', () => {
    renderSurface({ version: 99, excerpt: 'nope' });
    expect(screen.getByLabelText('excerpt')).toHaveValue('');
  });

  it('disables exports with a reason while the excerpt is empty', async () => {
    renderSurface();
    await waitFor(() => expect(screen.getByRole('button', { name: 'copyImage' })).toBeDisabled());
    expect(screen.getByText('exportDisabledEmpty')).toBeInTheDocument();
  });

  it('warns about a non-http url without blocking the other fields', async () => {
    renderSurface({ version: 1, excerpt: 'x', title: null, summary: null, url: null, siteName: null });
    fireEvent.change(screen.getByLabelText('url'), { target: { value: 'javascript:alert(1)' } });
    expect(await screen.findByText('urlInvalid')).toBeInTheDocument();
  });

  it('keeps an empty URL silent while preserving the no-QR render path', async () => {
    renderSurface({ version: 1, excerpt: 'x', title: null, summary: null, url: null, siteName: null });
    await waitFor(() => expect(runMock).toHaveBeenCalledWith(expect.objectContaining({ scale: 1 })));
    expect(screen.queryByText('noUrlNotice')).not.toBeInTheDocument();
  });

  it('uses the URL host when the site name is cleared', async () => {
    renderSurface({ version: 1, excerpt: 'x', title: null, summary: null, url: 'https://example.com/a', siteName: '' });
    await waitFor(() => expect(runMock).toHaveBeenCalled());
    expect(runMock.mock.calls[0]?.[0].card.siteName).toBe('example.com');
  });

  it('always enables the preview after settings reads fail', async () => {
    const failingArea: StorageArea = {
      get: () => Promise.reject(new Error('storage unavailable')),
      set: () => Promise.resolve(),
      remove: () => Promise.resolve(),
      clear: () => Promise.resolve(),
    };
    renderSurface({ version: 1, excerpt: 'ready', title: null, summary: null, url: null, siteName: null }, failingArea);
    await waitFor(() => expect(runMock).toHaveBeenCalledWith(expect.objectContaining({ scale: 1 })));
  });

  it('renders a debounced preview through the worker controller', async () => {
    vi.useFakeTimers();
    try {
      renderSurface();
      fireEvent.change(screen.getByLabelText('excerpt'), { target: { value: '新摘录' } });
      vi.advanceTimersByTime(200);
      await vi.waitFor(() => expect(runMock).toHaveBeenCalledWith(expect.objectContaining({ scale: 1 })));
    } finally {
      vi.useRealTimers();
    }
  });

  it('persists template changes in the module namespace', async () => {
    const area = new MemoryArea();
    renderSurface(undefined, area);
    fireEvent.click(screen.getByRole('radio', { name: 'templateInk' }));
    await waitFor(() =>
      expect(area.snapshot()['module:share-card:template']).toBe('ink'),
    );
  });

  it('copies a rendered png through the clipboard on Ctrl+Enter', async () => {
    const write = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { write },
    });
    renderSurface({ version: 1, excerpt: 'ready', title: null, summary: null, url: null, siteName: null });
    const excerpt = await screen.findByLabelText('excerpt');
    fireEvent.keyDown(excerpt, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('status')).toHaveTextContent('copied');
  });

  it('offers the download as a fallback when the clipboard write fails', async () => {
    const write = vi.fn(() => Promise.reject(new Error('denied')));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { write },
    });
    const clickSpy = vi.fn();
    const originalCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const element = originalCreate(tag);
      if (tag === 'a') {
        element.click = clickSpy;
      }
      return element;
    });
    renderSurface({ version: 1, excerpt: 'ready', title: null, summary: null, url: null, siteName: null });
    fireEvent.click(await screen.findByRole('button', { name: 'copyImage' }));
    await waitFor(() => expect(clickSpy).toHaveBeenCalled());
    vi.restoreAllMocks();
  });

  it('reuses the one export render when clipboard fallback downloads it', async () => {
    const write = vi.fn(() => Promise.reject(new Error('denied')));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write } });
    renderSurface({ version: 1, excerpt: 'ready', title: null, summary: null, url: null, siteName: null });
    fireEvent.click(await screen.findByRole('button', { name: 'copyImage' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('copyFailedDownloaded'));
    expect(runMock.mock.calls.filter((call) => call[0]?.scale === 2)).toHaveLength(1);
  });

  it('uses a textarea for the summary field', () => {
    renderSurface();
    expect(screen.getByLabelText('summary').tagName).toBe('TEXTAREA');
  });

  it('disposes the worker on unmount', async () => {
    const { unmount } = render(<CardSurface context={contextStub(new MemoryArea())} />);
    // The controller is created lazily on the first render job.
    fireEvent.change(screen.getByLabelText('excerpt'), { target: { value: 'trigger' } });
    await waitFor(() => expect(runMock).toHaveBeenCalled());
    unmount();
    expect(disposeMock).toHaveBeenCalled();
  });

  it('boots the shared controller exactly once', async () => {
    renderSurface();
    fireEvent.change(screen.getByLabelText('excerpt'), { target: { value: 'trigger' } });
    await waitFor(() => expect(runMock).toHaveBeenCalled());
    expect(createCardController).toHaveBeenCalledTimes(1);
  });
});
