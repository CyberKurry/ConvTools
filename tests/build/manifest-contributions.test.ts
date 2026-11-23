import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { generateModuleArtifacts } from '../../scripts/lib/module-scanner';

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('manifest contributions', () => {
  it('emits metadata that wxt.config can consume without runtime imports', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'convtools-manifest-'));
    temps.push(root);
    const moduleDir = path.join(root, 'probe-tool');
    fs.mkdirSync(path.join(moduleDir, 'locales'), { recursive: true });
    fs.writeFileSync(
      path.join(moduleDir, 'module.json'),
      `${JSON.stringify(
        {
          id: 'probe-tool',
          version: '1.0.0',
          coreApiRange: '^1.0.0',
          icon: 'icon.svg',
          defaultEnabled: false,
          defaultQuickOrder: null,
          surfaces: { popup: false, workbench: true, settings: true, selectionActions: [] },
          permissions: {
            optionalPermissions: ['notifications'],
            optionalHostPermissions: ['https://api.example.com/*'],
          },
        },
        null,
        2,
      )}\n`,
    );
    fs.writeFileSync(path.join(moduleDir, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>\n');
    fs.writeFileSync(path.join(moduleDir, 'locales', 'en.json'), '{"name":"Probe"}\n');
    fs.writeFileSync(path.join(moduleDir, 'locales', 'zh_CN.json'), '{"name":"探测"}\n');

    const { manifest, registry } = generateModuleArtifacts(root);
    expect(registry).toContain("'probe-tool': () => import('../modules/probe-tool/index')");
    expect(manifest).not.toContain('react');
    expect(manifest).not.toContain('browser.');
    expect(manifest).toContain("'probe-tool'");
    expect(manifest).toContain("'https://api.example.com/*'");

    const wxtConfig = fs.readFileSync(path.resolve(import.meta.dirname, '..', '..', 'wxt.config.ts'), 'utf8');
    expect(wxtConfig).toContain("from './generated/module-manifest'");
    expect(wxtConfig).toContain('optional_permissions');
    expect(wxtConfig).toContain('optional_host_permissions');
  });
});
