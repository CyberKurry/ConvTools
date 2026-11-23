export interface HistoryTextRecord {
  readonly kind: 'text';
  readonly id?: number;
  readonly moduleId: string;
  readonly action: string;
  readonly createdAt: number;
  readonly input: string;
  readonly output: string;
  // Module-specific payload fields (spec §11.3/§12.3: normalization info,
  // output format, and timezone travel with text records).
  readonly format?: string;
  readonly corrections?: readonly string[];
  readonly timeZone?: string;
}

export interface HistoryFileRecord {
  readonly kind: 'file';
  readonly id?: number;
  readonly moduleId: string;
  readonly action: string;
  readonly createdAt: number;
  readonly name: string;
  readonly size: number;
  readonly mime: string;
  /**
   * The origin the file was produced from (e.g. the page URL a share card's
   * QR code encodes). Stored verbatim on the local machine only; it never
   * enters logs and disappears with the record.
   */
  readonly sourceUrl?: string;
}

export type HistoryRecord = HistoryTextRecord | HistoryFileRecord;
