import { formatCardDate } from './date';
import { buildQrMatrix } from './qr';
import type { CardSize, CardTemplate } from './templates';
import type { CardLocale, CardTextOverrides, ShareCardInput } from './types';
import { layoutParagraph, type Measure } from './text-layout';

export interface TextBlock {
  readonly kind: 'text';
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly lines: readonly string[];
  readonly maxLines: number;
  readonly font: string;
  readonly color: string;
  readonly lineHeight: number;
  readonly align: 'left' | 'center';
}

export interface QrBlock {
  readonly kind: 'qr';
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly matrix: readonly boolean[][];
  readonly dark: string;
  readonly tileFill: string | null;
  readonly tileRadius: number;
  readonly hint: TextBlock | null;
}

export interface RuleBlock {
  readonly kind: 'rule';
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly color: string;
}

export interface DecorBlock {
  readonly kind: 'decor';
  readonly variant: 'quote' | 'left-bar' | 'top-band';
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly text: string | null;
  readonly font: string | null;
  readonly color: string;
}

export type CardBlock = TextBlock | QrBlock | RuleBlock | DecorBlock;

export interface CardLayout {
  readonly width: number;
  readonly height: number;
  readonly background: string;
  readonly blocks: readonly CardBlock[];
  readonly excerptTruncated: boolean;
}

const PAD = 96;
const CONTENT_WIDTH = 888;
const QUOTE_ZONE = 150;
const EXCERPT_LINE_HEIGHT = 77;
const TITLE_LINE_HEIGHT = 42;
const SUMMARY_LINE_HEIGHT = 38;
const QR_SIZE = 180;
const FOOTER_GAP = 56;
const HINT_LINE_HEIGHT = 22;
const WATERMARK_ZONE = 72;

interface LayoutLineCaps {
  readonly excerptMaxLines: number;
  readonly titleMaxLines: number;
  readonly summaryMaxLines: number;
}

function textBlock(
  x: number,
  y: number,
  width: number,
  lines: readonly string[],
  maxLines: number,
  font: string,
  color: string,
  lineHeight: number,
  align: 'left' | 'center' = 'left',
): TextBlock {
  return { kind: 'text', x, y, width, lines, maxLines, font, color, lineHeight, align };
}

/**
 * Stacks the card: decoration, excerpt, divider, title, summary, then a
 * footer (site name, date, QR + hint) anchored to the bottom edge. Without a
 * URL the QR and hint disappear and the footer flows right after the summary
 * so the freed space is used (spec §5.3 degradation).
 */
export function computeLayout(
  card: ShareCardInput,
  template: CardTemplate,
  size: CardSize,
  dateIso: string,
  locale: CardLocale,
  texts: CardTextOverrides,
  measure: Measure,
): CardLayout {
  return computeLayoutWithCaps(card, template, size, dateIso, locale, texts, measure, {
    excerptMaxLines: size.excerptMaxLines,
    titleMaxLines: size.titleMaxLines,
    summaryMaxLines: size.summaryMaxLines,
  });
}

