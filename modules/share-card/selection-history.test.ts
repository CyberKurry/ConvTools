import { describe, expect, it, vi } from 'vitest';
import type { NamespacedHistory } from '../../core/module-sdk/context';
import type { SelectionActionContext, SelectionPageMeta } from '../../core/module-sdk/runtime';
import { MemoryArea } from '../../core/storage/browser-storage';
import { PersistenceGuard } from '../../core/storage/persistence-guard';
import { createModuleStorage } from '../../core/storage/module-storage';
import { appendCardHistory } from './history';
import definition from './index';

const generate = definition.surfaces.selectionActions.find((action) => action.id === 'generate');

function contextStub(history: ReturnType<typeof historyStub>, page: () => Promise<SelectionPageMeta | null> = () => Promise.resolve(null)): SelectionActionContext {
  return {
    history,
    storage: createModuleStorage('share-card', new MemoryArea(), new PersistenceGuard(false)),
    i18n: { locale: 'en', t: (key) => key },
    defaultTimezone: null,
    signal: new AbortController().signal,
    page,
  };
}

function historyStub() {
  return {
    append: vi.fn(() => Promise.resolve()),
    list: vi.fn(() => Promise.resolve([])),
    clear: vi.fn(() => Promise.resolve()),
  } satisfies NamespacedHistory & Record<string, ReturnType<typeof vi.fn>>;
}

describe('share-card generate selection action', () => {
  it('hands the normalized input to the workbench instead of rendering', async () => {
    if (!generate) {
      throw new Error('generate selection action missing');
    }
    const page = vi.fn().mockResolvedValue({
      url: 'https://example.com/article?utm=x',
      title: 'Article title',
      description: 'Short digest',
      siteName: null,
    });
    const history = historyStub();
    const context = contextStub(history, page);

    const result = await generate.run('  quoted   words  ', context);

    expect(result).toEqual({
      kind: 'workbench-input',
      data: {
        version: 1,
        excerpt: 'quoted words',
        title: 'Article title',
        summary: 'Short digest',
        url: 'https://example.com/article?utm=x',
        siteName: 'example.com',
      },
    });
    // Rendering and history live on the workbench side, not in the action.
    expect(page).toHaveBeenCalledTimes(1);
  });

  it('hands empty metadata when the page cannot be probed', async () => {
    if (!generate) {
      throw new Error('generate selection action missing');
    }
    const context = contextStub(historyStub());

    const result = await generate.run('solo', context);

    expect(result).toEqual({
      kind: 'workbench-input',
      data: {
        version: 1,
        excerpt: 'solo',
        title: null,
        summary: null,
        url: null,
        siteName: null,
      },
    });
  });

  it('never writes history from the action itself', async () => {
    if (!generate) {
      throw new Error('generate selection action missing');
    }
    const history = historyStub();
    const context = contextStub(history);

    await generate.run('solo', context);
    expect(history.append).not.toHaveBeenCalled();
  });
});

describe('appendCardHistory', () => {
  it('appends a file metadata record with the source url', async () => {
    const history = historyStub();
    await appendCardHistory(history, {
      template: 'paper',
      sizeId: 'portrait',
      bytes: 1234,
      sourceUrl: 'https://example.com/a',
    });
    expect(history.append).toHaveBeenCalledWith({
      kind: 'file',
      action: 'generate',
      name: 'share-card-paper-2160x2880.png',
      size: 1234,
      mime: 'image/png',
      sourceUrl: 'https://example.com/a',
    });
  });

  it('omits the source url when the card had none', async () => {
    const history = historyStub();
    await appendCardHistory(history, {
      template: 'ink',
      sizeId: 'square',
      bytes: 2048,
      sourceUrl: null,
    });
    expect(history.append).toHaveBeenCalledWith({
      kind: 'file',
      action: 'generate',
      name: 'share-card-ink-2160x2160.png',
      size: 2048,
      mime: 'image/png',
    });
  });

  it('swallows history write failures so exports never break', async () => {
    const failing = {
      append: vi.fn(() => Promise.reject(new Error('quota'))),
      list: vi.fn(() => Promise.resolve([])),
      clear: vi.fn(() => Promise.resolve()),
    } as unknown as NamespacedHistory;
    await expect(
      appendCardHistory(failing, { template: 'paper', sizeId: 'portrait', bytes: 1, sourceUrl: null }),
    ).resolves.toBeUndefined();
  });
});
