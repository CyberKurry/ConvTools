export type Measure = (text: string, font: string) => number;

/** Punctuation that may not begin a wrapped line. */
const LINE_START_FORBIDDEN = new Set([...('，。、；：！？）】」』》…—’”')]);
/** Punctuation that may not end a wrapped line. */
const LINE_END_FORBIDDEN = new Set([...('「『（‘“')]);

/**
 * Splits text into wrap units: latin/digit runs stay whole words, every CJK
 * character (and any other glyph, including surrogate-pair emoji) is its own
 * unit, and whitespace separates words without ever starting a line.
 */
function tokenize(text: string): string[] {
  return text.match(/[A-Za-z0-9]+|\s|[\s\S]/gu) ?? [];
}

/**
 * Greedy wrapper for canvas text: honors line-start/line-end kinsoku rules
 * (forbidden marks hang on the previous line or move down with their
 * neighbour), never splits a surrogate pair, and clamps to `maxLines` with a
 * CJK-safe ellipsis when content overflows.
 */
export function layoutParagraph(
  text: string,
  font: string,
  maxWidth: number,
  maxLines: number,
  measure: Measure,
): { lines: string[]; truncated: boolean } {
  const lines: string[] = [];
  let current = '';

  const pushCurrent = (): void => {
    const trimmed = current.trimEnd();
    if (trimmed !== '') {
      lines.push(trimmed);
    }
    current = '';
  };

  const appendMeasuredUnit = (unit: string): void => {
    for (const char of Array.from(unit)) {
      if (current !== '' && measure(current + char, font) > maxWidth) {
        pushCurrent();
      }
      current += char;
    }
  };

  for (const unit of tokenize(text)) {
    const isWhitespace = /^\s$/.test(unit);
    if (isWhitespace) {
      if (current === '') {
        continue;
      }
      if (measure(current + unit, font) <= maxWidth) {
        current += unit;
      } else {
        pushCurrent();
      }
      continue;
    }

    const candidate = current + unit;
    if (current !== '' && measure(candidate, font) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (!isWhitespace && LINE_START_FORBIDDEN.has(unit)) {
      // Hanging punctuation: keep it on this line even if it overflows.
      current = candidate;
      continue;
    }
    if (current === '') {
      // Long Latin tokens still need a measured hard wrap; placing the whole
      // token would let canvas painting clip past the card edge.
      appendMeasuredUnit(unit);
      continue;
    }
    let lineEnd = current;
    let carry = unit;
    while (lineEnd.length > 0 && LINE_END_FORBIDDEN.has(lineEnd.at(-1) ?? '')) {
      const last = lineEnd.at(-1) ?? '';
      carry = last + carry;
      lineEnd = lineEnd.slice(0, -1);
    }
    current = lineEnd;
    pushCurrent();
    appendMeasuredUnit(carry);
  }
  if (current !== '') {
    pushCurrent();
  }

  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    const last = (kept[maxLines - 1] ?? '').trimEnd();
    kept[maxLines - 1] = fitEllipsis(last, font, maxWidth, measure);
    return { lines: kept, truncated: true };
  }
  return { lines, truncated: false };
}

function fitEllipsis(line: string, font: string, maxWidth: number, measure: Measure): string {
  if (measure(`${line}…`, font) <= maxWidth) {
    return `${line}…`;
  }
  const codePoints = Array.from(line);
  while (codePoints.length > 0 && measure(`${codePoints.join('')}…`, font) > maxWidth) {
    codePoints.pop();
  }
  return `${codePoints.join('')}…`;
}
