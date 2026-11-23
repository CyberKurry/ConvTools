import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

function readWorkflow(): string {
  return fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8').replaceAll('\r\n', '\n');
}

describe('CI and build policy', () => {
  it('runs the quality gate on GitHub main pushes and pull requests', () => {
    const workflow = readWorkflow();
    expect(fs.existsSync(path.join(ROOT, '.cnb.yml'))).toBe(false);
    expect(workflow).toMatch(/^on:\n {2}push:\n {4}branches: \[main\]\n {2}pull_request:\n {4}branches: \[main\]$/m);

    const verify = workflow.split('\n  release:\n')[0];
    expect(verify).toMatch(/^permissions:\n {2}contents: read$/m);
    expect(verify).toContain('persist-credentials: false');
    expect(verify).toContain('pnpm install --frozen-lockfile');
    expect(verify).toContain('pnpm exec playwright install --with-deps chromium');
    expect(verify).toContain('run: pnpm check');
    expect(verify).toContain('group: convtools-ci-${{ github.ref }}');
    expect(verify).toContain('cancel-in-progress: false');
  });

  it('limits publication to verified main pushes and audits both builds before publishing', () => {
    const release = readWorkflow().split('\n  release:\n')[1];
    expect(release).toBeDefined();
    expect(release).toContain('needs: verify');
    expect(release).toContain("if: github.event_name == 'push' && github.ref == 'refs/heads/main'");
    expect(release).toContain('contents: write');
    expect(release).toMatch(/pnpm version:sync[\s\S]*pnpm build:chrome[\s\S]*pnpm build:edge[\s\S]*pnpm manifest:audit[\s\S]*gh release edit/);

    const actionRefs = [...readWorkflow().matchAll(/^\s+uses: (\S+)/gm)].map((match) => match[1]);
    expect(actionRefs.length).toBeGreaterThan(0);
    expect(actionRefs.every((ref) => /@[0-9a-f]{40}$/.test(ref ?? ''))).toBe(true);
  });

  it('builds a fresh extension before every E2E run', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    expect(packageJson.scripts?.['test:e2e']).toMatch(/^pnpm build:e2e && /);
    expect(packageJson.scripts?.check).toContain('pnpm test:e2e');
    expect(packageJson.scripts?.check).not.toContain('pnpm build:e2e && pnpm test:e2e');
  });

  it('keeps private instructions and docs ignored and untracked', () => {
    const ignored = execFileSync('git', ['check-ignore', 'AGENTS.md', 'docs/'], { cwd: ROOT, encoding: 'utf8' });
    expect(ignored).toContain('AGENTS.md');
    expect(ignored).toContain('docs/');
    expect(execFileSync('git', ['ls-files', '--', 'AGENTS.md', 'docs/'], { cwd: ROOT, encoding: 'utf8' })).toBe('');
  });
});
