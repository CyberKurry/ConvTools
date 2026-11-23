export const MODULE_HISTORY_LIMIT = 500;
export const GLOBAL_HISTORY_BYTES = 5 * 1024 * 1024;
// A single record above this size could otherwise evict the entire module's
// history on its own (defense against oversized module payloads).
export const RECORD_BYTE_LIMIT = 256 * 1024;

// Shared encoder: allocating one per estimate made every append pay a fresh
// TextEncoder on top of the serialization cost.
const encoder = new TextEncoder();

export function estimateRecordBytes(record: unknown): number {
  return encoder.encode(JSON.stringify(record)).length;
}