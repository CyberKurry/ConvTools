import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../../locales/en.json';
import zh from '../../locales/zh_CN.json';
import { collectKeys } from '../../core/i18n/types';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

describe('i18n completeness', () => {
  it('requires English and Chinese dictionaries to share the same recursive key tree', () => {
    expect(collectKeys(en)).toEqual(collectKeys(zh));
  });

  it('rejects empty translations', () => {
    for (const value of [...collectValues(en), ...collectValues(zh)]) {
      expect(value.trim().length).toBeGreaterThan(0);
    }
  });

  it('applies the same locale-key equality check to every module directory', () => {
    const modulesDir = path.join(ROOT, 'modules');
    if (!fs.existsSync(modulesDir)) {
      return;
    }
    for (const entry of fs.readdirSync(modulesDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) {
        continue;
      }
      const enPath = path.join(modulesDir, entry.name, 'locales', 'en.json');
      const zhPath = path.join(modulesDir, entry.name, 'locales', 'zh_CN.json');
      const enJson = JSON.parse(fs.readFileSync(enPath, 'utf8')) as unknown;
      const zhJson = JSON.parse(fs.readFileSync(zhPath, 'utf8')) as unknown;
      expect(collectKeys(enJson)).toEqual(collectKeys(zhJson));
    }
  });
});

function collectValues(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }
  if (typeof value !== 'object' || value === null) {
    return [];
  }
  return Object.values(value).flatMap(collectValues);
}
