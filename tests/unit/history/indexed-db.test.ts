import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { openHistoryDb, HISTORY_DB_NAME } from '../../../core/history/indexed-db';

afterEach(() => {
  indexedDB.deleteDatabase(HISTORY_DB_NAME);
});

describe('history indexed db', () => {
  it('opens a versioned object store', async () => {
    const db = await openHistoryDb();
    expect(db.objectStoreNames.contains('records')).toBe(true);
    db.close();
  });
});
