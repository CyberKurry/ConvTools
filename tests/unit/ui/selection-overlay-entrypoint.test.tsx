import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FALLBACK_OVERLAY_LABELS } from '../../../core/registry/overlay-payload';

vi.mock('../../../entrypoints/selection-overlay/SelectionOverlay.module.css?inline', () => ({
  default: '.overlay { position: fixed; z-index: 2147483647; }',
}));

let startOverlay: (() => void) | undefined;

beforeEach(() => {
  startOverlay = undefined;
  vi.stubGlobal('defineUnlistedScript', (callback: () => void) => {
    startOverlay = callback;
    return callback;
  });
});

afterEach(() => {
  document.getElementById('convtools-overlay-root')?.remove();
  delete window.__CONVTOOLS_OVERLAY__;
  delete window.__CONVTOOLS_OVERLAY_ACTIVE__;
  vi.unstubAllGlobals();
});

describe('selection overlay entrypoint', () => {
  it('injects the floating overlay stylesheet into its Shadow DOM', async () => {
    vi.resetModules();
    await import('../../../entrypoints/selection-overlay/index');

    window.__CONVTOOLS_OVERLAY__ = {
      result: 'hello',
      actionLabel: 'decode',
      labels: FALLBACK_OVERLAY_LABELS,
    };
    const callback = startOverlay;
    if (!callback) {
      throw new Error('selection overlay entrypoint did not register');
    }
    callback();

    const root = document.getElementById('convtools-overlay-root');
    const style = root?.shadowRoot?.querySelector('style');
    expect(style?.textContent).toMatch(/position:\s*fixed/);
    expect(style?.textContent).toMatch(/z-index:\s*2147483647/);
  });

  it('honors a manually selected theme and preserves a rapid replacement payload', async () => {
    vi.resetModules();
    await import('../../../entrypoints/selection-overlay/index');
    const callback = startOverlay;
    if (!callback) {
      throw new Error('selection overlay entrypoint did not register');
    }

    window.__CONVTOOLS_OVERLAY__ = {
      result: 'first result',
      actionLabel: 'Decode',
      labels: FALLBACK_OVERLAY_LABELS,
      theme: 'dark',
    };
    callback();
    const first = document.getElementById('convtools-overlay-root');
    expect(first?.dataset.theme).toBe('dark');

    window.__CONVTOOLS_OVERLAY__ = {
      result: 'second result',
      actionLabel: 'Decode',
      labels: FALLBACK_OVERLAY_LABELS,
      theme: 'light',
    };
    callback();
    await vi.waitFor(() => {
      expect(document.getElementById('convtools-overlay-root')?.shadowRoot).toHaveTextContent('second result');
    });
    expect(document.getElementById('convtools-overlay-root')?.dataset.theme).toBe('light');
  });

  it('removes the host, clears the active global, and unloads its listeners on close', async () => {
    vi.resetModules();
    await import('../../../entrypoints/selection-overlay/index');
    window.__CONVTOOLS_OVERLAY__ = {
      result: 'hello',
      actionLabel: 'decode',
      labels: FALLBACK_OVERLAY_LABELS,
    };
    const callback = startOverlay;
    if (!callback) {
      throw new Error('selection overlay entrypoint did not register');
    }
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    callback();
    await vi.waitFor(() => {
      expect(document.getElementById('convtools-overlay-root')?.shadowRoot).toHaveTextContent('hello');
    });
    const registered = addSpy.mock.calls
      .filter(([type]) => type === 'keydown' || type === 'pointerdown')
      .map(([type, , options]) => [type, options] as const);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await vi.waitFor(() => {
      expect(document.getElementById('convtools-overlay-root')).toBeNull();
    });
    expect(window.__CONVTOOLS_OVERLAY_ACTIVE__).toBeUndefined();
    for (const [type, options] of registered) {
      expect(removeSpy).toHaveBeenCalledWith(type, expect.any(Function), options);
    }
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it('tears down the injected host when the overlay render throws (M7)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      vi.resetModules();
      vi.doMock('../../../entrypoints/selection-overlay/SelectionOverlay', () => ({
        SelectionOverlay: (): never => {
          throw new Error('overlay render exploded');
        },
      }));
      await import('../../../entrypoints/selection-overlay/index');
      window.__CONVTOOLS_OVERLAY__ = {
        result: 'hello',
        actionLabel: 'decode',
          labels: FALLBACK_OVERLAY_LABELS,
      };
      const callback = startOverlay;
      if (!callback) {
        throw new Error('selection overlay entrypoint did not register');
      }
      callback();
      // Without an uncaught-error hook the Shadow DOM host would survive the
      // crash with no Escape handling and no way to dismiss it.
      await vi.waitFor(() => {
        expect(document.getElementById('convtools-overlay-root')).toBeNull();
      });
      expect(window.__CONVTOOLS_OVERLAY_ACTIVE__).toBeUndefined();
    } finally {
      vi.doUnmock('../../../entrypoints/selection-overlay/SelectionOverlay');
      errorSpy.mockRestore();
    }
  });
});
