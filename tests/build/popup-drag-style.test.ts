import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

describe('popup drag affordance styles', () => {
  it('reserves pointer gestures for draggable tabs and exposes grab feedback', () => {
    const css = fs.readFileSync(path.join(ROOT, 'entrypoints', 'popup', 'PopupApp.module.css'), 'utf8');
    const tabRule = css.match(/\.tab\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';

    expect(tabRule).toContain('touch-action: none;');
    expect(tabRule).toContain('cursor: grab;');
    expect(css).toMatch(/\.tab:active\s*\{[\s\S]*cursor:\s*grabbing;/);
  });
});
