const databaseName = 'hair-atelier';
const storeName = 'editor-history';
const historyKey = 'current-v3';
const legacyHistoryKey = 'current-v2';

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

export interface StorageToken { readonly current: string | undefined; readonly legacy: string | undefined }
export interface StoredHistory { readonly value: string | undefined; readonly token: StorageToken }
export class StorageConflictError extends Error {}

export async function readEditorHistory(): Promise<StoredHistory> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const store = database.transaction(storeName, 'readonly').objectStore(storeName);
      const request = store.get(historyKey);
      request.onsuccess = () => {
        if (request.result !== undefined) { resolve({ value: typeof request.result === 'string' ? request.result : '{invalid-storage', token: { current: typeof request.result === 'string' ? request.result : '{invalid-storage', legacy: undefined } }); return; }
        const legacy = store.get(legacyHistoryKey);
        legacy.onsuccess = () => resolve({ value: legacy.result === undefined ? undefined : typeof legacy.result === 'string' ? legacy.result : '{invalid-storage', token: { current: undefined, legacy: legacy.result === undefined ? undefined : typeof legacy.result === 'string' ? legacy.result : '{invalid-storage' } });
        legacy.onerror = () => reject(legacy.error ?? new Error('Unable to read legacy IndexedDB'));
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
      request.onsuccess = () => {
        if (request.result !== expectedToken.current) { conflict = true; transaction.abort(); return; }
        if (expectedToken.current !== undefined) { store.put(serializedHistory, historyKey); return; }
        const legacy = store.get(legacyHistoryKey);
        legacy.onsuccess = () => {
          if (legacy.result !== expectedToken.legacy) { conflict = true; transaction.abort(); return; }
          store.put(serializedHistory, historyKey);
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
