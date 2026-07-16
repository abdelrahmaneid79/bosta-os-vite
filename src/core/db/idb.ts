/**
 * Tiny promise-based IndexedDB wrapper (no dependency). Device-local storage for
 * things that should survive a reload but never touch the server — currently the
 * in-progress day-import review draft and the set of already-imported image
 * hashes. Every call fails soft (returns null / no-op) so a private-mode or
 * quota error can never break the importer.
 */
const DB_NAME = "bostaos";
const DB_VERSION = 1;
export const STORES = ["drafts", "imageHashes"] as const;
export type StoreName = (typeof STORES)[number];

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDB(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => { for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbPromise;
}

function tx<T>(store: StoreName, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T | null> {
  return openDB().then((db) => db ? new Promise<T | null>((resolve) => {
    try {
      const r = run(db.transaction(store, mode).objectStore(store));
      r.onsuccess = () => resolve(r.result as T);
      r.onerror = () => resolve(null);
    } catch { resolve(null); }
  }) : null);
}

export const idbGet = <T>(store: StoreName, key: string): Promise<T | null> => tx<T>(store, "readonly", (s) => s.get(key));
export const idbSet = (store: StoreName, key: string, value: unknown): Promise<unknown> => tx(store, "readwrite", (s) => s.put(value, key));
export const idbDel = (store: StoreName, key: string): Promise<unknown> => tx(store, "readwrite", (s) => s.delete(key));
