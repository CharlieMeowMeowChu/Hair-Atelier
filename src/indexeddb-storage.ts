const databaseName = 'hair-atelier';
const storeName = 'editor-history';
const historyKey = 'current-v2';

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
      const request = database.transaction(storeName, 'readonly').objectStore(storeName).get(historyKey);
      request.onsuccess = () => resolve(typeof request.result === 'string' ? request.result : undefined);
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
