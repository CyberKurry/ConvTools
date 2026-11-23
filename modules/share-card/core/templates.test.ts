import { describe, expect, it } from 'vitest';
import {
  CARD_SIZES,
  CARD_TEMPLATES,
  contrastRatio,
  relativeLuminance,
  validateTemplates,
} from './templates';

describe('card templates', () => {
  it('compute contrast from WCAG relative luminance', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#ffffff')).toBe(1);
    // White on pure black is the maximal ratio.
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 0);
  });

  it('expose the three approved templates and two sizes', () => {
    expect(Object.keys(CARD_TEMPLATES).sort()).toEqual(['ink', 'mist', 'paper']);
    expect(Object.keys(CARD_SIZES).sort()).toEqual(['portrait', 'square']);
    expect(CARD_SIZES.portrait).toMatchObject({ width: 1080, height: 1440, excerptMaxLines: 8 });
    expect(CARD_SIZES.square).toMatchObject({ width: 1080, height: 1080, excerptMaxLines: 6 });
  });

  it('pass the body-text contrast audit', () => {
    expect(() => validateTemplates()).not.toThrow();
  });

  it('mark the watermark as decorative and exempt from the audit', () => {
    for (const template of Object.values(CARD_TEMPLATES)) {
      expect(template.watermark.decorative).toBe(true);
    }
    // The watermark grey would fail a 4.5:1 body audit on paper white.
    expect(contrastRatio(CARD_TEMPLATES.paper.watermark.color, CARD_TEMPLATES.paper.background)).toBeLessThan(4.5);
  });

  it('give the ink template a white qr tile so scanning contrast holds', () => {
    const ink = CARD_TEMPLATES.ink;
    expect(ink.qr.tileFill).toBe('#ffffff');
    expect(ink.qr.tileRadius).toBeGreaterThan(0);
    expect(contrastRatio(ink.qr.dark, '#ffffff')).toBeGreaterThan(4.5);
  });
});
