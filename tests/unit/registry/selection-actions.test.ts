import { describe, expect, it } from 'vitest';
import type { ToolModuleManifest } from '../../../core/module-sdk/manifest';
import {
  listSelectionMenus,
  parseSelectionMenuId,
  selectionMenuId,
} from '../../../core/registry/selection-actions';

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

const timestamp: ToolModuleManifest = {
  id: 'timestamp',
  version: '1.0.0',
  coreApiRange: '^1.0.0',
  icon: 'icon.svg',
  defaultEnabled: true,
  defaultQuickOrder: 20,
  surfaces: { popup: true, workbench: true, settings: false, selectionActions: ['convert'] },
  permissions: { optionalPermissions: [], optionalHostPermissions: [] },
};

describe('selection actions', () => {
  it('generates deterministic convtools:<module>:<action> ids', () => {
    expect(selectionMenuId('base64', 'encode')).toBe('convtools:base64:encode');
  });

  it('parses ids back into module and action', () => {
    expect(parseSelectionMenuId('convtools:base64:encode')).toEqual({ moduleId: 'base64', actionId: 'encode' });
    expect(parseSelectionMenuId('garbage')).toBeNull();
  });

  it('filters disabled modules and emits selection-context menus', () => {
    const menus = listSelectionMenus(
      [base64, timestamp],
      new Set(['base64']),
      (moduleId, actionId) => `${moduleId} ${actionId}`,
    );
    expect(menus.map((menu) => menu.id)).toEqual(['convtools:base64:encode', 'convtools:base64:decode']);
    expect(menus.every((menu) => menu.contexts.includes('selection'))).toBe(true);
  });
});