import { describe, expect, it, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  HistoryRecordTooLargeError,
  appendHistorySafely,
  createHistoryService,
} from '../../../core/history/history-service';
import { HISTORY_DB_NAME } from '../../../core/history/indexed-db';
import type { HistoryRecord } from '../../../core/history/types';

afterEach(() => {
  indexedDB.deleteDatabase(HISTORY_DB_NAME);
});

function textRecord(overrides: Partial<HistoryRecord> = {}): HistoryRecord {
  return {
    kind: 'text',
    moduleId: 'base64',
    action: 'encode',
    input: 'a',
    output: 'YQ==',
    createdAt: 1,
    ...overrides,
  } as HistoryRecord;
}

describe('history service enable gate', () => {
  it('defaults to disabled and stores nothing', async () => {
    const service = createHistoryService({ enabled: false, incognito: false });
    await service.append(textRecord());
    expect(await service.list('base64')).toEqual([]);
  });

  it('writes after setEnabled(true) and stops after setEnabled(false)', async () => {
    const service = createHistoryService({ enabled: false, incognito: false });
    service.setEnabled(true);
    await service.append(textRecord());
    expect(await service.list('base64')).toHaveLength(1);
    service.setEnabled(false);
    await service.append(textRecord({ input: 'b' }));
    expect(await service.list('base64')).toHaveLength(1);
  });

  it('keeps rejecting appends in incognito even when enabled', async () => {
    const service = createHistoryService({ enabled: false, incognito: true });
    service.setEnabled(true);
    await expect(service.append(textRecord())).rejects.toMatchObject({ code: 'PERSISTENCE_BLOCKED' });
  });

  it('returns sorted per-module list and clears one module', async () => {
    const service = createHistoryService({ enabled: false, incognito: false });
    service.setEnabled(true);
    await service.append(textRecord({ createdAt: 3, moduleId: 'base64' }));
    await service.append(textRecord({ createdAt: 1, moduleId: 'timestamp' }));
    await service.append(textRecord({ createdAt: 2 }));
    const list = await service.list('base64');
    expect(list.map((record) => record.createdAt)).toEqual([2, 3]);
    await service.clear('base64');
    expect(await service.list('base64')).toEqual([]);
    expect(await service.list('timestamp')).toHaveLength(1);
  });
});

describe('appendHistorySafely', () => {
  it('resolves and keeps conversion success when quota rejects the record', async () => {
    const service = createHistoryService({ enabled: false, incognito: false });
    service.setEnabled(true);
    await expect(
      appendHistorySafely(service, textRecord({ input: 'x'.repeat(10), output: 'y'.repeat(6 * 1024 * 1024) })),
    ).resolves.toBeUndefined();
  });

  it('resolves when persistence is blocked (incognito) and when the service is disabled', async () => {
    const service = createHistoryService({ enabled: false, incognito: false });
    await expect(appendHistorySafely(service, textRecord())).resolves.toBeUndefined();
    service.setEnabled(true);
    const blocked = createHistoryService({ enabled: false, incognito: true });
    blocked.setEnabled(true);
    await expect(appendHistorySafely(blocked, textRecord())).resolves.toBeUndefined();
  });

  it('surfaces the too-large error type for direct callers', () => {
    expect(new HistoryRecordTooLargeError().code).toBe('HISTORY_RECORD_TOO_LARGE');
  });
});
