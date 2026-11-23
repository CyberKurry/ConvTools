export const HISTORY_DB_NAME = 'convtools-history';
export const HISTORY_STORE = 'records';
/** Tracks the store's serialized byte total so appends skip full rescans. */
export const HISTORY_META_STORE = 'meta';
export const HISTORY_META_KEY = 'totalBytes';
export const HISTORY_DB_VERSION = 2;

export function openHistoryDb(indexedDb: IDBFactory = indexedDB): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDb.open(HISTORY_DB_NAME, HISTORY_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(HISTORY_STORE)) {
        const store = db.createObjectStore(HISTORY_STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('moduleId', 'moduleId', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(HISTORY_META_STORE)) {
        // Version 2: a missing (or absent) meta record simply re-derives the
        // byte total from one scan on the next append.
        db.createObjectStore(HISTORY_META_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('failed to open history db'));
  });
}