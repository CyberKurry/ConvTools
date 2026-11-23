import { PersistenceBlockedError } from '../storage/persistence-guard';
import {
  HISTORY_META_KEY,
  HISTORY_META_STORE,
  HISTORY_STORE,
  openHistoryDb,
} from './indexed-db';
import { estimateRecordBytes, GLOBAL_HISTORY_BYTES, MODULE_HISTORY_LIMIT, RECORD_BYTE_LIMIT } from './quota';
import type { HistoryRecord } from './types';

export const HISTORY_RECORD_TOO_LARGE = 'HISTORY_RECORD_TOO_LARGE';

export class HistoryRecordTooLargeError extends Error {
  readonly code = HISTORY_RECORD_TOO_LARGE;

  constructor() {
    super('history record exceeds the global quota');
    this.name = 'HistoryRecordTooLargeError';
  }
}

export interface HistoryService {
  append(record: HistoryRecord): Promise<void>;
  list(moduleId: string): Promise<HistoryRecord[]>;
  clear(moduleId?: string): Promise<void>;
  setEnabled(value: boolean): void;
}

export function createHistoryService(options: {
  enabled: boolean;
  incognito: boolean;
  moduleLimit?: number;
  globalByteLimit?: number;
  indexedDb?: IDBFactory;
}): HistoryService {
  const moduleLimit = options.moduleLimit ?? MODULE_HISTORY_LIMIT;
  const globalByteLimit = options.globalByteLimit ?? GLOBAL_HISTORY_BYTES;
  let enabled = options.enabled;

  async function withStore<T>(
    mode: IDBTransactionMode,
    work: (stores: { records: IDBObjectStore; meta: IDBObjectStore }) => Promise<T>,
  ): Promise<T> {
    const db = await openHistoryDb(options.indexedDb);
    try {
      const tx = db.transaction([HISTORY_STORE, HISTORY_META_STORE], mode);
      const records = tx.objectStore(HISTORY_STORE);
      const meta = tx.objectStore(HISTORY_META_STORE);
      try {
        const result = await work({ records, meta });
        await waitForTransaction(tx);
        return result;
      } catch (error) {
        // Abort before rethrowing so partially queued deletes cannot commit
        // (spec §15: storage failures roll back to the previous state).
        try {
          tx.abort();
        } catch {
          // Already committed or aborted — nothing further to do.
        }
        throw error;
      }
    } finally {
      db.close();
    }
  }

  function readTotalBytes(meta: IDBObjectStore): Promise<number | null> {
    return requestToPromise(meta.get(HISTORY_META_KEY) as IDBRequest<number | undefined>).then(
      (value) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null),
    );
  }

  /**
   * Reads the store's whole byte total. The meta record keeps this O(1) on
   * the happy path; a missing or corrupt total falls back to one scan and
   * re-seeds the record inside the same transaction.
   */
  async function totalBytes(stores: { records: IDBObjectStore; meta: IDBObjectStore }): Promise<number> {
    const stored = await readTotalBytes(stores.meta);
    if (stored !== null) {
      return stored;
    }
    const all = await getAll(stores.records);
    let total = 0;
    for (const record of all) {
      total += estimateRecordBytes(record);
    }
    stores.meta.put(total, HISTORY_META_KEY);
    return total;
  }

  return {
    async append(record) {
      if (!enabled) {
        return;
      }
      if (options.incognito) {
        throw new PersistenceBlockedError();
      }
      const bytes = estimateRecordBytes(record);
      if (bytes > RECORD_BYTE_LIMIT || bytes > globalByteLimit) {
        throw new HistoryRecordTooLargeError();
      }
      await withStore('readwrite', async (stores) => {
        const current = await totalBytes(stores);
        const moduleCount = await requestToPromise(
          stores.records.index('moduleId').count(IDBKeyRange.only(record.moduleId)),
        );
        // Fast path: quotas cannot be hit, so skip the full-store eviction
        // scan entirely and just advance the byte total.
        if (moduleCount < moduleLimit && current + bytes <= globalByteLimit) {
          await requestToPromise(stores.records.add(record));
          stores.meta.put(current + bytes, HISTORY_META_KEY);
          return;
        }
        await requestToPromise(stores.records.add(record));
        const evicted = await evict(stores.records, record.moduleId, moduleLimit, globalByteLimit);
        stores.meta.put(Math.max(0, current + bytes - evicted), HISTORY_META_KEY);
      });
    },
    async list(moduleId) {
      return withStore('readonly', async (stores) => {
        const matched = (await requestToPromise(
          stores.records.index('moduleId').getAll(IDBKeyRange.only(moduleId)),
        )) as HistoryRecord[];
        return matched.sort((a, b) => a.createdAt - b.createdAt);
      });
    },
    async clear(moduleId) {
      if (options.incognito) {
        throw new PersistenceBlockedError();
      }
      await withStore('readwrite', async (stores) => {
        if (!moduleId) {
          await requestToPromise(stores.records.clear());
          stores.meta.put(0, HISTORY_META_KEY);
          return;
        }
        const all = await getAll(stores.records);
        let removedBytes = 0;
        for (const record of all) {
          if (record.moduleId === moduleId && record.id !== undefined) {
            await requestToPromise(stores.records.delete(record.id));
            removedBytes += estimateRecordBytes(record);
          }
        }
        if (removedBytes > 0) {
          const current = await totalBytes(stores);
          stores.meta.put(Math.max(0, current - removedBytes), HISTORY_META_KEY);
        }
      });
    },
    setEnabled(value: boolean) {
      enabled = value;
    },
  };
}

