import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const ASSET = path.join(ROOT, 'assets', 'extension-icon.svg');
const ICONS = ['16.png', '32.png', '48.png', '128.png'].map((n) => path.join(ROOT, 'public', 'icon', n));

function pngSignature(buf: Uint8Array): boolean {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return signature.every((byte, i) => buf[i] === byte);
}

async function alphaBounds(file: string): Promise<{ minX: number; minY: number; maxX: number; maxY: number }> {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const alpha = data[(y * info.width + x) * info.channels + 3];
      if (alpha !== undefined && alpha > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { minX, minY, maxX, maxY };
}

describe('extension icons', () => {
  it('has a source SVG brand mark', () => {
    expect(fs.existsSync(ASSET)).toBe(true);
  });

  it('renders all four PNG sizes', () => {
    for (const icon of ICONS) {
      expect(fs.existsSync(icon)).toBe(true);
    }
  });

  it.each([
    [16, 16],
    [32, 32],
    [48, 48],
    [128, 128],
  ] as const)('renders %i.png at exactly %ix%i', (sizePx, expected) => {
    const buf = fs.readFileSync(path.join(ROOT, 'public', 'icon', `${sizePx}.png`));
    expect(pngSignature(buf)).toBe(true);
    // width at byte 16, height at byte 20 (big-endian uint32).
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    expect(width).toBe(expected);
    expect(height).toBe(expected);
  });

  it('renders non-empty, non-blank alpha bounds in every size', async () => {
    for (const icon of ICONS) {
      const bounds = await alphaBounds(icon);
      expect(bounds.minX).toBeLessThanOrEqual(bounds.maxX);
      expect(bounds.minY).toBeLessThanOrEqual(bounds.maxY);
      expect(bounds.maxX - bounds.minX).toBeGreaterThan(0);
      expect(bounds.maxY - bounds.minY).toBeGreaterThan(0);
    }
  });
});