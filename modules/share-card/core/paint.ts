import type { CardLayout } from './layout';

/**
 * Minimal structural drawing surface. The worker adapts a real
 * OffscreenCanvasRenderingContext2D to this; tests record calls instead, so
 * layout painting is verifiable without a canvas implementation.
 */
export interface PaintContext {
  fillRect(x: number, y: number, width: number, height: number, color: string): void;
  roundRect(x: number, y: number, width: number, height: number, radius: number, color: string): void;
  fillText(text: string, x: number, y: number, font: string, color: string, align: 'left' | 'center'): void;
}

export type PaintOp =
  | { op: 'rect'; x: number; y: number; width: number; height: number; color: string }
  | { op: 'roundRect'; x: number; y: number; width: number; height: number; radius: number; color: string }
  | { op: 'text'; text: string; x: number; y: number; font: string; color: string; align: string };

/** Baseline offset inside a line box so wrapped rows keep their leading. */
function baseline(lineHeight: number): number {
  return Math.round(lineHeight * 0.78);
}

/**
 * Paints the layout in block order. The qr code keeps a 4-module quiet zone
 * inside its box, and optional tiles (ink) are drawn under the matrix.
 */
export function paintCard(ctx: PaintContext, layout: CardLayout): void {
  ctx.fillRect(0, 0, layout.width, layout.height, layout.background);

  for (const block of layout.blocks) {
    if (block.kind === 'decor') {
      if (block.text !== null && block.font !== null) {
        ctx.fillText(block.text, block.x, block.y + block.height - 18, block.font, block.color, 'left');
      } else {
        ctx.fillRect(block.x, block.y, block.width, block.height, block.color);
      }
      continue;
    }
    if (block.kind === 'rule') {
      ctx.fillRect(block.x, block.y, block.width, block.height, block.color);
      continue;
    }
    if (block.kind === 'text') {
      for (let index = 0; index < block.lines.length; index += 1) {
        const line = block.lines[index] ?? '';
        const x = block.align === 'center' ? block.x + block.width / 2 : block.x;
        ctx.fillText(line, x, block.y + index * block.lineHeight + baseline(block.lineHeight), block.font, block.color, block.align);
      }
      continue;
    }
    // qr block
    if (block.tileFill !== null) {
      ctx.roundRect(block.x, block.y, block.size, block.size, block.tileRadius, block.tileFill);
    }
    const quietModules = 4;
    const cell = block.size / (block.matrix.length + quietModules * 2);
    const originX = block.x + quietModules * cell;
    const originY = block.y + quietModules * cell;
    for (let row = 0; row < block.matrix.length; row += 1) {
      const line = block.matrix[row] ?? [];
      for (let col = 0; col < line.length; col += 1) {
        if (line[col] === true) {
          // Snap each module to integer pixel spans: fractional fillRects
          // leave antialiasing seams between adjacent dark modules.
          const left = Math.round(originX + col * cell);
          const top = Math.round(originY + row * cell);
          const right = Math.round(originX + (col + 1) * cell);
          const bottom = Math.round(originY + (row + 1) * cell);
          ctx.fillRect(left, top, right - left, bottom - top, block.dark);
        }
      }
    }
    if (block.hint) {
      for (let index = 0; index < block.hint.lines.length; index += 1) {
        const line = block.hint.lines[index] ?? '';
        ctx.fillText(
          line,
          block.hint.x + block.hint.width / 2,
          block.hint.y + index * block.hint.lineHeight + baseline(block.hint.lineHeight),
          block.hint.font,
          block.hint.color,
          block.hint.align,
        );
      }
    }
  }
}
