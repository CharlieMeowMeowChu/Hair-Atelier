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

export async function readEditorHistory(): Promise<string | undefined> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const store = database.transaction(storeName, 'readonly').objectStore(storeName);
      const request = store.get(historyKey);
      request.onsuccess = () => {
        if (request.result !== undefined) { resolve(typeof request.result === 'string' ? request.result : '{invalid-storage'); return; }
        const legacy = store.get(legacyHistoryKey);
        legacy.onsuccess = () => resolve(legacy.result === undefined ? undefined : typeof legacy.result === 'string' ? legacy.result : '{invalid-storage');
        legacy.onerror = () => reject(legacy.error ?? new Error('Unable to read legacy IndexedDB'));
      };
      request.onerror = () => reject(request.error ?? new Error('Unable to read IndexedDB'));
    });
  } finally {
    database.close();
  }
}

export async function writeEditorHistory(serializedHistory: string): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readwrite');
      transaction.objectStore(storeName).put(serializedHistory, historyKey);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error ?? new Error('Unable to write IndexedDB'));
      transaction.onerror = () => reject(transaction.error ?? new Error('Unable to write IndexedDB'));
    });
  } finally {
    database.close();
  }
}
