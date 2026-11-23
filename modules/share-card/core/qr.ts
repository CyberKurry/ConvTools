import qrcode from 'qrcode-generator';

// qrcode-generator's default `stringToBytes` truncates every code unit with
// `charCode & 0xFF`, so '例' (U+4F8B) and '\u008B' produced identical
// matrices and every non-ASCII URL became unscannable. Register a real UTF-8
// codec explicitly (the ESM build ships no `stringToBytesFuncs`); the QR
// payload contract is UTF-8.
qrcode.stringToBytes = (value: string): number[] => [...new TextEncoder().encode(value)];

export class QrEncodeError extends Error {
  readonly code = 'QR_ENCODE_FAILED';
  constructor(message = 'qr text is empty') {
    super(message);
    this.name = 'QrEncodeError';
  }
}

// The pinned library's default encoder truncates char codes to Latin1
// (`charCodeAt(& 0xff)`), silently corrupting non-ASCII payloads. Route every
// payload through UTF-8 explicitly so the matrix matches the confirmed text.
qrcode.stringToBytes = (text: string): number[] => Array.from(new TextEncoder().encode(text));

/**
 * Encodes text into a square boolean matrix (true = dark module) using the
 * pinned qrcode-generator: automatic version, error correction M, UTF-8
 * bytes. Pure computation — no DOM, no network.
 */
export function buildQrMatrix(text: string): readonly boolean[][] {
  const trimmed = text.trim();
  if (trimmed === '') {
    throw new QrEncodeError();
  }
  const qr = qrcode(0, 'M');
  qr.addData(trimmed);
  qr.make();
  const count = qr.getModuleCount();
  const matrix: boolean[][] = [];
  for (let row = 0; row < count; row += 1) {
    const line: boolean[] = [];
    for (let col = 0; col < count; col += 1) {
      line.push(qr.isDark(row, col));
    }
    matrix.push(line);
  }
  return matrix;
}