/**
 * History must never turn a successful conversion into a failure (spec §15):
 * privacy blocks and quota rejections are swallowed here so callers can fire
 * and forget; unexpected storage errors still propagate.
 */
export async function appendHistorySafely(
  service: Pick<HistoryService, 'append'>,
  record: HistoryRecord,
): Promise<void> {
  try {
    await service.append(record);
  } catch (error) {
    if (error instanceof PersistenceBlockedError || error instanceof HistoryRecordTooLargeError) {
      return;
    }
    throw error;
  }
}

/** Evicts oldest-first and returns the serialized bytes freed. */
async function evict(
  store: IDBObjectStore,
  moduleId: string,
  moduleLimit: number,
  globalByteLimit: number,
): Promise<number> {
  // Single scan: compute every eviction from one snapshot instead of
  // re-reading and re-serializing the whole store per deletion (O(n²) before).
  const all = (await getAll(store)).sort((a, b) => a.createdAt - b.createdAt);
  const deletions: number[] = [];
  let originalBytes = 0;
  for (const record of all) {
    originalBytes += estimateRecordBytes(record);
  }

  const byModule = all.filter((record) => record.moduleId === moduleId);
  let moduleOverflow = Math.max(0, byModule.length - moduleLimit);
  for (const record of byModule) {
    if (moduleOverflow === 0) {
      break;
    }
    if (record.id !== undefined) {
      deletions.push(record.id);
      moduleOverflow -= 1;
    }
  }

  const evictedIds = new Set(deletions);
  const remaining = all.filter((record) => record.id === undefined || !evictedIds.has(record.id));
  let totalBytes = 0;
  for (const record of remaining) {
    totalBytes += estimateRecordBytes(record);
  }
  for (const record of remaining) {
    if (totalBytes <= globalByteLimit) {
      break;
    }
    if (record.id !== undefined) {
      deletions.push(record.id);
      totalBytes -= estimateRecordBytes(record);
    }
  }

  for (const id of deletions) {
    store.delete(id);
  }
  return originalBytes - totalBytes;
}

function getAll(store: IDBObjectStore): Promise<HistoryRecord[]> {
  return requestToPromise(store.getAll()) as Promise<HistoryRecord[]>;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexeddb request failed'));
  });
}

function waitForTransaction(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('history transaction aborted'));
    tx.onerror = () => reject(tx.error ?? new Error('history transaction failed'));
  });
}