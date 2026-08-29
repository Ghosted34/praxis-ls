/**
 * The rotation token, in IndexedDB.
 *
 * ── WHY INDEXEDDB AND NOT localStorage ──────────────────────────────────────
 *
 * Because the reader is a SERVICE WORKER. `localStorage` is synchronous and
 * simply does not exist in a worker context; IndexedDB is the only storage both
 * the page and the worker can reach on the same origin. That is the whole
 * reason for this file — the token has to be written by the page (which is
 * authenticated and can call /push/subscribe) and read by the worker (which is
 * not, and cannot).
 *
 * ── WHAT THE TOKEN IS FOR ───────────────────────────────────────────────────
 *
 * When the browser rotates this device's push subscription, the old endpoint
 * dies and the worker is the only thing that hears about it. It has no session
 * to re-register with, so it presents this token instead: single-use, issued by
 * the server at subscribe time, and stored server-side only as a SHA-256. See
 * migration 12752.
 *
 * Everything here swallows its failures. A browser in private mode, or one with
 * IndexedDB disabled, loses instant rotation repair and falls back to the
 * boot-time re-registration in lib/push-sync — which is where this device was
 * before the token existed. Not a reason to break anything.
 */

const DB_NAME = "praxis-push";
const DB_VERSION = 1;
const STORE = "tokens";
const KEY = "rotation";

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      // A blocked upgrade (another tab holding an old version open) would
      // otherwise leave this promise pending for ever, and every caller awaits it.
      req.onblocked = () => resolve(null);
    } catch {
      /* @silent:storage — no IndexedDB here; boot-time re-registration covers it */
      resolve(null);
    }
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null);
        try {
          const request = run(db.transaction(STORE, mode).objectStore(STORE));
          request.onsuccess = () => resolve(request.result as T);
          request.onerror = () => resolve(null);
        } catch {
          /* @silent:storage — the store is unavailable; the caller degrades */
          resolve(null);
        }
      }),
  );
}

/** Keep the token this device will present when its subscription rotates. */
export const saveRotationToken = (token: string): Promise<unknown> =>
  tx("readwrite", (store) => store.put(token, KEY));

export const readRotationToken = (): Promise<string | null> =>
  tx<string>("readonly", (store) => store.get(KEY));

/** On unsubscribe: the token is worthless and should not outlive the device. */
export const clearRotationToken = (): Promise<unknown> =>
  tx("readwrite", (store) => store.delete(KEY));
