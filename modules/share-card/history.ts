import type { NamespacedHistory } from '../../core/module-sdk/context';
import { CARD_SIZES } from './core/templates';
import type { SizeId, TemplateId } from './core/types';

export interface CardExportInfo {
  readonly template: TemplateId;
  readonly sizeId: SizeId;
  readonly bytes: number;
  /** The page url encoded in the card's QR code; null when the card had none. */
  readonly sourceUrl: string | null;
}

export function cardFileName(template: TemplateId, sizeId: SizeId): string {
  const size = CARD_SIZES[sizeId];
  return `share-card-${template}-${size.width * 2}x${size.height * 2}.png`;
}

/**
 * Records an export as file metadata only: name, byte size, mime, and the
 * source url the QR code encoded (spec §4.4/D4). No excerpt text, no image
 * bytes. Failures are swallowed — history must never break an export.
 */
export async function appendCardHistory(history: NamespacedHistory, info: CardExportInfo): Promise<void> {
  try {
    await history.append({
      kind: 'file',
      action: 'generate',
      name: cardFileName(info.template, info.sizeId),
      size: info.bytes,
      mime: 'image/png',
      ...(info.sourceUrl !== null && { sourceUrl: info.sourceUrl }),
    });
  } catch {
    // appendHistorySafely semantics: quota or persistence failures must not
    // surface to the user or undo the export.
  }
}
