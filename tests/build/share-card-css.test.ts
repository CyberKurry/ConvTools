import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

describe('share-card editor styles', () => {
  it('defines every local CSS module class used by the editor and preview', () => {
    const source = fs.readFileSync(path.join(ROOT, 'modules', 'share-card', 'ui', 'CardSurface.tsx'), 'utf8');
    const css = fs.readFileSync(path.join(ROOT, 'modules', 'share-card', 'ui', 'CardSurface.module.css'), 'utf8');
    const used = [...source.matchAll(/styles\.([A-Za-z0-9_]+)/g)].map((match) => match[1]).filter((name): name is string => name !== undefined);
    const missing = [...new Set(used)].filter((name) => !new RegExp(`\\.${name}(?:[\\s,{:.]|$)`).test(css));
    expect(missing).toEqual([]);
  });
});
