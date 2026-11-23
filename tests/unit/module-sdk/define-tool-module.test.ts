import { describe, expect, it } from 'vitest';
import { ModuleContractError, ModuleErrorCode } from '../../../core/module-sdk/errors';
import type { ToolModuleManifest } from '../../../core/module-sdk/manifest';
import { defineToolModule } from '../../../core/module-sdk/runtime';

const manifest: ToolModuleManifest = {
  id: 'sample-tool',
  version: '1.0.0',
  coreApiRange: '^1.0.0',
  icon: 'icon.svg',
  defaultEnabled: true,
  defaultQuickOrder: 10,
  surfaces: {
    popup: true,
    workbench: true,
    settings: false,
    selectionActions: ['encode'],
  },
  permissions: {
    optionalPermissions: [],
    optionalHostPermissions: [],
  },
};

describe('defineToolModule', () => {
  it('preserves manifest literals on a matching runtime id', () => {
    const definition = defineToolModule({
      manifest,
      runtime: {
        id: 'sample-tool',
        icon: 'unused.svg',
        surfaces: {
          popup: { Component: () => null },
          workbench: null,
          settings: null,
          selectionActions: [],
        },
      },
    });
    expect(definition.id).toBe('sample-tool');
    expect(definition.version).toBe('1.0.0');
    expect(definition.coreApiRange).toBe('^1.0.0');
    expect(definition.icon).toBe('icon.svg');
    expect(definition.permissions).toBe(manifest.permissions);
  });

  it('rejects a runtime ID that differs from module.json', () => {
    try {
      defineToolModule({
        manifest,
        runtime: {
          id: 'other-tool',
          icon: 'icon.svg',
          surfaces: {
            popup: null,
            workbench: null,
            settings: null,
            selectionActions: [],
          },
        },
      });
      expect.fail('expected id mismatch to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ModuleContractError);
      const contract = error as ModuleContractError;
      expect(contract.code).toBe(ModuleErrorCode.ID_MISMATCH);
      expect(contract.path).toBe('/id');
    }
  });
});