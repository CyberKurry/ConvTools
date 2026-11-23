import { describe, expect, it } from 'vitest';
import { estimateRecordBytes, GLOBAL_HISTORY_BYTES, MODULE_HISTORY_LIMIT } from '../../../core/history/quota';

describe('history quota', () => {
  it('estimates UTF-8 bytes from serialized records', () => {
    expect(estimateRecordBytes({ kind: 'text', input: '你好' })).toBeGreaterThan(10);
  });

  it('exposes the approved per-module and global limits', () => {
    expect(MODULE_HISTORY_LIMIT).toBe(500);
    expect(GLOBAL_HISTORY_BYTES).toBe(5 * 1024 * 1024);
  });
});
