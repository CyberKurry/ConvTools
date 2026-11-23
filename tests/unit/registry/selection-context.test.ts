import { describe, expect, it, vi } from 'vitest';
import {
  collectPageProbe,
  createSelectionContextServices,
} from '../../../core/registry/selection-context';
import { MemoryArea } from '../../../core/storage/browser-storage';
import { PersistenceGuard } from '../../../core/storage/persistence-guard';
import { moduleStorageKey } from '../../../core/storage/module-storage';

function makeDeps(overrides: Partial<Parameters<typeof createSelectionContextServices>[1]> = {}) {
  return {
    tabUrl: 'https://example.com/page' as string | null,
    tabTitle: 'Example title' as string | null,
    probePage: vi.fn().mockResolvedValue({
      url: 'https://example.com/canonical',
      title: 'Probe title',
      description: 'Probe description',
      siteName: 'Example Site',
    }),
    storageArea: new MemoryArea(),
    guard: new PersistenceGuard(false),
    locale: 'en' as const,
    ...overrides,
  };
}

describe('collectPageProbe', () => {
  it('prefers og fields over the meta-description and document-title fallbacks', () => {
    document.head.innerHTML = [
      '<meta name="description" content="Meta description">',
      '<meta property="og:title" content="OG Title">',
      '<meta property="og:description" content="OG description">',
      '<meta property="og:site_name" content="Example Site">',
    ].join('');
    const probe = collectPageProbe();
    expect(probe.title).toBe('OG Title');
    expect(probe.description).toBe('OG description');
    expect(probe.siteName).toBe('Example Site');
    expect(probe.url).toBe(window.location.href);
  });

  it('falls back to meta description and document title when og tags are absent', () => {
    document.head.innerHTML = '<meta name="description" content="Meta description">';
    Object.defineProperty(document, 'title', { value: 'Document title', configurable: true });
    const probe = collectPageProbe();
    expect(probe.title).toBe('Document title');
    expect(probe.description).toBe('Meta description');
    expect(probe.siteName).toBeNull();
  });

  it('returns null fields on a bare page', () => {
    document.head.innerHTML = '';
    Object.defineProperty(document, 'title', { value: '', configurable: true });
    const probe = collectPageProbe();
    expect(probe.title).toBeNull();
    expect(probe.description).toBeNull();
    expect(probe.siteName).toBeNull();
  });
});

describe('createSelectionContextServices', () => {
  it('probes the page lazily and only once per call', async () => {
    const deps = makeDeps();
    const services = createSelectionContextServices('share-card', deps);
    expect(deps.probePage).not.toHaveBeenCalled();
    const meta = await services.page();
    expect(deps.probePage).toHaveBeenCalledTimes(1);
    expect(meta).toEqual({
      url: 'https://example.com/canonical',
      title: 'Probe title',
      description: 'Probe description',
      siteName: 'Example Site',
    });
  });

  it('falls back to tab fields when the probe rejects', async () => {
    const deps = makeDeps({ probePage: vi.fn().mockRejectedValue(new Error('cannot inject')) });
    const services = createSelectionContextServices('share-card', deps);
    await expect(services.page()).resolves.toEqual({
      url: 'https://example.com/page',
      title: 'Example title',
      description: null,
      siteName: null,
    });
  });

  it('falls back to tab fields when the probe times out', async () => {
    const deps = makeDeps({
      probePage: () => new Promise(() => undefined),
      probeTimeoutMs: 10,
    });
    const services = createSelectionContextServices('share-card', deps);
    await expect(services.page()).resolves.toEqual({
      url: 'https://example.com/page',
      title: 'Example title',
      description: null,
      siteName: null,
    });
  });

  it('returns null when neither the probe nor the tab provide anything', async () => {
    const deps = makeDeps({
      tabUrl: null,
      tabTitle: null,
      probePage: vi.fn().mockRejectedValue(new Error('restricted page')),
    });
    const services = createSelectionContextServices('share-card', deps);
    await expect(services.page()).resolves.toBeNull();
  });

  it('stores through kernel-compatible module namespace keys', async () => {
    const deps = makeDeps();
    const services = createSelectionContextServices('share-card', deps);
    await services.storage.set('template', 'paper');
    // Round-trip through the same namespaced view...
    await expect(services.storage.get('template')).resolves.toBe('paper');
    // ...and assert the underlying area holds the exact kernel key layout.
    const stored = await deps.storageArea.get([moduleStorageKey('share-card', 'template')]);
    expect(stored[moduleStorageKey('share-card', 'template')]).toBe('paper');
  });

  it('resolves module messages in the requested language with extension fallback', () => {
    const zh = createSelectionContextServices('base64', makeDeps({ locale: 'zh_CN' as const }));
    expect(zh.i18n.locale).toBe('zh_CN');
    expect(zh.i18n.t('errorInvalidCharacter')).toBe('Base64 输入中存在无效字符。');
    expect(zh.i18n.t('chars', { count: 5 })).toBe('5 字符');
    const en = createSelectionContextServices('base64', makeDeps({ locale: 'en' as const }));
    expect(en.i18n.t('errorInvalidCharacter')).toBe('Invalid character in Base64 input.');
    // Extension-level keys fall through the module dictionary.
    expect(en.i18n.t('common.loading')).toBe('Loading…');
    // Unknown keys surface as the key itself, never as user-facing prose.
    expect(en.i18n.t('totallyUnknownKey')).toBe('totallyUnknownKey');
  });

  it('aborts the signal after the timeout and stays pending before it', () => {
    vi.useFakeTimers();
    try {
      const services = createSelectionContextServices('share-card', makeDeps({ signalTimeoutMs: 50 }));
      expect(services.signal.aborted).toBe(false);
      vi.advanceTimersByTime(60);
      expect(services.signal.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never aborts after dispose', () => {
    vi.useFakeTimers();
    try {
      const services = createSelectionContextServices('share-card', makeDeps({ signalTimeoutMs: 50 }));
      services.dispose();
      vi.advanceTimersByTime(60_000);
      expect(services.signal.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
