import { describe, expect, it } from 'vitest';
import { listSelectionMenus, parseSelectionMenuId } from '../../core/registry/selection-actions';
import type { ToolModuleManifest } from '../../core/module-sdk/manifest';

const base64: ToolModuleManifest = {
  id: 'base64',
  version: '1.0.0',
  coreApiRange: '^1.0.0',
  icon: 'icon.svg',
  defaultEnabled: true,
  defaultQuickOrder: 10,
  surfaces: { popup: true, workbench: true, settings: false, selectionActions: ['encode', 'decode'] },
  permissions: { optionalPermissions: [], optionalHostPermissions: [] },
};

describe('background context menu', () => {
  it('creates localized menus from enabled module actions', () => {
    const menus = listSelectionMenus(
      [base64],
      new Set(['base64']),
      () => 'Base64 encode',
    );
    expect(menus).toHaveLength(2);
    for (const menu of menus) {
      const parsed = parseSelectionMenuId(menu.id);
      expect(parsed?.moduleId).toBe('base64');
    }
  });

  it('does not register menus for disabled modules', () => {
    expect(listSelectionMenus([base64], new Set(), () => 'x')).toEqual([]);
  });
});