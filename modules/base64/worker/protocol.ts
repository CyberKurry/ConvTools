import { MAX_INPUT_BYTES } from '../core/limits';
import type { Base64Format, Base64Mode } from '../core/types';

/** Files share the module-wide input ceiling (spec §11.2). */
export const MAX_FILE_BYTES = MAX_INPUT_BYTES;
export const WORKING_CHUNK_BYTES = 256 * 1024;

export type FileJobKind = 'encode' | 'decode';

export interface FileJobRequest {
  readonly kind: FileJobKind;
  readonly buffer: ArrayBuffer;
  readonly format: Base64Format;
  readonly mode: Base64Mode;
  readonly mime?: string;
  readonly chunkSize?: number;
}

export interface FileProgressMessage {
  readonly type: 'progress';
  readonly completedBytes: number;
  readonly totalBytes: number;
}

export interface FileResultMessage {
  readonly type: 'result';
  readonly chunks: ArrayBuffer[];
  readonly mime: string | null;
  readonly textPreview: string | null;
  // False when the preview was cut at the sample window, so the rest of the
  // payload was not decoded as text.
  readonly textPreviewComplete: boolean;
  readonly corrections: string[];
  readonly maxWorkingChunkBytes: number;
  readonly completedBytes: number;
}

export interface FileErrorMessage {
  readonly type: 'error';
  readonly code: string;
  readonly message: string;
}

export type FileWorkerMessage = FileProgressMessage | FileResultMessage | FileErrorMessage;