function computeLayoutWithCaps(
  card: ShareCardInput,
  template: CardTemplate,
  size: CardSize,
  dateIso: string,
  locale: CardLocale,
  texts: CardTextOverrides,
  measure: Measure,
  caps: LayoutLineCaps,
): CardLayout {
  const blocks: CardBlock[] = [];
  // The ink left bar indents the excerpt; the width shrinks by the same
  // amount so the text keeps the 96px right margin of every other block.
  const excerptInset = template.accent?.variant === 'left-bar' ? 16 : 0;
  const excerpt = layoutParagraph(card.excerpt, template.excerptFont, CONTENT_WIDTH - excerptInset, caps.excerptMaxLines, measure);
  const title = card.title === null
    ? { lines: [], truncated: false }
    : layoutParagraph(card.title, template.titleFont, CONTENT_WIDTH, caps.titleMaxLines, measure);
  const summary = card.summary === null
    ? { lines: [], truncated: false }
    : layoutParagraph(card.summary, template.summaryFont, CONTENT_WIDTH, caps.summaryMaxLines, measure);

  // Top decoration.
  let cursorY = PAD;
  if (template.accent?.variant === 'top-band') {
    blocks.push({
      kind: 'decor',
      variant: 'top-band',
      x: 0,
      y: 0,
      width: size.width,
      height: 6,
      text: null,
      font: null,
      color: template.accent.color,
    });
  }
  if (template.quote) {
    blocks.push({
      kind: 'decor',
      variant: 'quote',
      x: PAD,
      y: PAD,
      width: CONTENT_WIDTH,
      height: QUOTE_ZONE,
      text: template.quote.text,
      font: template.quote.font,
      color: template.quote.color,
    });
    cursorY = PAD + QUOTE_ZONE;
  } else {
    cursorY += template.accent?.variant === 'left-bar' ? 8 : 0;
  }
  const excerptX = PAD + excerptInset;
  const excerptLeftBar: DecorBlock | null = template.accent?.variant === 'left-bar'
    ? {
        kind: 'decor',
        variant: 'left-bar',
        x: PAD,
        y: cursorY,
        width: 4,
        height: excerpt.lines.length * EXCERPT_LINE_HEIGHT,
        text: null,
        font: null,
        color: template.accent.color,
      }
    : null;
  if (excerptLeftBar) {
    // The bar paints before the text it underlines.
    blocks.push(excerptLeftBar);
  }

  blocks.push(
    textBlock(
      excerptX,
      cursorY,
      CONTENT_WIDTH - excerptInset,
      excerpt.lines,
      caps.excerptMaxLines,
      template.excerptFont,
      template.excerptColor,
      EXCERPT_LINE_HEIGHT,
    ),
  );
  cursorY += excerpt.lines.length * EXCERPT_LINE_HEIGHT;

  if (template.dividerColor && excerpt.lines.length > 0) {
    cursorY += 40;
    blocks.push({ kind: 'rule', x: PAD, y: cursorY, width: CONTENT_WIDTH, height: 2, color: template.dividerColor });
    cursorY += 48;
  }

  if (title.lines.length > 0) {
    blocks.push(
      textBlock(PAD, cursorY, CONTENT_WIDTH, title.lines, caps.titleMaxLines, template.titleFont, template.titleColor, TITLE_LINE_HEIGHT),
    );
    cursorY += title.lines.length * TITLE_LINE_HEIGHT;
  }
  if (summary.lines.length > 0) {
    cursorY += 16;
    blocks.push(
      textBlock(
        PAD,
        cursorY,
        CONTENT_WIDTH,
        summary.lines,
        caps.summaryMaxLines,
        template.summaryFont,
        template.summaryColor,
        SUMMARY_LINE_HEIGHT,
      ),
    );
    cursorY += summary.lines.length * SUMMARY_LINE_HEIGHT;
  }

  // The footer is reserved before painting the body. If the requested line
  // caps cannot fit, reduce the body budget deterministically until every
  // body block clears the QR/footer and watermark zones.
  const footerTop = size.height - PAD - QR_SIZE - FOOTER_GAP - WATERMARK_ZONE;
  const flowFooterEnd = cursorY + 48 + (card.siteName !== null ? 34 + 26 : 0) + 24;
  const bodyEnd = card.url !== null ? cursorY : flowFooterEnd;
  const bodyLimit = card.url !== null ? footerTop - 24 : size.height - WATERMARK_ZONE - 16;
  if (bodyEnd > bodyLimit) {
    if (caps.excerptMaxLines > 1) {
      return computeLayoutWithCaps(card, template, size, dateIso, locale, texts, measure, {
        ...caps,
        excerptMaxLines: caps.excerptMaxLines - 1,
      });
    }
    if (caps.summaryMaxLines > 1) {
      return computeLayoutWithCaps(card, template, size, dateIso, locale, texts, measure, {
        ...caps,
        summaryMaxLines: caps.summaryMaxLines - 1,
      });
    }
    if (caps.titleMaxLines > 1) {
      return computeLayoutWithCaps(card, template, size, dateIso, locale, texts, measure, {
        ...caps,
        titleMaxLines: caps.titleMaxLines - 1,
      });
    }
  }

  const watermark: TextBlock = textBlock(
    PAD,
    size.height - WATERMARK_ZONE,
    CONTENT_WIDTH,
    [texts.watermarkText],
    1,
    template.watermark.font,
    template.watermark.color,
    18,
    'center',
  );

  if (card.url !== null) {
    // Bottom-anchored footer: site/date column left, QR right.
    const qrX = size.width - PAD - QR_SIZE;
    // The footer column must never run under the QR block: fit and ellipsis
    // the site name inside the measured column like every body block.
    const footerColumnWidth = Math.min(600, qrX - PAD - 16);
    const footerTexts: TextBlock[] = [];
    if (card.siteName !== null) {
      const siteLines = layoutParagraph(card.siteName, template.footerFont, footerColumnWidth, 1, measure);
      footerTexts.push(textBlock(PAD, footerTop + 24, footerColumnWidth, siteLines.lines, 1, template.footerFont, template.footerColor, 26));
    }
    footerTexts.push(
      textBlock(
        PAD,
        footerTop + 58,
        600,
        [formatCardDate(dateIso, locale)],
        1,
        template.footerFont.replace('20px', '18px'),
        template.footerColor,
        24,
      ),
    );
    const hint = textBlock(
      804,
      footerTop + QR_SIZE + 24,
      180,
      [texts.qrHint],
      1,
      template.footerFont.replace('20px', '16px'),
      template.footerColor,
      HINT_LINE_HEIGHT,
      'center',
    );
    blocks.push(...footerTexts);
    blocks.push({
      kind: 'qr',
      x: qrX,
      y: footerTop,
      size: QR_SIZE,
      matrix: buildQrMatrix(card.url),
      dark: template.qr.dark,
      tileFill: template.qr.tileFill,
      tileRadius: template.qr.tileRadius,
      hint,
    });
    blocks.push(watermark);
  } else {
    // No URL: flow the footer after the summary instead of the bottom anchor.
    cursorY += 48;
    if (card.siteName !== null) {
      const siteLines = layoutParagraph(card.siteName, template.footerFont, 600, 1, measure);
      blocks.push(textBlock(PAD, cursorY, 600, siteLines.lines, 1, template.footerFont, template.footerColor, 26));
      cursorY += 34;
    }
    blocks.push(
      textBlock(
        PAD,
        cursorY,
        600,
        [formatCardDate(dateIso, locale)],
        1,
        template.footerFont.replace('20px', '18px'),
        template.footerColor,
        24,
      ),
    );
    blocks.push(watermark);
  }

  return {
    width: size.width,
    height: size.height,
    background: template.background,
    blocks,
    excerptTruncated: excerpt.truncated,
  };
}
