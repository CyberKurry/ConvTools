import { describe, expect, it } from 'vitest';
import { CARD_SIZES, CARD_TEMPLATES } from './templates';
import type { CardLocale, ShareCardInput } from './types';
import { computeLayout } from './layout';

// Fake metrics: CJK 20px, everything else 10px — same convention as the
// text-layout tests, so goldens stay stable.
const measure = (text: string): number => {
  let width = 0;
  for (const char of text) {
    width += /[\u2E80-\u9FFF\u3000-\u303F\uFF00-\uFFEF]/.test(char) ? 20 : 10;
  }
  return width;
};

function card(overrides: Partial<ShareCardInput> = {}): ShareCardInput {
  return {
    version: 1,
    excerpt: '一句话摘录',
    title: '文章标题',
    summary: '一句话摘要',
    url: 'https://example.com/a',
    siteName: 'Example Site',
    ...overrides,
  };
}

const texts = { watermarkText: '由 ConvTools 生成', qrHint: '扫码阅读原文' };

function layout(overrides: Partial<ShareCardInput> = {}, sizeId: 'portrait' | 'square' = 'portrait', locale: CardLocale = 'zh_CN') {
  return computeLayout(card(overrides), CARD_TEMPLATES.paper, CARD_SIZES[sizeId], '2026-09-07', locale, texts, measure);
}

describe('computeLayout', () => {
  it('places every block inside the canvas with no body/footer overlap', () => {
    const result = layout();
    expect(result.width).toBe(1080);
    expect(result.height).toBe(1440);
    for (const block of result.blocks) {
      expect(block.x).toBeGreaterThanOrEqual(0);
      expect(block.y).toBeGreaterThanOrEqual(0);
      if ('width' in block && typeof block.width === 'number') {
        expect(block.x + block.width).toBeLessThanOrEqual(result.width);
      }
      if ('height' in block && typeof block.height === 'number') {
        expect(block.y + block.height).toBeLessThanOrEqual(result.height);
      }
      if ('lines' in block && block.lines.length > 0) {
        expect(block.y + block.lines.length * block.lineHeight).toBeLessThanOrEqual(result.height);
      }
    }
  });

  it('includes quote, divider, title, summary, footer, qr, hint, and watermark in order', () => {
    const result = layout();
    const kinds = result.blocks.map((block) => block.kind);
    expect(kinds).toEqual(['decor', 'text', 'rule', 'text', 'text', 'text', 'text', 'qr', 'text']);
    const qr = result.blocks.find((block) => block.kind === 'qr');
    if (qr && qr.kind === 'qr') {
      expect(qr.size).toBe(180);
      // The scan hint rides on the qr block, centered under the code.
      expect(qr.hint).toMatchObject({ kind: 'text', align: 'center' });
    } else {
      throw new Error('qr block missing');
    }
  });

  it('drops the qr and hint when the url is missing and flows the footer after the summary', () => {
    const result = layout({ url: null });
    const kinds = result.blocks.map((block) => block.kind);
    expect(kinds).not.toContain('qr');
    // excerpt/title/summary/site/date/watermark — the hint is gone with the qr.
    expect(kinds.filter((kind) => kind === 'text').length).toBe(6);
    const watermark = result.blocks.at(-1);
    expect(watermark?.kind).toBe('text');
  });

  it('drops the site line only when neither site name nor url exists', () => {
    const result = layout({ url: null, siteName: null });
    const texts2 = result.blocks.filter((block) => block.kind === 'text');
    expect(texts2.some((block) => 'lines' in block && block.lines.join('').includes('example.com'))).toBe(false);
  });

  it('adapts the accent decoration per template', () => {
    const paper = computeLayout(card(), CARD_TEMPLATES.paper, CARD_SIZES.portrait, '2026-09-07', 'zh_CN', texts, measure);
    const ink = computeLayout(card(), CARD_TEMPLATES.ink, CARD_SIZES.portrait, '2026-09-07', 'zh_CN', texts, measure);
    const mist = computeLayout(card(), CARD_TEMPLATES.mist, CARD_SIZES.portrait, '2026-09-07', 'zh_CN', texts, measure);
    expect(paper.blocks[0]).toMatchObject({ kind: 'decor', variant: 'quote' });
    expect(ink.blocks[0]).toMatchObject({ kind: 'decor', variant: 'left-bar' });
    expect(mist.blocks[0]).toMatchObject({ kind: 'decor', variant: 'top-band' });
  });

  it('formats the footer date per locale', () => {
    const zh = layout({}, 'portrait', 'zh_CN');
    const en = layout({}, 'portrait', 'en');
    const zhText = JSON.stringify(zh.blocks);
    expect(zhText).toContain('2026/09/07');
    const enText = JSON.stringify(en.blocks);
    expect(enText).toContain('Sep 7, 2026');
  });

  it('fits the square size with a tighter excerpt cap', () => {
    const result = layout({}, 'square');
    expect(result.width).toBe(1080);
    expect(result.height).toBe(1080);
    const excerpt = result.blocks.find((block) => block.kind === 'text');
    expect(excerpt && 'maxLines' in excerpt ? excerpt.maxLines : 0).toBe(6);
  });

  it('reports the excerpt truncation flag', () => {
    const long = layout({ excerpt: '内容'.repeat(200) });
    expect(long.excerptTruncated).toBe(true);
    const short = layout();
    expect(short.excerptTruncated).toBe(false);
  });

  it('budgets long portrait and square content above the QR and watermark', () => {
    const long = {
      excerpt: '摘录内容'.repeat(100),
      title: '标题内容'.repeat(40),
      summary: '摘要内容'.repeat(60),
    };
    for (const sizeId of ['portrait', 'square'] as const) {
      const result = layout(long, sizeId);
      const qr = result.blocks.find((block) => block.kind === 'qr');
      const watermark = result.blocks.at(-1);
      if (!qr || qr.kind !== 'qr' || !watermark || watermark.kind !== 'text') {
        throw new Error('footer blocks missing');
      }
      for (const block of result.blocks) {
        if (block.kind === 'text' && block !== watermark && block.y < qr.y && block.lines.length > 0) {
          expect(block.y + block.lines.length * block.lineHeight).toBeLessThanOrEqual(qr.y);
        }
      }
      expect(watermark.y).toBeGreaterThanOrEqual(qr.y + qr.size + 20);
    }
  });
});
