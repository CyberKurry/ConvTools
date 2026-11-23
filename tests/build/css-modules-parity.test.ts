import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const SCAN_DIRS = ['core', 'entrypoints', 'modules'] as const;

interface CssModuleFile {
  readonly cssPath: string;
  readonly classes: ReadonlySet<string>;
}

function listFiles(dir: string, extensions: readonly string[]): string[] {
  const files: string[] = [];
  if (!fs.existsSync(dir)) {
    return files;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(entryPath, extensions));
    } else if (extensions.some((extension) => entry.name.endsWith(extension))) {
      files.push(entryPath);
    }
  }
  return files;
}

function collectCssClasses(cssPath: string): ReadonlySet<string> {
  const source = fs.readFileSync(cssPath, 'utf8');
  const classes = new Set<string>();
  for (const match of source.matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)) {
    classes.add(match[1] as string);
  }
  return classes;
}

function relativeTsFiles(): string[] {
  const tsFiles: string[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of listFiles(path.join(ROOT, dir), ['.ts', '.tsx'])) {
      if (/\.test\.(ts|tsx)$/.test(file)) {
        continue;
      }
      tsFiles.push(file);
    }
  }
  return tsFiles;
}

/**
 * CSS Modules types are an index signature, so `styles.anything` compiles even
 * when the class does not exist and the element silently ships unstyled (the
 * ULTRAREVIEW-2026-09-08 P1-10 / 2026-09-13 P2-05 failure class). This gate
 * cross-checks every styles.* access against the CSS definitions for all
 * modules the file consumes.
 */
describe('CSS Modules class parity', () => {
  it('never references an undefined class from a CSS module', () => {
    const cssModules = new Map<string, CssModuleFile>();
    for (const dir of SCAN_DIRS) {
      for (const cssPath of listFiles(path.join(ROOT, dir), ['.module.css'])) {
        cssModules.set(path.basename(cssPath), { cssPath, classes: collectCssClasses(cssPath) });
      }
    }
    expect(cssModules.size).toBeGreaterThan(0);

    const drift: string[] = [];
    for (const file of relativeTsFiles()) {
      const source = fs.readFileSync(file, 'utf8');
      // Every CSS module this file imports, mapped import-name -> file name.
      const imports = new Map<string, string>();
      for (const match of source.matchAll(/import\s+(\w+)\s+from\s+['"]([^'"]*\.module\.css)['"]/g)) {
        const importName = match[1];
        const cssFile = path.basename(match[2] ?? '');
        if (importName && cssFile) {
          imports.set(importName, cssFile);
        }
      }
      if (imports.size === 0) {
        continue;
      }
      for (const [importName, cssFile] of imports) {
        const module = cssModules.get(cssFile);
        if (!module) {
          drift.push(`${path.relative(ROOT, file)}: imported ${cssFile} outside scanned dirs`);
          continue;
        }
        const escaped = importName.replace(/[$]/g, '\\$');
        for (const use of source.matchAll(new RegExp(`${escaped}\\.([A-Za-z_$][A-Za-z0-9_$]*)`, 'g'))) {
          const key = use[1] ?? '';
          if (key && !module.classes.has(key)) {
            drift.push(`${path.relative(ROOT, file)}: ${importName}.${key} missing in ${path.relative(ROOT, module.cssPath)}`);
          }
        }
      }
    }
    expect(drift).toEqual([]);
  });
});
