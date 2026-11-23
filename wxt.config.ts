import { defineConfig } from 'wxt';
import { PRODUCT } from './core/config/product-constraints';
import { optionalHostPermissions, optionalPermissions } from './generated/module-manifest';

const generatedOptionalPermissions =
  optionalPermissions.length > 0 ? { optional_permissions: [...optionalPermissions] } : {};
const generatedOptionalHostPermissions =
  optionalHostPermissions.length > 0 ? { optional_host_permissions: [...optionalHostPermissions] } : {};
const baseManifest = {
  name: 'ConvTools',
  description: 'Local-first base64 and timestamp conversion tools',
  minimum_chrome_version: PRODUCT.minimumChromeVersion,
  incognito: PRODUCT.incognitoMode,
  permissions: [...PRODUCT.fixedPermissions],
  ...generatedOptionalPermissions,
  ...generatedOptionalHostPermissions,
  action: {
    default_title: 'ConvTools',
  },
  commands: {
    _execute_action: {
      suggested_key: { default: 'Alt+Shift+C' },
      description: 'Open the ConvTools quick popup',
    },
  },
  icons: {
    16: '/icon/16.png',
    32: '/icon/32.png',
    48: '/icon/48.png',
    128: '/icon/128.png',
  },
  background: {
    service_worker: 'background.js',
    type: 'module',
  },
} as const;

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  modulesDir: PRODUCT.wxtModulesDir,
  manifestVersion: PRODUCT.manifestVersion,
  srcDir: '.',
  manifest: ({ mode }) => ({
    ...baseManifest,
    // The test-only local origin lets Chromium exercise real scripting and
    // Shadow-DOM injection against an HTTP fixture. It is absent from stable
    // Chrome/Edge builds and is never an optional product permission.
    ...(mode === 'test' ? { host_permissions: ['http://127.0.0.1/*'] } : {}),
  }),
  vite: () => ({
    build: {
      // No modulepreload links in extension pages: Chromium logs each one as
      // a cross-world resource mismatch, and those console warnings land in
      // the unpacked-extension error console (the "Errors" button). Chunks
      // are local files, so dropping the hints costs nothing.
      modulePreload: false,
    },
  }),
});
