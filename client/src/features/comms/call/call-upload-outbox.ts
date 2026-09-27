/**
 * The call recording's upload queue (doc/SMART_COMMS_CALLS_AUDIT.md E11, A2).
 *
 * Every closed part, then the side's "complete" declaration, goes through
 * here, in order. Each item is kept in IndexedDB until the server has
 * acknowledged it, so the last part of a call survives a tab closed at
 * hang-up: the next time the app loads, `resume()` sends what is left.
 *
 * Retries: a network failure, a timeout, a 429 or a 5xx is retried with
 * backoff; a refusal (4xx) is final, because sending the same bytes again gets
 * the same answer, and the item is dropped and reported. When the retries for
 * this session run out, the item stays stored for the next load.
 */

export type PartItem = {
  id: string;
  kind: "part";
  callId: string;
  side: "caller" | "callee";
  index: number;
  blob: Blob;
  durationMs: number;
  mimeType: string;
  language: "en" | "fr";
  createdAt: number;
  attempts: number;
};

export type CompleteItem = {
  id: string;
  kind: "complete";
  callId: string;
  side: "caller" | "callee";
  parts: number;
  createdAt: number;
  attempts: number;
};

export type OutboxItem = PartItem | CompleteItem;

export interface OutboxStore {
  all(): Promise<OutboxItem[]>;
  put(item: OutboxItem): Promise<void>;
  remove(id: string): Promise<void>;
}

/** Retry delays, in order; after the last, the item waits for the next load. */
export const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];
/** The server refuses recordings 15 minutes after a call; a day is generous. */
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const itemId = (item: Pick<OutboxItem, "kind" | "callId" | "side"> & { index?: number }) =>
  item.kind === "part" ? `${item.callId}:${item.side}:part:${item.index}` : `${item.callId}:${item.side}:complete`;

/** Not worth retrying: the server has decided. 401 is a session to renew, and
 *  408/429/5xx and network errors (status 0) are worth another try. */
export function isFinalRefusal(err: unknown): boolean {
  const status = typeof err === "object" && err && "status" in err ? Number((err as { status: unknown }).status) : 0;
  return status >= 400 && status < 500 && status !== 401 && status !== 408 && status !== 429;
}

export function memoryStore(): OutboxStore {
  const items = new Map<string, OutboxItem>();
  return {
    all: async () => [...items.values()],
    put: async (item) => {
      items.set(item.id, item);
    },
    remove: async (id) => {
      items.delete(id);
    },
  };
}

const DB_NAME = "praxis-call-uploads";
const STORE = "items";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(db: IDBDatabase, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * IndexedDB, with memory as the floor: a private window or a browser that
 * refuses storage still uploads, it just cannot resume after a reload.
 */
export function indexedDbStore(): OutboxStore {
  const memory = memoryStore();
  let db: Promise<IDBDatabase | null> | null = null;
  const handle = () => {
    if (!db) {
      db = typeof indexedDB === "undefined"
        ? Promise.resolve(null)
        : openDb().catch(() => {
          /* @silent:storage — IndexedDB refused (private window); memory is the floor. */
          return null;
        });
    }
    return db;
  };
  return {
    all: async () => {
      const d = await handle();
      if (!d) return memory.all();
      try {
        return (await run(d, "readonly", (s) => s.getAll())) as OutboxItem[];
      } catch {
        return memory.all();
      }
    },
    put: async (item) => {
      await memory.put(item);
      const d = await handle();
      if (!d) return;
      try {
        await run(d, "readwrite", (s) => s.put(item));
      } catch {
        /* @silent:storage — kept in memory; it uploads this session, it just
           cannot survive a reload. */
      }
    },
    remove: async (id) => {
      await memory.remove(id);
      const d = await handle();
      if (!d) return;
      try {
        await run(d, "readwrite", (s) => s.delete(id));
      } catch {
        /* @silent:storage — an acknowledged item left behind is sent again on
           the next load and acknowledged again: the server treats a repeat of
           a part or a declaration as the same one. */
      }
    },
  };
}

export class UploadOutbox {
  private store: OutboxStore;
  private send: (item: OutboxItem) => Promise<void>;
  private sleep: (ms: number) => Promise<void>;
  private onLost?: (item: OutboxItem) => void;
  private now: () => number;
  private queue: OutboxItem[] = [];
  private running: Promise<void> | null = null;

  constructor(opts: {
    store: OutboxStore;
    send: (item: OutboxItem) => Promise<void>;
    sleep?: (ms: number) => Promise<void>;
    onLost?: (item: OutboxItem) => void;
    now?: () => number;
  }) {
    this.store = opts.store;
    this.send = opts.send;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.onLost = opts.onLost;
    this.now = opts.now ?? (() => Date.now());
  }

  /** What is still waiting (this session), oldest first. */
  get pending(): readonly OutboxItem[] {
    return this.queue;
  }

  /** Keep the item, then send it after everything queued before it. */
  async add(item: OutboxItem): Promise<void> {
    // The same part or declaration again keeps its place in the queue.
    const at = this.queue.findIndex((q) => q.id === item.id);
    if (at >= 0) this.queue[at] = item;
    else this.queue.push(item);
    await this.store.put(item);
    this.pump();
  }

  /** On app load: send what an earlier page left behind. */
  async resume(): Promise<void> {
    const stored = (await this.store.all()).sort((a, b) => a.createdAt - b.createdAt);
    for (const item of stored) {
      if (this.now() - item.createdAt > MAX_AGE_MS) {
        await this.store.remove(item.id);
        continue;
      }
      if (!this.queue.some((q) => q.id === item.id)) this.queue.push({ ...item, attempts: 0 });
    }
    this.pump();
  }

  /** Resolves once the queue is empty or out of retries for this session. */
  idle(): Promise<void> {
    return this.running ?? Promise.resolve();
  }

  private pump(): void {
    if (this.running) return;
    this.running = this.drain().finally(() => {
      this.running = null;
    });
  }

  private async drain(): Promise<void> {
    while (this.queue.length) {
      const item = this.queue[0];
      const done = () => {
        this.queue = this.queue.filter((q) => q.id !== item.id);
      };
      try {
        await this.send(item);
        done();
        await this.store.remove(item.id);
      } catch (err) {
        if (isFinalRefusal(err)) {
          done();
          await this.store.remove(item.id);
          this.onLost?.(item);
          continue;
        }
        item.attempts += 1;
        if (item.attempts > BACKOFF_MS.length) {
          // Out of retries this session; it is still stored for the next load.
          item.attempts = 0;
          return;
        }
        await this.sleep(BACKOFF_MS[item.attempts - 1]);
      }
    }
  }
}
