import { describe, expect, it } from 'vitest';
import type { ToolModuleManifest } from '../../../core/module-sdk/manifest';
import { createCatalog } from '../../../core/registry/catalog';

function manifest(overrides: Partial<ToolModuleManifest> & Pick<ToolModuleManifest, 'id'>): ToolModuleManifest {
  return {
    version: '1.0.0',
    coreApiRange: '^1.0.0',
    icon: 'icon.svg',
    defaultEnabled: true,
    defaultQuickOrder: null,
    surfaces: { popup: true, workbench: true, settings: false, selectionActions: [] },
    permissions: { optionalPermissions: [], optionalHostPermissions: [] },
    ...overrides,
  };
}

describe('module catalog', () => {
  it('sorts default quick modules by defaultQuickOrder, not by id', () => {
    const catalog = createCatalog([
      manifest({ id: 'alpha-tool', defaultQuickOrder: 20 }),
      manifest({ id: 'zeta-tool', defaultQuickOrder: 10 }),
      manifest({ id: 'muted-tool', defaultEnabled: false, defaultQuickOrder: null }),
    ]);
    expect(catalog.defaultQuickIds).toEqual(['zeta-tool', 'alpha-tool']);
    expect(catalog.defaultEnabledIds).toEqual(['alpha-tool', 'zeta-tool']);
  });

  it('ignores modules whose defaultQuickOrder is null', () => {
    const catalog = createCatalog([manifest({ id: 'solo-tool', defaultQuickOrder: null })]);
    expect(catalog.defaultQuickIds).toEqual([]);
  });

  it('exposes generated metadata without inventing ids', () => {
    const catalog = createCatalog([]);
    expect(catalog.modules).toEqual([]);
    expect(catalog.defaultEnabledIds).toEqual([]);
    expect(catalog.defaultQuickIds).toEqual([]);
  });
});
