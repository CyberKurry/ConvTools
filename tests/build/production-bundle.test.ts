import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

describe('production bundle invariants', () => {
  it('contains no Temporal polyfill imports in production module code', () => {
    const scanDirs = [path.join(ROOT, 'modules'), path.join(ROOT, 'core'), path.join(ROOT, 'entrypoints')];
    const hits: string[] = [];
    for (const dir of scanDirs) {
      if (!fs.existsSync(dir)) {
        continue;
      }
      walk(dir, (file) => {
        const source = fs.readFileSync(file, 'utf8');
        if (/@js-temporal\/polyfill/.test(source)) {
          hits.push(file);
        }
      });
    }
    expect(hits).toEqual([]);
  });

  it('contains no production test-override marker', () => {
    const hits: string[] = [];
    walk(path.join(ROOT, 'core'), (file) => {
      if (/CONVTOOLS_TEST_INCOGNITO_OVERRIDE/.test(fs.readFileSync(file, 'utf8'))) {
        hits.push(file);
      }
    });
    // The marker is referenced by name in the environment module; ensure it is
    // not prefixed with import.meta.env.MODE in a way that ships to production.
    expect(hits.every((file) => file.endsWith('environment.ts'))).toBe(true);
  });

  it('keeps module UI imports behind lazy boundaries', () => {
    for (const moduleId of ['base64', 'timestamp', 'share-card']) {
      const source = fs.readFileSync(path.join(ROOT, 'modules', moduleId, 'index.ts'), 'utf8');
      expect(source).toMatch(/import\('\.\/ui\//);
      expect(source).not.toMatch(/from '\.\/ui\//);
    }
  });
});

function walk(dir: string, visit: (file: string) => void): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, visit);
    } else if (/\.(ts|tsx|js)$/.test(entry.name)) {
      visit(full);
    }
  }
}
