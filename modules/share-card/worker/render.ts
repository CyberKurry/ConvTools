import { computeLayout } from '../core/layout';
import { EXCERPT_MAX_CHARS, SUMMARY_MAX_CHARS, TITLE_MAX_CHARS } from '../core/limits';
import { normalizeCardText, normalizeUrl, SITE_NAME_MAX_CHARS } from '../core/meta';
import { paintCard } from '../core/paint';
import { CARD_SIZES, CARD_TEMPLATES } from '../core/templates';
import type { CardSpec } from './protocol';

/** Adapts the real 2d context to the structural paint surface. */
function adapt(ctx: OffscreenCanvasRenderingContext2D) {
  return {
    fillRect(x: number, y: number, width: number, height: number, color: string): void {
      ctx.fillStyle = color;
      ctx.fillRect(x, y, width, height);
    },
    roundRect(x: number, y: number, width: number, height: number, radius: number, color: string): void {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(x, y, width, height, radius);
      ctx.fill();
    },
    fillText(text: string, x: number, y: number, font: string, color: string, align: 'left' | 'center'): void {
      ctx.font = font;
      ctx.fillStyle = color;
      ctx.textAlign = align;
      ctx.fillText(text, x, y);
    },
  };
}

/**
 * Renders one card at `scale` onto an OffscreenCanvas and returns the PNG
 * bytes. Everything is deterministic: the spec carries pre-resolved text,
 * the date, and the template/size ids; no clock, randomness, or locale
 * services run inside the worker.
 */
export async function renderCardToBuffer(
  spec: CardSpec,
  scale: 1 | 2,
): Promise<{ buffer: ArrayBuffer; width: number; height: number; excerptTruncated: boolean }> {
  assertCardSpec(spec, scale);
  const template = CARD_TEMPLATES[spec.templateId];
  const size = CARD_SIZES[spec.sizeId];
  const probe = new OffscreenCanvas(8, 8);
  const probeCtx = probe.getContext('2d');
  if (!probeCtx) {
    throw new Error('CARD_CANVAS_UNAVAILABLE');
  }
  const measure = (text: string, font: string): number => {
    probeCtx.font = font;
    return probeCtx.measureText(text).width;
  };

  const layout = computeLayout(
    {
      version: 1,
      excerpt: spec.excerpt,
      title: spec.title,
      summary: spec.summary,
      url: spec.url,
      siteName: spec.siteName,
    },
    template,
    size,
    spec.dateIso,
    spec.locale,
    { watermarkText: spec.watermarkText, qrHint: spec.qrHint },
    measure,
  );

  const canvas = new OffscreenCanvas(layout.width * scale, layout.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('CARD_CANVAS_UNAVAILABLE');
  }
  ctx.scale(scale, scale);
  paintCard(adapt(ctx), layout);

  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const buffer = await blob.arrayBuffer();
  return { buffer, width: canvas.width, height: canvas.height, excerptTruncated: layout.excerptTruncated };
}

/** Typed job-integrity failure the worker passes through unchanged. */
function invalidJob(): never {
  throw Object.assign(new Error('invalid card render spec'), { code: 'INVALID_CARD_JOB' });
}

function assertCardSpec(spec: CardSpec, scale: 1 | 2): void {
  if (scale !== 1 && scale !== 2) {
    invalidJob();
  }
  if (!Object.prototype.hasOwnProperty.call(CARD_TEMPLATES, spec.templateId) ||
      !Object.prototype.hasOwnProperty.call(CARD_SIZES, spec.sizeId) ||
      (spec.locale !== 'en' && spec.locale !== 'zh_CN') ||
      !/^\d{4}-\d{2}-\d{2}$/.test(spec.dateIso) ||
      spec.watermarkText.length > 200 || spec.qrHint.length > 200) {
    invalidJob();
  }
  if (normalizeCardText(spec.excerpt, EXCERPT_MAX_CHARS) !== spec.excerpt ||
      (spec.title !== null && normalizeCardText(spec.title, TITLE_MAX_CHARS) !== spec.title) ||
      (spec.summary !== null && normalizeCardText(spec.summary, SUMMARY_MAX_CHARS) !== spec.summary) ||
      (spec.siteName !== null && normalizeCardText(spec.siteName, SITE_NAME_MAX_CHARS) !== spec.siteName) ||
      (spec.url !== null && normalizeUrl(spec.url) !== spec.url)) {
    invalidJob();
  }
}
