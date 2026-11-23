import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { createHistoryService } from '../../../core/history/history-service';
import { HISTORY_DB_NAME } from '../../../core/history/indexed-db';
import { createSelectionHistoryRecorder } from '../../../core/history/selection-history';
import { MemoryArea } from '../../../core/storage/browser-storage';

afterEach(() => {
  void indexedDB.deleteDatabase(HISTORY_DB_NAME);
});

async function storedRecords(moduleId: string) {
  const reader = createHistoryService({ enabled: true, incognito: false });
  return reader.list(moduleId);
}

describe('selection history recorder', () => {
  it('writes a purified record when the local history toggle is on', async () => {
    const local = new MemoryArea();
    await local.set({ historyEnabled: true });
    const recorder = createSelectionHistoryRecorder({ incognito: false, local });

    await recorder.append('base64', {
      kind: 'text',
      action: 'encode',
      input: 'hello',
      output: 'aGVsbG8=',
      format: 'standard',
      corrections: [],
    });

    const records = await storedRecords('base64');
    expect(records).toHaveLength(1);
    const record = records[0];
    expect(record).toMatchObject({
      moduleId: 'base64',
      kind: 'text',
      action: 'encode',
      input: 'hello',
      output: 'aGVsbG8=',
      format: 'standard',
      corrections: [],
    });
    expect(typeof record?.createdAt).toBe('number');
  });

  it('records nothing when the toggle is missing or off', async () => {
    const off = new MemoryArea();
    await off.set({ historyEnabled: false });
    const offRecorder = createSelectionHistoryRecorder({ incognito: false, local: off });
    await offRecorder.append('base64', { kind: 'text', action: 'encode', input: 'a', output: 'YQ==' });

    const missing = new MemoryArea();
    const missingRecorder = createSelectionHistoryRecorder({ incognito: false, local: missing });
    await missingRecorder.append('base64', { kind: 'text', action: 'encode', input: 'a', output: 'YQ==' });

    expect(await storedRecords('base64')).toEqual([]);
  });

  it('never writes or throws in incognito', async () => {
    const local = new MemoryArea();
    await local.set({ historyEnabled: true });
    const recorder = createSelectionHistoryRecorder({ incognito: true, local });

    await expect(
      recorder.append('base64', { kind: 'text', action: 'encode', input: 'a', output: 'YQ==' }),
    ).resolves.toBeUndefined();
    expect(await storedRecords('base64')).toEqual([]);
  });

  it('swallows quota rejections for oversized selections', async () => {
    const local = new MemoryArea();
    await local.set({ historyEnabled: true });
    const recorder = createSelectionHistoryRecorder({ incognito: false, local });
    const huge = 'a'.repeat(300 * 1024);

    await expect(
      recorder.append('base64', { kind: 'text', action: 'encode', input: huge, output: huge }),
    ).resolves.toBeUndefined();
    expect(await storedRecords('base64')).toEqual([]);
  });

  it('treats a failed toggle read as history-off', async () => {
    const local = {
      get: () => Promise.reject(new Error('storage unavailable')),
    };
    const recorder = createSelectionHistoryRecorder({ incognito: false, local });

    await expect(
      recorder.append('base64', { kind: 'text', action: 'encode', input: 'a', output: 'YQ==' }),
    ).resolves.toBeUndefined();
    expect(await storedRecords('base64')).toEqual([]);
  });
});
