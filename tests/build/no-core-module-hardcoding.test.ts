import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const CORE_ROOT = path.join(ROOT, 'core');
const MODULES_ROOT = path.join(ROOT, 'modules');

/**
 * Derived from the module directories at test time: adding a module (like
 * share-card) automatically extends the gate, so a hardcoded branch for any
 * shipped module fails the build instead of silently passing.
 */
function listModuleIds(): string[] {
  if (!fs.existsSync(MODULES_ROOT)) {
    return [];
  }
  return fs
    .readdirSync(MODULES_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function walk(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(full));
    } else if (/\.(ts|tsx|js|css)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

describe('no core module hardcoding', () => {
  it('forbids at least one module id (the gate cannot go stale)', () => {
    expect(listModuleIds().length).toBeGreaterThan(0);
  });

  it('does not mention any shipped module id in production core code', () => {
    const forbidden = listModuleIds();
    expect(forbidden.length).toBeGreaterThan(0);
    const hits: string[] = [];
    for (const file of walk(CORE_ROOT)) {
      const source = fs.readFileSync(file, 'utf8');
      for (const token of forbidden) {
        const pattern = new RegExp(`['"\`]${token}['"\`]`);
        if (pattern.test(source)) {
          hits.push(`${path.relative(CORE_ROOT, file)}:${token}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });
});
