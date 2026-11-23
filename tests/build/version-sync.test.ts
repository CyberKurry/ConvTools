import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getVersion, normalizeVersion, selectReleaseTag, setVersion } from '../../scripts/version';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

describe('version sync', () => {
  it('normalizes a leading v and keeps plain X.Y.Z', () => {
    expect(normalizeVersion('v0.2.0')).toBe('0.2.0');
    expect(normalizeVersion('0.2.0')).toBe('0.2.0');
  });

  it('rejects prerelease and non-numeric suffixes', () => {
    // Chrome/Edge manifests require a plain X.Y.Z; nothing with a `-` is valid.
    expect(() => normalizeVersion('v1.2.3-beta')).toThrow(/not a plain X.Y.Z version/);
  });

  it('rejects non-semver values', () => {
    expect(() => normalizeVersion('banana')).toThrow(/not a plain X.Y.Z version/);
    expect(() => normalizeVersion('0.2')).toThrow(/not a plain X.Y.Z version/);
    expect(() => normalizeVersion('1.2.3.4')).toThrow(/not a plain X.Y.Z version/);
  });

  it('round-trips a package.json version through set/get', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'convtools-version-'));
    try {
      const packagePath = path.join(dir, 'package.json');
      fs.writeFileSync(packagePath, `${JSON.stringify({ name: 'x', version: '0.1.0' }, null, 2)}\n`);
      setVersion('v0.2.0', packagePath);
      expect(getVersion(packagePath)).toBe('0.2.0');
      const reparsed = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as { version: string };
      expect(reparsed.version).toBe('0.2.0');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps package.json in sync with the manifest source of truth', () => {
    // WXT reads `package.json#version` by default, so the repo's own package
    // version must be the X.Y.Z that ends up in the manifest.
    const version = getVersion(path.join(ROOT, 'package.json'));
    expect(normalizeVersion(version)).toBe(version);
  });
});

describe('automatic release tags', () => {
  it('starts from the package version in an untagged repository', () => {
    expect(selectReleaseTag('0.1.0', ['archive', 'v0.2.0-rc.1'], [])).toBe('v0.1.0');
  });

  it('increments the highest stable tag using numeric version order', () => {
    expect(selectReleaseTag('0.1.0', ['v0.1.10', 'v0.1.9', 'v0.1.99-rc.1'], [])).toBe('v0.1.11');
  });

  it('uses a newer declared package version as the release baseline', () => {
    expect(selectReleaseTag('0.2.0', ['v0.1.99'], [])).toBe('v0.2.0');
  });

  it('reuses the commit tag when a release run is retried', () => {
    expect(selectReleaseTag('0.1.0', ['v0.1.1', 'v0.1.2'], ['v0.1.2'])).toBe('v0.1.2');
  });

  it('rejects an automatically generated version outside the browser limit', () => {
    expect(() => selectReleaseTag('0.1.0', ['v0.1.65535'], [])).toThrow(/65535/);
  });
});
