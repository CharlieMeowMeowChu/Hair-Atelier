const databaseName = 'hair-atelier';
const storeName = 'editor-history';
const historyKey = 'current-v4';
const legacyHistoryKey = 'current-v3';
const olderHistoryKey = 'current-v2';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Unable to open IndexedDB'));
  });
}

// An absent v4 depends on v3; an absent v3 in turn depends on v2. Keeping
// the observed source values permits an atomic upgrade without stale writes.
export interface StorageToken { readonly current: string | undefined; readonly legacy: string | undefined; readonly older?: string }
export interface StoredHistory { readonly value: string | undefined; readonly token: StorageToken }
export class StorageConflictError extends Error {}
const stringOrInvalid = (value: unknown): string => typeof value === 'string' ? value : '{invalid-storage';

export async function readEditorHistory(): Promise<StoredHistory> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const store = database.transaction(storeName, 'readonly').objectStore(storeName);
      const request = store.get(historyKey);
      request.onsuccess = () => {
        if (request.result !== undefined) {
          const current = stringOrInvalid(request.result);
          resolve({ value: current, token: { current, legacy: undefined } });
          return;
        }
        const legacy = store.get(legacyHistoryKey);
        legacy.onsuccess = () => {
          if (legacy.result !== undefined) {
            const old = stringOrInvalid(legacy.result);
            resolve({ value: old, token: { current: undefined, legacy: old } });
            return;
          }
          const older = store.get(olderHistoryKey);
          older.onsuccess = () => {
            const old = older.result === undefined ? undefined : stringOrInvalid(older.result);
            resolve({ value: old, token: { current: undefined, legacy: undefined, older: old } });
          };
          older.onerror = () => reject(older.error ?? new Error('Unable to read v2 IndexedDB'));
        };
        legacy.onerror = () => reject(legacy.error ?? new Error('Unable to read v3 IndexedDB'));
      };
      request.onerror = () => reject(request.error ?? new Error('Unable to read IndexedDB'));
    });
  } finally {
    database.close();
  }
}

export async function writeEditorHistory(serializedHistory: string, expectedToken: StorageToken): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.get(historyKey);
      let conflict = false;
      const abortConflict = () => { conflict = true; transaction.abort(); };
      const save = () => { store.put(serializedHistory, historyKey); };
      request.onsuccess = () => {
        if (request.result !== expectedToken.current) { abortConflict(); return; }
        if (expectedToken.current !== undefined) { save(); return; }
        const legacy = store.get(legacyHistoryKey);
        legacy.onsuccess = () => {
          if (legacy.result !== expectedToken.legacy) { abortConflict(); return; }
          if (expectedToken.legacy !== undefined) { save(); return; }
          const older = store.get(olderHistoryKey);
          older.onsuccess = () => {
            if (older.result !== expectedToken.older) { abortConflict(); return; }
            save();
          };
        };
      };
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(conflict ? new StorageConflictError('Storage changed in another tab') : transaction.error ?? new Error('Unable to write IndexedDB'));
      transaction.onerror = () => reject(transaction.error ?? new Error('Unable to write IndexedDB'));
    });
  } finally {
    database.close();
  }
}
