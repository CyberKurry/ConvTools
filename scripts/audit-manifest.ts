import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORBIDDEN_HOST_PATTERNS, FORBIDDEN_PERMISSIONS, PRODUCT } from '../core/config/product-constraints';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_DIRS = ['.output/chrome-mv3', '.output/edge-mv3'] as const;

export interface AuditResult {
  readonly path: string;
  readonly violations: readonly string[];
}

export function auditManifest(file: string): AuditResult {
  const violations: string[] = [];
  const serialized = fs.readFileSync(file, 'utf8');
  if (/\beval\s*\(/.test(serialized) || /new\s+Function/.test(serialized)) {
    violations.push('remote/eval code detected');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized) as unknown;
  } catch {
    violations.push('manifest JSON parse failed');
    return { path: file, violations };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    violations.push('manifest must be a JSON object');
    return { path: file, violations };
  }
  const manifest = parsed as Record<string, unknown>;
  const permissions = readStringArray(manifest, 'permissions', violations);
  const optionalPermissions = readStringArray(manifest, 'optional_permissions', violations);
  const hosts = readStringArray(manifest, 'host_permissions', violations);
  const optionalHosts = readStringArray(manifest, 'optional_host_permissions', violations);

  if (!sameMembers(permissions, PRODUCT.fixedPermissions)) {
    violations.push(`permissions must equal ${PRODUCT.fixedPermissions.join(', ')}`);
  }
  if (hosts.length > 0) {
    violations.push('host_permissions must be empty; use optional_host_permissions');
  }

  for (const forbidden of FORBIDDEN_PERMISSIONS) {
    if (permissions.includes(forbidden) || optionalPermissions.includes(forbidden)) {
      violations.push(`forbidden permission: ${forbidden}`);
    }
  }
  for (const pattern of [...hosts, ...optionalHosts]) {
    if (FORBIDDEN_HOST_PATTERNS.includes(pattern as (typeof FORBIDDEN_HOST_PATTERNS)[number])) {
      violations.push(`forbidden host pattern: ${pattern}`);
    }
    if (!isExactHttpsHostPattern(pattern)) {
      violations.push(`invalid optional host pattern: ${pattern}`);
    }
  }
  if (manifest.minimum_chrome_version !== PRODUCT.minimumChromeVersion) {
    violations.push(`minimum_chrome_version must be ${PRODUCT.minimumChromeVersion}`);
  }
  if (manifest.incognito !== PRODUCT.incognitoMode) {
    violations.push(`incognito must be ${PRODUCT.incognitoMode}`);
  }
  if (manifest.manifest_version !== PRODUCT.manifestVersion) {
    violations.push('manifest_version must be 3');
  }
  // Injection surface: the overlay ships through `scripting`/activeTab, so a
  // declared content script would silently grant permanent page access, a
  // web-accessible resource would expose extension files to pages, and
  // externally_connectable would let other sites message the extension.
  if (Array.isArray(manifest.content_scripts) && manifest.content_scripts.length > 0) {
    violations.push('content_scripts must be empty; the overlay is injected with scripting');
  }
  if (Array.isArray(manifest.web_accessible_resources) && manifest.web_accessible_resources.length > 0) {
    violations.push('web_accessible_resources must be empty');
  }
  if (manifest.externally_connectable !== undefined) {
    violations.push('externally_connectable must not be declared');
  }
  return { path: file, violations };
}

// Acceptance criterion 12: shipped chunks must not contain eval, new Function,
// or remotely loaded code. Local dynamic imports (chunks) are expected and fine.
export function auditBundleFile(file: string): AuditResult {
  const violations: string[] = [];
  const source = fs.readFileSync(file, 'utf8');
  if (/\beval\s*\(/.test(source) || /new\s+Function\s*\(/.test(source)) {
    violations.push('eval/new Function in bundle');
  }
  if (/\bimport\s*\(\s*["']https?:\/\//.test(source) || /\bimport\s*\(\s*(new\s+String|String\.from)/.test(source)) {
    violations.push('remote dynamic import in bundle');
  }
  if (/\bimportScripts\s*\(\s*["']https?:\/\//.test(source)) {
    violations.push('remote importScripts in bundle');
  }
  // Test-only overrides and the Temporal polyfill are compiled out of stable
  // builds; their presence in a shipped artifact is itself a violation.
  if (source.includes('CONVTOOLS_TEST_INCOGNITO_OVERRIDE')) {
    violations.push('test-only incognito override leaked into stable bundle');
  }
  if (/@js-temporal\/polyfill/.test(source)) {
    violations.push('Temporal polyfill leaked into stable bundle');
  }
  return { path: file, violations };
}

export function auditOutput(): AuditResult[] {
  const results: AuditResult[] = [];
  for (const dir of OUTPUT_DIRS) {
    const absDir = path.join(ROOT, dir);
    const manifestPath = path.join(absDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      results.push({ path: manifestPath, violations: ['missing manifest (build outputs required)'] });
      continue;
    }
    results.push(auditManifest(manifestPath));
    const stack = [absDir];
    while (stack.length > 0) {
      const current = stack.pop() as string;
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const entryPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(entryPath);
        } else if (AUDITED_FILE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
          results.push(auditBundleFile(entryPath));
        }
      }
    }
  }
  return results;
}

const AUDITED_FILE_EXTENSIONS = ['.js', '.html', '.css', '.svg', '.json'] as const;

function readStringArray(
  manifest: Record<string, unknown>,
  key: string,
  violations: string[],
): string[] {
  const value = manifest[key];
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || !value.every((item: unknown): item is string => typeof item === 'string')) {
    violations.push(`${key} must be an array of strings`);
    return [];
  }
  return value;
}

function sameMembers(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && expected.every((value) => actual.includes(value));
}

function isExactHttpsHostPattern(pattern: string): boolean {
  const match = /^https:\/\/([^/*?#]+)\/\*$/i.exec(pattern);
  const authority = match?.[1] ?? '';
  if (match === null || match[0] !== pattern || authority.length === 0 || authority.includes('\\')) {
    return false;
  }
  try {
    const url = new URL(`https://${authority}/`);
    return (
      url.protocol === 'https:' &&
      url.username.length === 0 &&
      url.password.length === 0 &&
      url.pathname === '/' &&
      url.search.length === 0 &&
      url.hash.length === 0 &&
      url.hostname.length > 0
    );
  } catch {
    return false;
  }
}

export function reverseProbe(violation: string): boolean {
  const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'convtools-probe-'));
  try {
    const tmp = path.join(probeDir, 'manifest.json');
    fs.writeFileSync(tmp, JSON.stringify({ permissions: [violation], manifest_version: 3 }));
    const result = auditManifest(tmp);
    return result.violations.length > 0;
  } finally {
    fs.rmSync(probeDir, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
) {
  const results = auditOutput();
  const failed = results.filter((result) => result.violations.length > 0);
  for (const result of results) {
    if (result.violations.length === 0) {
      console.log(`ok ${result.path}`);
    }
  }
  if (failed.length > 0) {
    for (const result of failed) {
      console.error(`FAIL ${result.path}`);
      for (const violation of result.violations) {
        console.error(`  - ${violation}`);
      }
    }
    process.exit(1);
  }
}
