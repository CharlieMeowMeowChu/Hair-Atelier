const databaseName = 'hair-atelier';
const storeName = 'editor-history';
const historyKey = 'current-v4';
const legacyHistoryKey = 'current-v3';
const olderHistoryKey = 'current-v2';
const localSourceKey = 'localstorage-source-v1';

/** Legacy keys in the order used by the editor when selecting a source. */
export const legacyLocalStorageKeys = [
  'hair-atelier.editor-history.v2',
  'hair-atelier.editor-history.v1',
  'hair-atelier.hair-state.v1',
] as const;
export type LegacyLocalSnapshot = readonly [string | null, string | null, string | null];
export type LegacyGuardFormat = 'sha256' | 'raw';
export interface LegacyLocalGuard {
  readonly snapshot: LegacyLocalSnapshot;
  readonly digest: string;
  readonly persisted: boolean;
}

/** Capture presence and exact bytes of all sources, including absent keys. */
export function snapshotLegacyLocalStorage(): LegacyLocalSnapshot {
  return [
    localStorage.getItem(legacyLocalStorageKeys[0]),
    localStorage.getItem(legacyLocalStorageKeys[1]),
    localStorage.getItem(legacyLocalStorageKeys[2]),
  ];
}

/** Prefer a SHA-256 fingerprint; use the exact snapshot if crypto is unavailable. */
export async function makeLegacyGuard(snapshot: LegacyLocalSnapshot, persisted: boolean, format?: LegacyGuardFormat): Promise<LegacyLocalGuard> {
  const preserved: LegacyLocalSnapshot = [snapshot[0], snapshot[1], snapshot[2]];
  const serialized = JSON.stringify(preserved);
  if (format !== undefined && format !== 'raw' && format !== 'sha256') throw new Error('Unsupported legacy guard format');
  if (format === 'raw') return { snapshot: preserved, digest: `raw:${serialized}`, persisted };
  try {
    if (!globalThis.crypto?.subtle) throw new Error('SHA-256 is unavailable');
    const bytes = new TextEncoder().encode(serialized);
    const hash = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
    const digest = `sha256-${[...hash].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
    return { snapshot: preserved, digest, persisted };
  } catch (error) {
    if (format === 'sha256') throw error;
    return { snapshot: preserved, digest: `raw:${serialized}`, persisted };
  }
}

/** An inaccessible legacy source is treated as a conflict, never as absent. */
export function legacySnapshotMatches(guard: LegacyLocalGuard): boolean {
  try { return snapshotLegacyLocalStorage().every((value, index) => value === guard.snapshot[index]); }
  catch { return false; }
}

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
export interface StorageToken { readonly current: string | undefined; readonly legacy: string | undefined; readonly older?: string; readonly localGuard?: LegacyLocalGuard }
export interface StoredHistory { readonly value: string | undefined; readonly token: StorageToken; readonly localDigest?: unknown }
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
          // Read the marker in the same readonly transaction as current-v4,
          // so a concurrent write cannot pair a save with another marker.
          const markerKey = store.getKey(localSourceKey);
          const marker = store.get(localSourceKey);
          marker.onsuccess = () => resolve({
            value: current,
            token: { current, legacy: undefined },
            // A present key whose value is undefined is corrupt, not absent.
            localDigest: markerKey.result === undefined ? undefined : marker.result === undefined ? null : marker.result,
          });
          marker.onerror = () => reject(marker.error ?? new Error('Unable to read legacy source marker'));
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
      const save = () => {
        const guard = expectedToken.localGuard;
        // Every writer must provide the observed local sources; otherwise a
        // direct module caller could bypass an existing migration guard.
        if (!guard) { abortConflict(); return; }
        const markerKey = store.getKey(localSourceKey);
        const marker = store.get(localSourceKey);
        marker.onsuccess = () => {
          const exists = markerKey.result !== undefined;
          if ((guard.persisted ? !exists || marker.result !== guard.digest : exists) || !legacySnapshotMatches(guard)) {
            abortConflict();
            return;
          }
          // The marker and v4 are committed atomically within IndexedDB.
          // localStorage itself is a separate store and must be rechecked by
          // the caller after commit and on later reads.
          store.put(serializedHistory, historyKey);
          store.put(guard.digest, localSourceKey);
        };
      };
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
