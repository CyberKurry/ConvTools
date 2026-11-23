import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

/**
 * Chromium attributes every `modulepreload` link in an extension page to a
 * "cross-world extension resource mismatch" console warning (plus the delayed
 * "preloaded but not used" warning). For unpacked extensions those warnings
 * land in the chrome://extensions error console and light up the Errors
 * button, so the build must not emit the links at all. Extension chunks are
 * local resources; dropping the hints costs nothing.
 */
describe('built extension pages', () => {
  it.each(['chrome', 'edge'] as const)('emit no modulepreload links (%s target)', (target) => {
    const outputDir = path.join(ROOT, '.output', `${target}-mv3`);
    // Gate integrity (AGENTS): a missing artifact must fail loudly instead of
    // silently passing; `pnpm check` orders the builds before `pnpm test`.
    if (!fs.existsSync(outputDir)) {
      throw new Error(`missing ${outputDir}; build the ${target} target (pnpm build:${target}) first`);
    }
    const offenders: string[] = [];
    for (const entry of fs.readdirSync(outputDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.html')) {
        continue;
      }
      const html = fs.readFileSync(path.join(outputDir, entry.name), 'utf8');
      if (/rel=["']modulepreload["']/.test(html)) {
        offenders.push(entry.name);
      }
    }
    expect(offenders).toEqual([]);
  });
});
