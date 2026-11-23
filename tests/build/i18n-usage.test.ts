import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import englishMessages from '../../locales/en.json';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const SCAN_DIRS = ['entrypoints', 'core'] as const;
const MODULES_ROOT = path.join(ROOT, 'modules');

function collectKeys(value: unknown, prefix = ''): Set<string> {
  const keys = new Set<string>();
  if (typeof value === 'string') {
    keys.add(prefix);
    return keys;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      for (const nested of collectKeys(child, prefix ? `${prefix}.${key}` : key)) {
        keys.add(nested);
      }
    }
  }
  return keys;
}

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(entryPath));
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      files.push(entryPath);
    }
  }
  return files;
}

const T_LITERAL = /\bt\(\s*(['"])((?:(?!\1).)*)\1/g;

/**
 * Spec §17: a missing key must fail the build. Locale parity is covered by
 * i18n-completeness; this gate catches code referencing keys that do not
 * exist at all (lookup() would silently render the raw key otherwise).
 */
describe('i18n key usage', () => {
  it('only references extension locale keys that exist', () => {
    const known = collectKeys(englishMessages);
    const missing: Array<{ file: string; key: string }> = [];
    for (const dir of SCAN_DIRS) {
      for (const file of walk(path.join(ROOT, dir))) {
        const source = fs.readFileSync(file, 'utf8');
        for (const match of source.matchAll(T_LITERAL)) {
          const key = match[2];
          if (key && !known.has(key)) {
            missing.push({ file: path.relative(ROOT, file), key });
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('only references module locale keys that exist in that module dictionary', () => {
    // Module surfaces resolve t() against their own locales/<lang>.json first;
    // a typoed key renders the raw key in both languages (spec §17).
    const missing: Array<{ file: string; key: string }> = [];
    if (!fs.existsSync(MODULES_ROOT)) {
      expect(missing).toEqual([]);
      return;
    }
    for (const entry of fs.readdirSync(MODULES_ROOT, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const moduleDir = path.join(MODULES_ROOT, entry.name);
      const enPath = path.join(moduleDir, 'locales', 'en.json');
      if (!fs.existsSync(enPath)) {
        continue;
      }
      const dictionary = new Set(
        Object.keys(JSON.parse(fs.readFileSync(enPath, 'utf8')) as Record<string, unknown>),
      );
      for (const file of walk(moduleDir)) {
        if (/\.test\.(ts|tsx)$/.test(file)) {
          continue;
        }
        const source = fs.readFileSync(file, 'utf8');
        for (const match of source.matchAll(T_LITERAL)) {
          const key = match[2];
          if (key && !dictionary.has(key)) {
            missing.push({ file: path.relative(ROOT, file), key });
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
