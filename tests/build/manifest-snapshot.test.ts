import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

function normalize(manifest: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...manifest } as Record<string, unknown>;
  // Nondeterministic fields that legitimately differ between browsers.
  const background = copy.background as { service_worker?: string } | undefined;
  if (background && typeof background === 'object') {
    delete background.service_worker;
  }
  return copy;
}

describe('manifest snapshots', () => {
  it.each(['chrome', 'edge'] as const)('matches the committed %s snapshot for stable fields', (target) => {
    const builtPath = path.join(ROOT, '.output', `${target}-mv3`, 'manifest.json');
    // Gate integrity (AGENTS): a missing artifact must fail loudly instead of
    // silently passing; run `pnpm build:chrome` / `pnpm build:edge` first.
    // `pnpm check` orders the builds before `pnpm test` for this reason.
    if (!fs.existsSync(builtPath)) {
      throw new Error(
        `missing ${builtPath}; build the ${target} target (pnpm build:${target}) before running the snapshot gate`,
      );
    }
    const snapshotPath = path.join(ROOT, 'tests', 'build', 'snapshots', `${target}-manifest.json`);
    const built = JSON.parse(fs.readFileSync(builtPath, 'utf8')) as Record<string, unknown>;
    const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8')) as Record<string, unknown>;
    expect(normalize(built)).toEqual(normalize(snapshot));
  });
});