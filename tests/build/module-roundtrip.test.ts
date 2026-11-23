import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { addModule, removeModule } from '../../scripts/module-cli';
import { generateCommittedArtifacts } from '../../scripts/generate-modules';

const temps: string[] = [];

function makeWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'convtools-roundtrip-'));
  temps.push(root);
  fs.mkdirSync(path.join(root, 'modules'), { recursive: true });
  fs.mkdirSync(path.join(root, 'generated'), { recursive: true });
  return root;
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('module roundtrip', () => {
  it('a third temporary module appears and disappears without editing core', async () => {
    const root = makeWorkspace();
    addModule('extra-probe', { root });
    const withModule = generateCommittedArtifacts({ root });
    const manifestText = fs.readFileSync(path.join(root, 'generated', 'module-manifest.ts'), 'utf8');
    expect(manifestText).toContain('extra-probe');
    expect(withModule.length).toBeGreaterThan(0);

    await removeModule('extra-probe', { root, force: true, confirm: () => true });
    generateCommittedArtifacts({ root });
    const after = fs.readFileSync(path.join(root, 'generated', 'module-manifest.ts'), 'utf8');
    expect(after).not.toContain('extra-probe');
  });
});