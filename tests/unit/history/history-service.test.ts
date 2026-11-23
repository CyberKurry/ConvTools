import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { createHistoryService, HISTORY_RECORD_TOO_LARGE } from '../../../core/history/history-service';
import { createModuleHistoryRecord } from '../../../core/history/record';
import { HISTORY_DB_NAME } from '../../../core/history/indexed-db';
import { GLOBAL_HISTORY_BYTES, MODULE_HISTORY_LIMIT, RECORD_BYTE_LIMIT } from '../../../core/history/quota';
import { PersistenceBlockedError } from '../../../core/storage/persistence-guard';

afterEach(() => {
  indexedDB.deleteDatabase(HISTORY_DB_NAME);
});

describe('history service', () => {
  it('is off by default and writes nothing until enabled', async () => {
    const service = createHistoryService({ enabled: false, incognito: false });
    await service.append({
      kind: 'text',
      moduleId: 'alpha-tool',
      action: 'encode',
      createdAt: 1,
      input: 'a',
      output: 'YQ==',
    });
    expect(await service.list('alpha-tool')).toEqual([]);
  });

  it('evicts oldest-first per module at 500 entries', async () => {
    const service = createHistoryService({ enabled: true, incognito: false, moduleLimit: 3 });
    for (let i = 0; i < 4; i += 1) {
      await service.append({
        kind: 'text',
        moduleId: 'alpha-tool',
        action: 'encode',
        createdAt: i + 1,
        input: String(i),
        output: String(i),
      });
    }
    const records = await service.list('alpha-tool');
    expect(records.map((record) => record.createdAt)).toEqual([2, 3, 4]);
    expect(MODULE_HISTORY_LIMIT).toBe(500);
  });

  it('evicts oldest-first globally when serialized bytes exceed 5 MiB', async () => {
    const service = createHistoryService({
      enabled: true,
      incognito: false,
      globalByteLimit: 200,
      moduleLimit: 50,
    });
    await service.append({
      kind: 'text',
      moduleId: 'alpha-tool',
      action: 'encode',
      createdAt: 1,
      input: 'aaaaaaaaaaaaaaaa',
      output: 'out-1',
    });
    await service.append({
      kind: 'text',
      moduleId: 'zeta-tool',
      action: 'encode',
      createdAt: 2,
      input: 'bbbbbbbbbbbbbbbb',
      output: 'out-2',
    });
    const alpha = await service.list('alpha-tool');
    const zeta = await service.list('zeta-tool');
    expect(alpha.length + zeta.length).toBe(1);
    expect(GLOBAL_HISTORY_BYTES).toBe(5 * 1024 * 1024);
  });

  it('rejects a single record larger than the global quota', async () => {
    const service = createHistoryService({ enabled: true, incognito: false, globalByteLimit: 20 });
    await expect(
      service.append({
        kind: 'text',
        moduleId: 'alpha-tool',
        action: 'encode',
        createdAt: 1,
        input: 'this-input-is-far-too-large-for-the-tiny-quota',
        output: 'also-too-large',
      }),
    ).rejects.toMatchObject({ code: 'HISTORY_RECORD_TOO_LARGE' });
  });

  it('clears one module or all modules', async () => {
    const service = createHistoryService({ enabled: true, incognito: false });
    await service.append({
      kind: 'file',
      moduleId: 'alpha-tool',
      action: 'encode',
      createdAt: 1,
      name: 'a.bin',
      size: 12,
      mime: 'application/octet-stream',
    });
    await service.append({
      kind: 'text',
      moduleId: 'zeta-tool',
      action: 'convert',
      createdAt: 2,
      input: '1',
      output: '2',
    });
    await service.clear('alpha-tool');
    expect(await service.list('alpha-tool')).toEqual([]);
    expect((await service.list('zeta-tool')).length).toBe(1);
    await service.clear();
    expect(await service.list('zeta-tool')).toEqual([]);
  });

  it('does not write in incognito', async () => {
    const service = createHistoryService({ enabled: true, incognito: true });
    await expect(
      service.append({
        kind: 'text',
        moduleId: 'alpha-tool',
        action: 'encode',
        createdAt: 1,
        input: 'a',
        output: 'YQ==',
      }),
    ).rejects.toBeInstanceOf(PersistenceBlockedError);
  });

  it('stops storing records after setEnabled(false)', async () => {
    const service = createHistoryService({ enabled: true, incognito: false });
    service.setEnabled(false);
    await service.append({
      kind: 'text',
      moduleId: 'alpha-tool',
      action: 'encode',
      createdAt: 1,
      input: 'a',
      output: 'YQ==',
    });
    expect(await service.list('alpha-tool')).toEqual([]);
  });

  it('rejects a single record above the per-record byte cap', async () => {
    const service = createHistoryService({
      enabled: true,
      incognito: false,
      moduleLimit: 50,
      globalByteLimit: 10_000_000,
    });
    await expect(
      service.append({
        kind: 'text',
        moduleId: 'alpha-tool',
        action: 'encode',
        createdAt: 1,
        input: 'a'.repeat(RECORD_BYTE_LIMIT),
        output: '',
      }),
    ).rejects.toMatchObject({ code: HISTORY_RECORD_TOO_LARGE });
    expect(await service.list('alpha-tool')).toEqual([]);
  });
});

describe('createModuleHistoryRecord', () => {
  it('forces moduleId and createdAt, drops module-supplied ids, and keeps module fields', () => {
    const record = createModuleHistoryRecord(
      {
        kind: 'text',
        action: 'convert',
        input: '1700000000',
        output: '2023-11-14T22:13:20Z',
        timeZone: 'Asia/Shanghai',
      },
      'timestamp',
      1234,
    );
    expect(record).toMatchObject({ kind: 'text', moduleId: 'timestamp', createdAt: 1234, timeZone: 'Asia/Shanghai' });
    expect(record).not.toHaveProperty('id');
  });

  it('keeps file records metadata-only', () => {
    const record = createModuleHistoryRecord(
      { kind: 'file', action: 'encode', name: 'a.png', size: 12, mime: 'image/png' },
      'base64',
      99,
    );
    expect(record).toEqual({
      kind: 'file',
      moduleId: 'base64',
      action: 'encode',
      name: 'a.png',
      size: 12,
      mime: 'image/png',
      createdAt: 99,
    });
  });

  it('carries sourceUrl on file records only when the module supplied it', () => {
    const withSource = createModuleHistoryRecord(
      {
        kind: 'file',
        action: 'generate',
        name: 'share-card-paper-2160x2880.png',
        size: 2048,
        mime: 'image/png',
        sourceUrl: 'https://example.com/article?utm=x',
      },
      'share-card',
      5,
    );
    expect(withSource).toMatchObject({
      kind: 'file',
      sourceUrl: 'https://example.com/article?utm=x',
    });

    const withoutSource = createModuleHistoryRecord(
      { kind: 'file', action: 'encode', name: 'a.png', size: 12, mime: 'image/png' },
      'base64',
      6,
    );
    expect(withoutSource).not.toHaveProperty('sourceUrl');
  });
});
