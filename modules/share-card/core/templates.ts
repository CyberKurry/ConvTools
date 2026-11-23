export interface CardTemplate {
  readonly id: 'paper' | 'ink' | 'mist';
  readonly background: string;
  readonly quote: { readonly text: string; readonly font: string; readonly color: string } | null;
  readonly accent: { readonly variant: 'left-bar' | 'top-band'; readonly color: string } | null;
  readonly excerptFont: string;
  readonly excerptColor: string;
  readonly dividerColor: string | null;
  readonly titleFont: string;
  readonly titleColor: string;
  readonly summaryFont: string;
  readonly summaryColor: string;
  readonly footerFont: string;
  readonly footerColor: string;
  readonly watermark: { readonly font: string; readonly color: string; readonly decorative: true };
  readonly qr: { readonly dark: string; readonly tileFill: string | null; readonly tileRadius: number };
}

const SERIF = 'Georgia, "Noto Serif SC", "Songti SC", SimSun, serif';
const SANS = '-apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';

export const CARD_TEMPLATES: Record<'paper' | 'ink' | 'mist', CardTemplate> = {
  paper: {
    id: 'paper',
    background: '#ffffff',
    quote: { text: '\u201C', font: `700 160px ${SERIF}`, color: '#e2e8f0' },
    accent: null,
    excerptFont: `500 44px ${SERIF}`,
    excerptColor: '#1f2937',
    dividerColor: '#e5e7eb',
    titleFont: `600 30px ${SANS}`,
    titleColor: '#111827',
    summaryFont: `400 24px ${SANS}`,
    summaryColor: '#6b7280',
    footerFont: `400 20px ${SANS}`,
    footerColor: '#6b7280',
    watermark: { font: `400 14px ${SANS}`, color: '#9ca3af', decorative: true },
    qr: { dark: '#111827', tileFill: null, tileRadius: 0 },
  },
  ink: {
    id: 'ink',
    background: '#0d1117',
    quote: null,
    accent: { variant: 'left-bar', color: '#2f81f7' },
    excerptFont: `500 44px ${SERIF}`,
    excerptColor: '#e6edf3',
    dividerColor: '#30363d',
    titleFont: `600 30px ${SANS}`,
    titleColor: '#f0f6fc',
    summaryFont: `400 24px ${SANS}`,
    summaryColor: '#8b949e',
    footerFont: `400 20px ${SANS}`,
    footerColor: '#8b949e',
    watermark: { font: `400 14px ${SANS}`, color: '#6e7681', decorative: true },
    qr: { dark: '#0d1117', tileFill: '#ffffff', tileRadius: 12 },
  },
  mist: {
    id: 'mist',
    background: '#f8fafc',
    quote: null,
    accent: { variant: 'top-band', color: '#0969da' },
    excerptFont: `500 44px ${SERIF}`,
    excerptColor: '#0f172a',
    dividerColor: '#e2e8f0',
    titleFont: `600 30px ${SANS}`,
    titleColor: '#111827',
    summaryFont: `400 24px ${SANS}`,
    summaryColor: '#6b7280',
    footerFont: `400 20px ${SANS}`,
    footerColor: '#6b7280',
    watermark: { font: `400 14px ${SANS}`, color: '#9ca3af', decorative: true },
    qr: { dark: '#111827', tileFill: null, tileRadius: 0 },
  },
};

export interface CardSize {
  readonly id: 'portrait' | 'square';
  readonly width: number;
  readonly height: number;
  readonly excerptMaxLines: number;
  readonly titleMaxLines: number;
  readonly summaryMaxLines: number;
}

export const CARD_SIZES: Record<'portrait' | 'square', CardSize> = {
  portrait: { id: 'portrait', width: 1080, height: 1440, excerptMaxLines: 8, titleMaxLines: 2, summaryMaxLines: 3 },
  square: { id: 'square', width: 1080, height: 1080, excerptMaxLines: 6, titleMaxLines: 2, summaryMaxLines: 3 },
};

function channel(value: string): number {
  const normalized = Number.parseInt(value, 16) / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance for #rrggbb colors. */
export function relativeLuminance(hex: string): number {
  const digits = hex.replace('#', '');
  const r = channel(digits.slice(0, 2));
  const g = channel(digits.slice(2, 4));
  const b = channel(digits.slice(4, 6));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Build-time audit (run in tests): body text pairs must reach WCAG AA 4.5:1.
 * The watermark is a decorative mark and is explicitly exempt; QR contrast
 * is validated against the white tile the code is always drawn on.
 */
export function validateTemplates(): void {
  for (const template of Object.values(CARD_TEMPLATES)) {
    const bodyPairs: Array<[string, string]> = [
      [template.excerptColor, template.background],
      [template.titleColor, template.background],
      [template.summaryColor, template.background],
      [template.footerColor, template.background],
    ];
    for (const [foreground, background] of bodyPairs) {
      if (contrastRatio(foreground, background) < 4.5) {
        throw new Error(`template ${template.id}: body contrast below 4.5 (${foreground} on ${background})`);
      }
    }
    if (contrastRatio(template.qr.dark, '#ffffff') < 4.5) {
      throw new Error(`template ${template.id}: qr contrast below 4.5`);
    }
  }
}
