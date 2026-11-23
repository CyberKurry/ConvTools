import { describe, expect, it } from 'vitest';
import { CARD_SIZES, CARD_TEMPLATES } from './templates';
import type { ShareCardInput } from './types';
import { computeLayout, type CardBlock } from './layout';
import { paintCard, type PaintContext, type PaintOp } from './paint';

const measure = (text: string): number => text.length * 10;

function card(overrides: Partial<ShareCardInput> = {}): ShareCardInput {
  return {
    version: 1,
    excerpt: '摘录文字',
    title: '标题',
    summary: '摘要',
    url: 'https://example.com/a',
    siteName: 'Example',
    ...overrides,
  };
}

class RecordingCtx implements PaintContext {
  readonly ops: PaintOp[] = [];

  fillRect(x: number, y: number, width: number, height: number, color: string): void {
    this.ops.push({ op: 'rect', x, y, width, height, color });
  }

  roundRect(x: number, y: number, width: number, height: number, radius: number, color: string): void {
    this.ops.push({ op: 'roundRect', x, y, width, height, radius, color });
  }

  fillText(text: string, x: number, y: number, font: string, color: string, align: string): void {
    this.ops.push({ op: 'text', text, x, y, font, color, align });
  }
}

function paintAll(overrides: Partial<ShareCardInput> = {}, sizeId: 'portrait' | 'square' = 'portrait') {
  const layout = computeLayout(
    card(overrides),
    CARD_TEMPLATES.paper,
    CARD_SIZES[sizeId],
    '2026-09-07',
    'zh_CN',
    { watermarkText: 'W', qrHint: '扫码' },
    measure,
  );
  const ctx = new RecordingCtx();
  paintCard(ctx, layout);
  return { ctx, layout };
}

describe('paintCard', () => {
  it('paints the background first and every glyph/rect inside the canvas', () => {
    const { ctx, layout } = paintAll();
    expect(ctx.ops[0]).toMatchObject({ op: 'rect', x: 0, y: 0, width: layout.width, height: layout.height });
    for (const op of ctx.ops) {
      if (op.op === 'text') {
        // Text ops carry no width/height; just the anchor must be in-bounds.
        expect(op.x).toBeGreaterThanOrEqual(0);
        expect(op.y).toBeGreaterThanOrEqual(0);
        continue;
      }
      expect(op.x + op.width).toBeLessThanOrEqual(layout.width);
      expect(op.y + op.height).toBeLessThanOrEqual(layout.height);
    }
  });

  it('draws every dark qr module strictly inside the qr block bounds', () => {
    const { ctx, layout } = paintAll();
    const qr = layout.blocks.find((block: CardBlock) => block.kind === 'qr');
    if (!qr || qr.kind !== 'qr') {
      throw new Error('qr block missing');
    }
    const moduleOps = ctx.ops.filter((op): op is Extract<PaintOp, { op: 'rect' }> => op.op === 'rect' && op.width < 10 && op.height < 10);
    expect(moduleOps.length).toBeGreaterThan(50);
    for (const op of moduleOps) {
      expect(op.x).toBeGreaterThanOrEqual(qr.x);
      expect(op.y).toBeGreaterThanOrEqual(qr.y);
      expect(op.x + op.width).toBeLessThanOrEqual(qr.x + qr.size);
      expect(op.y + op.height).toBeLessThanOrEqual(qr.y + qr.size);
    }
  });

  it('does not overlap the excerpt text with the footer qr', () => {
    const { ctx, layout } = paintAll({ excerpt: '长句子'.repeat(60) });
    const qr = layout.blocks.find((block) => block.kind === 'qr');
    if (!qr || qr.kind !== 'qr') {
      throw new Error('qr block missing');
    }
    const excerptFont = CARD_TEMPLATES.paper.excerptFont;
    const excerptOps = ctx.ops.filter((op) => op.op === 'text' && op.font === excerptFont);
    expect(excerptOps.length).toBeGreaterThan(0);
    for (const op of excerptOps) {
      expect(op.y + 77).toBeLessThanOrEqual(qr.y + 1);
    }
  });

  it('applies the template palette (background and text colors)', () => {
    const inkLayout = computeLayout(
      card(),
      CARD_TEMPLATES.ink,
      CARD_SIZES.portrait,
      '2026-09-07',
      'zh_CN',
      { watermarkText: 'W', qrHint: '扫码' },
      measure,
    );
    const ctx = new RecordingCtx();
    paintCard(ctx, inkLayout);
    expect(ctx.ops[0]).toMatchObject({ color: CARD_TEMPLATES.ink.background });
    expect(ctx.ops.some((op) => op.color === CARD_TEMPLATES.ink.excerptColor)).toBe(true);
    // Ink draws a white tile under its qr code.
    expect(ctx.ops.some((op) => (op.op === 'roundRect' || op.op === 'rect') && op.color === '#ffffff')).toBe(true);
  });

  it('centers the watermark', () => {
    const { ctx } = paintAll();
    const watermark = ctx.ops.find((op) => op.op === 'text' && op.text === 'W');
    if (!watermark || watermark.op !== 'text') {
      throw new Error('watermark not painted');
    }
    expect(watermark.align).toBe('center');
  });
});
