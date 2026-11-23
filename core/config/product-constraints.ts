/**
 * Immutable product constraints shared by the build configuration and its
 * guard tests. These values mirror the approved specification and must not be
 * changed without updating `docs/superpowers/specs/`.
 */
export const PRODUCT = {
  /** Minimum supported Chromium milestone for Chrome and Edge. */
  minimumChromeVersion: '144',
  /** Chrome/Edge extension manifest generation API. */
  manifestVersion: 3,
  /** The fixed "always-on" permission set for the base extension. */
  fixedPermissions: ['storage', 'contextMenus', 'activeTab', 'scripting'] as const,
  /** Directory that WXT treats as its own build-module root. */
  wxtModulesDir: 'wxt-modules',
  /** Split incognito mode keeps the background context isolated. */
  incognitoMode: 'split',
} as const;

export type FixedPermission = (typeof PRODUCT.fixedPermissions)[number];

/**
 * The extension must never request these permissions or host patterns.
 * `matchPatterns` are matched by exact string against the final manifest.
 */
export const FORBIDDEN_PERMISSIONS = [
  'tabs',
  'clipboardRead',
  'clipboardWrite',
  'unlimitedStorage',
  'webRequest',
  'webRequestBlocking',
  'cookies',
  'history',
  'bookmarks',
] as const;

export const FORBIDDEN_HOST_PATTERNS = ['<all_urls>', '*://*/*', 'http://*/*', 'https://*/*'] as const;