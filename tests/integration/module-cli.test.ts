import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { addModule, removeModule } from '../../scripts/module-cli';
import { resolveModulePath } from '../../scripts/lib/module-path';

const temps: string[] = [];

function makeWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'convtools-cli-'));
  temps.push(root);
  fs.mkdirSync(path.join(root, 'modules'));
  fs.mkdirSync(path.join(root, 'generated'));
  execFileSync('git', ['init'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'cli@test.local'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'CLI Test'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'init', '--allow-empty'], { cwd: root });
  return root;
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('module path safety', () => {
  it('rejects path traversal and unresolved globs', () => {
    const root = path.join(os.tmpdir(), 'modules-root');
    expect(() => resolveModulePath(root, '../evil')).toThrow(/outside/);
    expect(() => resolveModulePath(root, 'foo/bar')).toThrow(/outside/);
    expect(() => resolveModulePath(root, '*')).toThrow(/kebab-case/);
  });
});

describe('module CLI', () => {
  it('adds a bilingual skeleton and regenerates the registry', () => {
    const root = makeWorkspace();
    addModule('sample-tool', { root });
    const moduleDir = path.join(root, 'modules', 'sample-tool');
    expect(fs.existsSync(path.join(moduleDir, 'module.json'))).toBe(true);
    expect(fs.existsSync(path.join(moduleDir, 'locales', 'en.json'))).toBe(true);
    expect(fs.existsSync(path.join(moduleDir, 'locales', 'zh_CN.json'))).toBe(true);
    expect(fs.existsSync(path.join(moduleDir, 'module.test.ts'))).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(path.join(moduleDir, 'module.json'), 'utf8')) as {
      defaultEnabled: boolean;
      defaultQuickOrder: number | null;
    };
    expect(manifest.defaultEnabled).toBe(false);
    expect(manifest.defaultQuickOrder).toBeNull();
    const index = fs.readFileSync(path.join(moduleDir, 'index.ts'), 'utf8');
    expect(index).not.toMatch(/TODO/);
    const registry = fs.readFileSync(path.join(root, 'generated', 'module-registry.ts'), 'utf8');
    expect(registry).toContain("'sample-tool'");
  });

  it('rejects a duplicate add', () => {
    const root = makeWorkspace();
    addModule('sample-tool', { root });
    expect(() => addModule('sample-tool', { root })).toThrow(/already exists/);
  });

  it('rejects a reserved ID', () => {
    const root = makeWorkspace();
    expect(() => addModule('core', { root })).toThrow(/reserved/);
  });

  it('removes a clean module after exact-id confirmation and regenerates', async () => {
    const root = makeWorkspace();
    addModule('sample-tool', { root });
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['commit', '-m', 'add sample-tool'], { cwd: root });
    await removeModule('sample-tool', { root, confirm: (id) => id === 'sample-tool' });
    expect(fs.existsSync(path.join(root, 'modules', 'sample-tool'))).toBe(false);
    const registry = fs.readFileSync(path.join(root, 'generated', 'module-registry.ts'), 'utf8');
    expect(registry).not.toContain('sample-tool');
  });

  it('requires exact module-id confirmation', async () => {
    const root = makeWorkspace();
    addModule('sample-tool', { root });
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['commit', '-m', 'add sample-tool'], { cwd: root });
    await expect(removeModule('sample-tool', { root, confirm: () => false })).rejects.toThrow(/not confirmed/);
    expect(fs.existsSync(path.join(root, 'modules', 'sample-tool'))).toBe(true);
  });

  it('refuses a dirty remove unless --force is explicit', async () => {
    const root = makeWorkspace();
    addModule('sample-tool', { root });
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['commit', '-m', 'add sample-tool'], { cwd: root });
    fs.appendFileSync(path.join(root, 'modules', 'sample-tool', 'index.ts'), '\n// dirty\n');
    await expect(removeModule('sample-tool', { root, confirm: () => true })).rejects.toThrow(/uncommitted/);
    expect(fs.existsSync(path.join(root, 'modules', 'sample-tool'))).toBe(true);
    await removeModule('sample-tool', { root, force: true, confirm: () => true });
    expect(fs.existsSync(path.join(root, 'modules', 'sample-tool'))).toBe(false);
  });

  it('fails closed when the removal root is not a Git worktree', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'convtools-non-git-'));
    temps.push(root);
    fs.mkdirSync(path.join(root, 'modules'));
    fs.mkdirSync(path.join(root, 'generated'));
    addModule('sample-tool', { root });
    await expect(removeModule('sample-tool', { root, confirm: () => true })).rejects.toThrow(/git status failed/);
    expect(fs.existsSync(path.join(root, 'modules', 'sample-tool'))).toBe(true);
  });

  it('does not touch the real modules directory', async () => {
    const realModules = path.resolve(process.cwd(), 'modules');
    const before = fs.existsSync(realModules) ? fs.readdirSync(realModules) : [];
    const root = makeWorkspace();
    addModule('sample-tool', { root });
    await removeModule('sample-tool', { root, force: true, confirm: () => true });
    const after = fs.existsSync(realModules) ? fs.readdirSync(realModules) : [];
    expect(after).toEqual(before);
  });
});
