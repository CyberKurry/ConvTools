import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ModuleContractError, ModuleErrorCode } from '../../core/module-sdk/errors';
import { generateModuleArtifacts, scanModules } from '../../scripts/lib/module-scanner';

interface FixtureManifest {
  id: string;
  version?: string;
  coreApiRange?: string;
  icon?: string;
  defaultEnabled?: boolean;
  defaultQuickOrder?: number | null;
  surfaces?: {
    popup?: boolean;
    workbench?: boolean;
    settings?: boolean;
    selectionActions?: string[];
  };
  permissions?: {
    optionalPermissions?: string[];
    optionalHostPermissions?: string[];
  };
}

const temps: string[] = [];

function makeRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'convtools-modules-'));
  temps.push(dir);
  return dir;
}

function writeModule(
  root: string,
  dirName: string,
  options: {
    manifest?: FixtureManifest;
    icon?: boolean;
    en?: Record<string, unknown> | null;
    zh?: Record<string, unknown> | null;
  } = {},
): void {
  const moduleDir = path.join(root, dirName);
  fs.mkdirSync(path.join(moduleDir, 'locales'), { recursive: true });
  const { surfaces, permissions, ...rest } = options.manifest ?? {};
  const manifest = {
    id: dirName,
    version: '1.0.0',
    coreApiRange: '^1.0.0',
    icon: 'icon.svg',
    defaultEnabled: true,
    defaultQuickOrder: 10,
    ...rest,
    surfaces: {
      popup: true,
      workbench: true,
      settings: false,
      selectionActions: [] as string[],
      ...surfaces,
    },
    permissions: {
      optionalPermissions: [] as string[],
      optionalHostPermissions: [] as string[],
      ...permissions,
    },
  };
  fs.writeFileSync(path.join(moduleDir, 'module.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  if (options.icon !== false) {
    fs.writeFileSync(path.join(moduleDir, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>\n');
  }
  if (options.en !== null) {
    fs.writeFileSync(
      path.join(moduleDir, 'locales', 'en.json'),
      `${JSON.stringify(options.en ?? { name: dirName }, null, 2)}\n`,
    );
  }
  if (options.zh !== null) {
    fs.writeFileSync(
      path.join(moduleDir, 'locales', 'zh_CN.json'),
      `${JSON.stringify(options.zh ?? { name: dirName }, null, 2)}\n`,
    );
  }
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('module scanner', () => {
  it('returns zero modules for an empty root', () => {
    const root = makeRoot();
    expect(scanModules(root)).toEqual([]);
    const artifacts = generateModuleArtifacts(root);
    expect(artifacts.registry).toContain('export const moduleLoaders = {');
    expect(artifacts.registry).toContain('} as const;');
    expect(artifacts.manifest).toContain('export const moduleManifests = [');
  });

  it('emits modules in stable alphabetical order by id', () => {
    const root = makeRoot();
    writeModule(root, 'zeta-tool', { manifest: { id: 'zeta-tool', defaultQuickOrder: 1 } });
    writeModule(root, 'alpha-tool', { manifest: { id: 'alpha-tool', defaultQuickOrder: 2 } });
    const scanned = scanModules(root);
    expect(scanned.map((module) => module.manifest.id)).toEqual(['alpha-tool', 'zeta-tool']);
    const { registry } = generateModuleArtifacts(root);
    const alpha = registry.indexOf("'alpha-tool':");
    const zeta = registry.indexOf("'zeta-tool':");
    expect(alpha).toBeGreaterThan(-1);
    expect(zeta).toBeGreaterThan(alpha);
  });

  it('rejects duplicate IDs', () => {
    const root = makeRoot();
    writeModule(root, 'alpha-tool', { manifest: { id: 'shared-id' } });
    writeModule(root, 'beta-tool', { manifest: { id: 'shared-id' } });
    expect(() => scanModules(root)).toThrow(ModuleContractError);
    try {
      scanModules(root);
    } catch (error) {
      expect((error as ModuleContractError).code).toBe(ModuleErrorCode.DUPLICATE_ID);
    }
  });

  it('rejects a directory/ID mismatch', () => {
    const root = makeRoot();
    writeModule(root, 'alpha-tool', { manifest: { id: 'beta-tool' } });
    try {
      scanModules(root);
      expect.fail('expected directory/id mismatch');
    } catch (error) {
      expect(error).toBeInstanceOf(ModuleContractError);
      expect((error as ModuleContractError).code).toBe(ModuleErrorCode.DIRECTORY_ID_MISMATCH);
    }
  });

  it('rejects icons with scripts, event handlers, or external references', () => {
    // Icons are embedded via dangerouslySetInnerHTML into extension pages; the
    // scanner is the content gate for shipped SVG.
    const hostile = [
      '<svg xmlns="http://www.w3.org/2000/svg"><script>fetch("https://x")</script></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
      '<svg xmlns="http://www.w3.org/2000/svg"><use href="https://ex.test/i.svg"/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><body></body></foreignObject></svg>',
    ];
    for (const icon of hostile) {
      const root = makeRoot();
      writeModule(root, 'hostile-icon', { icon: false });
      fs.writeFileSync(path.join(root, 'hostile-icon', 'icon.svg'), icon);
      expect(() => scanModules(root)).toThrow(ModuleContractError);
    }
  });

  it('rejects a missing icon file', () => {
    const root = makeRoot();
    writeModule(root, 'alpha-tool', { icon: false });
    try {
      scanModules(root);
      expect.fail('expected missing icon');
    } catch (error) {
      expect((error as ModuleContractError).code).toBe(ModuleErrorCode.MISSING_FILE);
      expect((error as ModuleContractError).path).toContain('icon.svg');
    }
  });

  it('rejects missing en.json or zh_CN.json', () => {
    const root = makeRoot();
    writeModule(root, 'alpha-tool', { en: null });
    try {
      scanModules(root);
      expect.fail('expected missing English locale');
    } catch (error) {
      expect((error as ModuleContractError).code).toBe(ModuleErrorCode.MISSING_FILE);
      expect((error as ModuleContractError).path).toContain('en.json');
    }
  });

  it('rejects mismatched locale keys', () => {
    const root = makeRoot();
    writeModule(root, 'alpha-tool', { en: { name: 'Alpha' }, zh: { title: '阿尔法' } });
    try {
      scanModules(root);
      expect.fail('expected locale mismatch');
    } catch (error) {
      expect((error as ModuleContractError).code).toBe(ModuleErrorCode.LOCALE_KEY_MISMATCH);
    }
  });

  it('rejects an incompatible Core API range', () => {
    const root = makeRoot();
    writeModule(root, 'alpha-tool', { manifest: { id: 'alpha-tool', coreApiRange: '^2.0.0' } });
    try {
      scanModules(root);
      expect.fail('expected incompatible core api');
    } catch (error) {
      expect((error as ModuleContractError).code).toBe(ModuleErrorCode.INCOMPATIBLE_CORE_API);
    }
  });

  it('de-duplicates permission unions across modules', () => {
    const root = makeRoot();
    writeModule(root, 'alpha-tool', {
      manifest: {
        id: 'alpha-tool',
        permissions: {
          optionalPermissions: ['notifications'],
          optionalHostPermissions: ['https://a.example.com/*'],
        },
      },
    });
    writeModule(root, 'beta-tool', {
      manifest: {
        id: 'beta-tool',
        permissions: {
          optionalPermissions: ['notifications', 'alarms'],
          optionalHostPermissions: ['https://a.example.com/*', 'https://b.example.com/*'],
        },
      },
    });
    const { manifest } = generateModuleArtifacts(root);
    expect(manifest).toContain("optionalPermissions = ['alarms', 'notifications']");
    expect(manifest).toContain(
      "optionalHostPermissions = ['https://a.example.com/*', 'https://b.example.com/*']",
    );
  });

  it('is deterministic across two generations', () => {
    const root = makeRoot();
    writeModule(root, 'zeta-tool');
    writeModule(root, 'alpha-tool');
    const first = generateModuleArtifacts(root);
    const second = generateModuleArtifacts(root);
    expect(second.registry).toBe(first.registry);
    expect(second.manifest).toBe(first.manifest);
  });
});
