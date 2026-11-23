import { detectIncognito } from './config/environment';
import { createKernel, type Kernel } from './kernel';
import type { BrowserPermissionsApi } from './permissions/types';
import { BrowserStorageArea, type RawBrowserStorageArea } from './storage/browser-area';

/** The browser surface the kernel wiring touches, structural on purpose. */
export interface BrowserKernelHost {
  readonly storage: {
    readonly sync: RawBrowserStorageArea;
    readonly local: RawBrowserStorageArea;
  };
  readonly permissions: BrowserPermissionsApi;
}

/**
 * The browser wiring every visible entrypoint (popup, workbench, options)
 * shares: real storage areas, the permission surface, and the fetch proxy.
 * The injected `browser` global arrives as an argument so this adapter stays
 * independent of the generated global's type surface.
 *
 * The pagehide flush is part of the assembly: settings writes are debounced,
 * so a popup closing inside the debounce window would otherwise drop its
 * last change (spec §9.1 keyboard-only flows included).
 */
export function createBrowserKernel(browser: BrowserKernelHost): Kernel {
  const kernel = createKernel({
    storageSync: new BrowserStorageArea(browser.storage.sync),
    storageLocal: new BrowserStorageArea(browser.storage.local),
    incognito: detectIncognito().incognito,
    permissionsApi: {
      contains: (details) => browser.permissions.contains(details),
      request: (details) => browser.permissions.request(details),
      remove: (details) => browser.permissions.remove(details),
    },
    fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init),
  });
  window.addEventListener('pagehide', () => {
    void kernel.flushSettings();
  });
  return kernel;
}
