/**
 * Sends that were composed while the connection was down.
 *
 * ── WHY IndexedDB AND NOT localStorage ──────────────────────────────────────
 *
 * A composed message with an inline image is comfortably past localStorage's
 * ~5 MB budget, and localStorage is synchronous — writing one on the main thread
 * janks the editor at exactly the moment the user is typing.
 *
 * ── THE IDEMPOTENCY KEY IS MINTED ONCE, WHEN THE MESSAGE IS COMPOSED ────────
 *
 * Not per attempt. That is the entire mechanism: a replay after reconnect, a
 * duplicate from a retry, and the same message sent from two tabs all carry the
 * same key, and the server's unique index on it collapses them into one queued
 * row. Minting a fresh key per attempt would make every retry a new message.
 *
 * Everything here degrades to a no-op if IndexedDB is unavailable — a private
 * window, a locked-down browser. Offline send is a convenience; failing to open
 * a database must never stop somebody sending mail while online.
 */

const DB = "praxis-mail";
const STORE = "outbox";
const VERSION = 1;

export type PendingSend = {
  /** The key the server de-duplicates on. Minted once, at compose time. */
  idempotency_key: string;
  body: Record<string, unknown>;
  queued_at: number;
  attempts: number;
};

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") { resolve(null); return; }
      const req = indexedDB.open(DB, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "idempotency_key" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      // A browser that never answers must not hang the send path.
      setTimeout(() => resolve(null), 2000);
    } catch {
      resolve(null);
    }
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T | null> {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = run(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => resolve(null);
    } catch {
      /* @silent:storage IndexedDB is unavailable (private window, locked-down
         browser). Offline send is a convenience — see the header. */
      resolve(null);
    }
  });
}

export const rememberSend = (entry: PendingSend) =>
  tx<IDBValidKey>("readwrite", (s) => s.put(entry));

export const forgetSend = (key: string) =>
  tx<undefined>("readwrite", (s) => s.delete(key));

export const pendingSends = async (): Promise<PendingSend[]> =>
  (await tx<PendingSend[]>("readonly", (s) => s.getAll())) || [];

/** Crypto-random where available; the fallback only has to be unique enough. */
export const newIdempotencyKey = (): string => {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* @silent:parse crypto.randomUUID is unavailable on an insecure origin; the fallback below is unique enough for a de-duplication key. */ }
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
};

/**
 * Replay everything still pending.
 *
 * A send that FAILS with a 4xx is forgotten rather than retried forever: the
 * server has refused it on its merits — no recipient, no permission, an archived
 * mailbox — and replaying it every time the network flickers turns one bad
 * message into an endless loop. A network failure leaves it in the store.
 */
export async function replayPending(
  send: (body: Record<string, unknown>) => Promise<unknown>,
): Promise<{ sent: number; dropped: number; kept: number }> {
  const pending = await pendingSends();
  let sent = 0; let dropped = 0; let kept = 0;
  for (const entry of pending) {
    try {
       
      await send({ ...entry.body, idempotency_key: entry.idempotency_key });
      await forgetSend(entry.idempotency_key);
      sent += 1;
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (typeof status === "number" && status >= 400 && status < 500) {
        await forgetSend(entry.idempotency_key);
        dropped += 1;
      } else {
        kept += 1;
      }
    }
  }
  return { sent, dropped, kept };
}
