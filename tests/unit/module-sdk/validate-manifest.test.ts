import { describe, expect, it } from 'vitest';
import { ModuleContractError, ModuleErrorCode } from '../../../core/module-sdk/errors';
import type { ToolModuleManifest } from '../../../core/module-sdk/manifest';
import { validateLocalePair, validateManifest } from '../../../core/module-sdk/validate-manifest';

function validManifest(overrides: Record<string, unknown> = {}): unknown {
  const base: ToolModuleManifest = {
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
      selectionActions: ['encode', 'decode'],
    },
    permissions: {
      optionalPermissions: [],
      optionalHostPermissions: [],
    },
  };
  return { ...base, ...overrides };
}

describe('validateManifest', () => {
  it('accepts a valid manifest unchanged', () => {
    const input = validManifest();
    const result = validateManifest(input);
    expect(result.id).toBe('sample-tool');
    expect(result.surfaces.selectionActions).toEqual(['encode', 'decode']);
    expect(result.defaultQuickOrder).toBe(10);
  });

  it('rejects an invalid kebab-case ID', () => {
    expect(() => validateManifest(validManifest({ id: 'Base64' }))).toThrow(ModuleContractError);
    try {
      validateManifest(validManifest({ id: 'Base64' }));
    } catch (error) {
      expect(error).toBeInstanceOf(ModuleContractError);
      const contract = error as ModuleContractError;
      expect(contract.code).toBe(ModuleErrorCode.INVALID_ID);
      expect(contract.path).toBe('/id');
    }
  });

  it('rejects duplicate selection action IDs', () => {
    const input = validManifest({
      surfaces: {
        popup: true,
        workbench: true,
        settings: false,
        selectionActions: ['encode', 'encode'],
      },
    });
    try {
      validateManifest(input);
      expect.fail('expected duplicate selection action to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ModuleContractError);
      const contract = error as ModuleContractError;
      expect(contract.code).toBe(ModuleErrorCode.DUPLICATE_SELECTION_ACTION);
      expect(contract.path).toBe('/surfaces/selectionActions/1');
    }
  });

  it('rejects an incompatible Core API range', () => {
    try {
      validateManifest(validManifest({ coreApiRange: '^2.0.0' }));
      expect.fail('expected incompatible range to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ModuleContractError);
      const contract = error as ModuleContractError;
      expect(contract.code).toBe(ModuleErrorCode.INCOMPATIBLE_CORE_API);
      expect(contract.path).toBe('/coreApiRange');
    }
  });

  it('does not silently coerce invalid data', () => {
    expect(() => validateManifest({ id: 'ok' })).toThrow(ModuleContractError);
    expect(() => validateManifest(null)).toThrow(ModuleContractError);
    expect(() => validateManifest('not-an-object')).toThrow(ModuleContractError);
  });

  it('rejects optional host patterns outside https://', () => {
    const input = validManifest({
      permissions: {
        optionalPermissions: [],
        optionalHostPermissions: ['http://example.com/*'],
      },
    });
    try {
      validateManifest(input);
      expect.fail('expected non-https host pattern to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ModuleContractError);
      const contract = error as ModuleContractError;
      expect(contract.code).toBe(ModuleErrorCode.INVALID_HOST_PERMISSION);
      expect(contract.path).toBe('/permissions/optionalHostPermissions/0');
    }
  });

  it('rejects missing locale declarations', () => {
    try {
      validateLocalePair(null, { name: '工具' });
      expect.fail('expected missing English locale to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ModuleContractError);
      const contract = error as ModuleContractError;
      expect(contract.code).toBe(ModuleErrorCode.MISSING_LOCALE);
      expect(contract.path).toBe('/locales/en.json');
    }
  });

  it('rejects mismatched locale keys', () => {
    try {
      validateLocalePair({ name: 'Tool' }, { title: '工具' });
      expect.fail('expected locale key mismatch to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ModuleContractError);
      const contract = error as ModuleContractError;
      expect(contract.code).toBe(ModuleErrorCode.LOCALE_KEY_MISMATCH);
    }
  });

  it('accepts matching bilingual locale trees', () => {
    expect(() =>
      validateLocalePair({ name: 'Tool', actions: { encode: 'Encode' } }, { name: '工具', actions: { encode: '编码' } }),
    ).not.toThrow();
  });

  it('accepts precise https host patterns', () => {
    const result = validateManifest(
      validManifest({
        permissions: {
          optionalPermissions: [],
          optionalHostPermissions: ['https://api.example.com/*'],
        },
      }),
    );
    expect(result.permissions.optionalHostPermissions).toEqual(['https://api.example.com/*']);
  });

  it.each([
    'https://*.example.com/*',
    'https://example.com/path/*',
    'https://user@example.com/*',
    'https://example.com/*?query',
  ])('rejects non-exact host pattern %s', (pattern) => {
    expect(() =>
      validateManifest(
        validManifest({
          permissions: { optionalPermissions: [], optionalHostPermissions: [pattern] },
        }),
      ),
    ).toThrow(ModuleContractError);
  });
});
