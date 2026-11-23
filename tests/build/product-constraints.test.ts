import { describe, it, expect } from 'vitest';
import { FORBIDDEN_HOST_PATTERNS, FORBIDDEN_PERMISSIONS, PRODUCT } from '../../core/config/product-constraints';

describe('product constraints', () => {
  it('enforces the minimum Chromium milestone 144', () => {
    expect(PRODUCT.minimumChromeVersion).toBe('144');
  });

  it('declares exactly the four approved fixed permissions', () => {
    expect([...PRODUCT.fixedPermissions].sort()).toEqual(
      ['activeTab', 'contextMenus', 'scripting', 'storage'].sort(),
    );
  });

  it('forbids broad-tab, clipboard, unlimited-storage, and tracking permissions', () => {
    for (const permission of FORBIDDEN_PERMISSIONS) {
      expect(PRODUCT.fixedPermissions).not.toContain(permission);
    }
  });

  it('forbids wildcard and <all_urls> host patterns in the fixed set', () => {
    for (const pattern of FORBIDDEN_HOST_PATTERNS) {
      expect([...PRODUCT.fixedPermissions]).not.toContain(pattern);
    }
  });

  it('points WXT module discovery at wxt-modules, never root modules/', () => {
    expect(PRODUCT.wxtModulesDir).toBe('wxt-modules');
  });

  it('uses split incognito mode', () => {
    expect(PRODUCT.incognitoMode).toBe('split');
  });

  it('generates Manifest V3 artifacts', () => {
    expect(PRODUCT.manifestVersion).toBe(3);
  });
});