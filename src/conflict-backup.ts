import { legacyLocalStorageKeys, legacySnapshotMatches, snapshotLegacyLocalStorage, type LegacyLocalSnapshot } from './indexeddb-storage';

const databaseName = 'hair-atelier';
const storeName = 'editor-history';
const indexedDbKeys = ['current-v4', 'current-v3', 'current-v2', 'localstorage-source-v1'] as const;
type IndexedDbKey = typeof indexedDbKeys[number];
type LegacyLocalKey = typeof legacyLocalStorageKeys[number];

/** Tagged values distinguish an absent key from one containing undefined. */
export type BackupIndexedDbValue =
  | { readonly kind: 'missing' }
  | { readonly kind: 'undefined' }
  | { readonly kind: 'null' }
  | { readonly kind: 'string'; readonly value: string };

export interface ConflictBackup {
  readonly format: 'hair-atelier-conflict-backup';
  readonly version: 1;
  /** Backup creation time, not an assertion about which save is newer. */
  readonly createdAt: string;
  readonly indexedDb: Readonly<Record<IndexedDbKey, BackupIndexedDbValue>>;
  readonly localStorage: Readonly<Record<LegacyLocalKey, string | null>>;
  readonly memoryHistory?: string;
}

/** Open only an existing database; abort creation rather than leaving a new one. */
function openExistingDatabase(): Promise<IDBDatabase | undefined> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName);
    let creating = false;
    let settled = false;
    request.onupgradeneeded = () => {
      creating = true;
      request.transaction?.abort();
    };
    request.onblocked = () => {
      if (settled) return;
      settled = true;
      reject(new Error('無法讀取被其他頁面封鎖的本機存檔'));
    };
    request.onerror = () => {
      if (settled) return;
      settled = true;
      if (creating && request.error?.name === 'AbortError') resolve(undefined);
      else reject(request.error ?? new Error('無法讀取本機存檔'));
    };
    request.onsuccess = () => {
      const database = request.result;
      if (settled) { database.close(); return; }
      settled = true;
      resolve(database);
    };
  });
}

function localSnapshotStillMatches(snapshot: LegacyLocalSnapshot): boolean {
  return legacySnapshotMatches({ snapshot, digest: '', persisted: false });
}

function assertLocalSnapshot(snapshot: LegacyLocalSnapshot): void {
  if (!localSnapshotStillMatches(snapshot)) throw new Error('備份期間舊存檔發生變更，請重試');
}

function encodeValue(exists: boolean, value: unknown): BackupIndexedDbValue {
  if (!exists) return { kind: 'missing' };
  if (value === undefined) return { kind: 'undefined' };
  if (value === null) return { kind: 'null' };
  if (typeof value === 'string') return { kind: 'string', value };
  throw new Error('本機存檔含有無法安全匯出的資料，未作任何修改');
}

function emptyIndexedDb(): Record<IndexedDbKey, BackupIndexedDbValue> {
  return {
    'current-v4': { kind: 'missing' },
    'current-v3': { kind: 'missing' },
    'current-v2': { kind: 'missing' },
    'localstorage-source-v1': { kind: 'missing' },
  };
}

/**
 * Capture without writing either store. IndexedDB values share one readonly
 * transaction; localStorage is checked before and after that transaction.
 * This is a point-in-time backup, not a lock against subsequent changes.
 */
export async function readConflictBackup(memoryHistory?: string): Promise<ConflictBackup> {
  if (memoryHistory !== undefined && typeof memoryHistory !== 'string') throw new TypeError('Invalid in-memory history');
  const initial = snapshotLegacyLocalStorage();
  const database = await openExistingDatabase();
  let indexedDb = emptyIndexedDb();
  if (database) {
    try {
      if (!database.objectStoreNames.contains(storeName)) throw new Error('本機存檔結構無法讀取，未作任何修改');
      indexedDb = await new Promise<Record<IndexedDbKey, BackupIndexedDbValue>>((resolve, reject) => {
        const transaction = database.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const requests = indexedDbKeys.map((key) => ({ key, keyRequest: store.getKey(key), valueRequest: store.get(key) }));
        transaction.oncomplete = () => {
          try {
            assertLocalSnapshot(initial);
            const result = emptyIndexedDb();
            for (const { key, keyRequest, valueRequest } of requests) {
              result[key] = encodeValue(keyRequest.result !== undefined, valueRequest.result);
            }
            resolve(result);
          } catch (error) { reject(error); }
        };
        transaction.onabort = () => reject(transaction.error ?? new Error('讀取本機存檔時中斷'));
        transaction.onerror = () => reject(transaction.error ?? new Error('讀取本機存檔失敗'));
      });
    } finally {
      database.close();
    }
  }
  assertLocalSnapshot(initial);
  return {
    format: 'hair-atelier-conflict-backup',
    version: 1,
    createdAt: new Date().toISOString(),
    indexedDb,
    localStorage: {
      [legacyLocalStorageKeys[0]]: initial[0],
      [legacyLocalStorageKeys[1]]: initial[1],
      [legacyLocalStorageKeys[2]]: initial[2],
    },
    ...(memoryHistory === undefined ? {} : { memoryHistory }),
  };
}
