/**
 * Outbox — a write that failed because the network died is held, not lost, and
 * goes out by itself when the connection comes back.
 *
 * WHY THIS EXISTS. The draft layer (`lib/form-draft.ts`) rescues what you TYPED.
 * This rescues what you SUBMITTED: the case where the user filled the form,
 * pressed Save, and the request never left the machine. Before this, that was a
 * red banner and a retyped form. Now the entry sits here and is replayed on
 * reconnect, so the honest answer to "have I lost it?" is no.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DUPLICATE-WRITE PROBLEM, AND WHY THE SERVER HAD TO CHANGE
 *
 * A rejected `fetch` does NOT mean the request never arrived. It means no
 * response came back — and "the request died on the way out" and "the request
 * was processed and the response died on the way back" are indistinguishable
 * from the browser. Replaying blindly therefore risks posting a journal entry,
 * an invoice or a payment TWICE. In an OHADA ledger that is not a rough edge,
 * it is a material misstatement, and it would be a strictly worse bug than the
 * one this feature set out to fix.
 *
 * So every entry carries an `Idempotency-Key`, generated ONCE when the write is
 * first attempted and reused on every replay, and the tenant API stores the
 * outcome against that key (`src/middleware/idempotency.js`, migration 0662).
 * A replay of a request the server already completed returns the ORIGINAL
 * response instead of doing the work again. That is what makes automatic replay
 * safe, and without it this file would have to ask the user to confirm every
 * queued write — which, at that point, is just the retyping we were avoiding.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ORDER IS PRESERVED AND FAILURES STOP THE LINE. Entries replay oldest-first,
 * one at a time, and a network failure mid-flush leaves the rest queued. An ERP
 * write sequence is frequently causal — create the dossier, then cost it, then
 * invoice it — and replaying the third after the first has failed produces a
 * 404 storm and a queue full of "rejected" entries that were never wrong.
 *
 * WHAT IT REFUSES TO DO. It does not retry a 4xx. A 403, a 409 on a closed
 * period, a 422 — those are decisions the server has already made, and re-asking
 * cannot change the answer. Those entries move to `rejected`, stay visible, and
 * wait for a human, because silently dropping a write the user believes they
 * made is the one outcome worse than telling them it failed.
 */
import { ApiError, isNetworkError, tenant } from "./api-client";
import { tokenStore } from "./token-store";
import { onReconnect } from "./connection";
import { queryClient, TENANT_KEY } from "./query-client";

const KEY = "praxis.outbox.v1";

/** Server errors are worth re-asking; after this many they are not. */
const MAX_ATTEMPTS = 4;

export type OutboxMethod = "POST" | "PUT" | "PATCH" | "DELETE";

export type OutboxEntry = {
  /** Also the `Idempotency-Key` sent to the server. Stable across replays. */
  id: string;
  /** Tenant-relative path, as passed to `tenant()` — e.g. "/entities". */
  path: string;
  method: OutboxMethod;
  body: unknown;
  /** What the user thinks this is: "Corporate entity — ACME SARL". */
  label: string;
  queuedAt: number;
  /** LIVE or SANDBOX at the time of the write. Never replayed into the other. */
  env: string;
  /**
   * Who wrote it, as the access token's subject. A queue outlives a session,
   * and replaying one person's write under another's login would misattribute
   * it in the audit trail. Optional so an entry written by an older build (or
   * with an unreadable token) still replays rather than being stranded.
   */
  user?: string;
  attempts: number;
  lastError?: string;
  /** `queued` will be retried; `rejected` needs a person. */
  state: "queued" | "rejected";
};

const listeners = new Set<() => void>();
let entries: OutboxEntry[] = [];
let loaded = false;
let flushing: Promise<FlushSummary> | null = null;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = storage()?.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    entries = Array.isArray(parsed) ? parsed.filter(isEntry) : [];
  } catch {
    entries = [];
  }
}

function isEntry(v: unknown): v is OutboxEntry {
  const e = v as OutboxEntry;
  return (
    !!e &&
    typeof e.id === "string" &&
    typeof e.path === "string" &&
    typeof e.label === "string"
  );
}

function persist(): void {
  try {
    storage()?.setItem(KEY, JSON.stringify(entries));
  } catch {
    /* @silent:storage|parse|teardown */
    // Quota, or private mode. The in-memory queue still works for this session,
    // which covers the case this exists for; it just will not survive a reload.
  }
  listeners.forEach((l) => l());
}

export function subscribeOutbox(listener: () => void): () => void {
  load();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Everything currently held, oldest first. */
export function getOutbox(): OutboxEntry[] {
  load();
  return entries;
}

/** Entries still waiting to go out — what the banner counts. */
export const queuedCount = (): number =>
  getOutbox().filter((e) => e.state === "queued").length;

/** Entries the server refused — what needs a human. */
export const rejectedCount = (): number =>
  getOutbox().filter((e) => e.state === "rejected").length;

/**
 * The signed-in user's id, read from the access token's `sub` claim.
 *
 * Decoded rather than plumbed through, because the outbox is not a React module
 * and has no route to the auth context. It is used ONLY to compare one queued
 * entry against the current session — never trusted for authorisation, which is
 * the server's job and stays the server's job.
 */
function currentUserRef(): string | undefined {
  const token = tokenStore.getAccess();
  if (!token) return undefined;
  try {
    const [, payload] = token.split(".");
    if (!payload) return undefined;
    const json = JSON.parse(
      atob(payload.replace(/-/g, "+").replace(/_/g, "/")),
    );
    const sub = json?.sub ?? json?.user_id;
    return typeof sub === "string" ? sub : undefined;
  } catch {
     /* @silent:storage|parse|teardown */ 
    // A token shape we do not recognise. Returning undefined means "unknown",
    // and an entry with an unknown author replays rather than being stranded.
    return undefined;
  }
}

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();
  // Not cryptographic, and does not need to be: this is a dedupe token scoped
  // to one tenant's write history, not a secret.
  return `ob-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export type SubmitResult<T> =
  /** The server took it. `data` is its response. */
  | { status: "sent"; data: T }
  /** The network was down. It is queued and will go out on reconnect. */
  | { status: "queued"; entry: OutboxEntry };

/**
 * Send a write, and hold it instead of failing if the network is down.
 *
 * Non-network failures THROW, exactly as `tenant()` does — a 422 must still
 * reach `<Form>`'s field-routing and a 403 must still say so. Only the "nothing
 * answered" case is swallowed into the queue, because it is the only case where
 * waiting changes the outcome.
 *
 * @example
 * const r = await submitQueued<Entity>({
 *   path: "/entities", method: "POST", body: values,
 *   label: `Corporate entity — ${values.legal_name}`,
 * });
 * if (r.status === "queued") { toast.info("Saved on this device — it will submit when you're back online."); onDone(); }
 * else { toast.success("Entity created"); onDone(); }
 */
export async function submitQueued<T>({
  path,
  method = "POST",
  body,
  label,
}: {
  path: string;
  method?: OutboxMethod;
  body?: unknown;
  label: string;
}): Promise<SubmitResult<T>> {
  load();
  const id = newId();
  try {
    const data = await tenant<T>(path, {
      method,
      body,
      headers: { "Idempotency-Key": id },
    });
    return { status: "sent", data };
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    const entry: OutboxEntry = {
      id,
      path,
      method,
      body,
      label,
      queuedAt: Date.now(),
      env: tokenStore.getEnv(),
      user: currentUserRef(),
      attempts: 1,
      state: "queued",
      lastError: e instanceof Error ? e.message : undefined,
    };
    entries = [...entries, entry];
    persist();
    return { status: "queued", entry };
  }
}

export type FlushSummary = {
  sent: number;
  rejected: number;
  remaining: number;
};

/**
 * Replay the queue, oldest first, stopping at the first network failure.
 *
 * Runs automatically on every reconnect. Safe to call at any time and safe to
 * call concurrently: a second call while one is in flight AWAITS THE RUNNING
 * FLUSH and returns its summary rather than starting a second one. Returning a
 * zeroed summary instead — which is what a naive `if (flushing) return` does —
 * would make the caller believe nothing was sent, and the reconnect toast would
 * go silent in exactly the case it exists for.
 */
export function flushOutbox(): Promise<FlushSummary> {
  load();
  if (flushing) return flushing;
  flushing = runFlush().finally(() => {
    flushing = null;
  });
  return flushing;
}

async function runFlush(): Promise<FlushSummary> {
  let sent = 0;
  let rejected = 0;

  try {
    const env = tokenStore.getEnv();
    const user = currentUserRef();
    // A snapshot: `entries` is rebuilt as we go, and iterating the live array
    // while splicing it is how you skip an entry.
    for (const entry of [...entries]) {
      if (entry.state !== "queued") continue;
      // Switching LIVE ↔ TEST must not carry the other environment's writes
      // with it. They stay queued for whenever the user switches back.
      if (entry.env !== env) continue;
      // Same argument for the person. A queue that survives a sign-out would
      // otherwise replay the previous user's write under the next user's
      // session — wrong `created_by`, wrong audit trail, and on a shared
      // dispatch desk that is not hypothetical.
      if (entry.user && user && entry.user !== user) continue;

      try {
        await tenant(entry.path, {
          method: entry.method,
          body: entry.body,
          headers: { "Idempotency-Key": entry.id },
        });
        entries = entries.filter((e) => e.id !== entry.id);
        sent += 1;
        persist();
      } catch (e) {
        if (isNetworkError(e)) {
          // Still down. Stop — everything after this depends on being able to
          // reach the server, and burning attempts against a dead network is
          // how a queue rejects itself for no reason.
          update(entry.id, { lastError: "Still offline." });
          break;
        }
        const status = e instanceof ApiError ? e.status : 0;
        const code = e instanceof ApiError ? e.code : "";
        const message = e instanceof Error ? e.message : "Failed to send.";
        // 4xx is a decision, not a blip — except the three that explicitly say
        // "ask again": 408 (timeout), 429 (slow down), and the server's own
        // IDEMPOTENCY_IN_PROGRESS, which means our FIRST attempt is still being
        // processed. Treating that last one as permanent would tell the user a
        // write failed at the exact moment it was succeeding.
        const retryable =
          status === 408 ||
          status === 429 ||
          code === "IDEMPOTENCY_IN_PROGRESS";
        const permanent = status >= 400 && status < 500 && !retryable;
        const attempts = entry.attempts + 1;
        if (permanent || attempts >= MAX_ATTEMPTS) {
          update(entry.id, { state: "rejected", attempts, lastError: message });
          rejected += 1;
        } else {
          update(entry.id, { attempts, lastError: message });
        }
        // A rejected entry does not block the ones behind it: it failed on its
        // own merits, and the next write may be unrelated.
      }
    }
  } catch {
    /* @silent:storage|parse|teardown */
    // A throw from outside the per-entry try (reading the env, say). The queue
    // is untouched and the summary reports what did get through — losing the
    // whole flush to one unexpected error would strand every entry behind it.
  }

  if (sent > 0) {
    // Everything the user was looking at may now be stale — the same coarse
    // invalidation `useRefresh()` performs after any write, and for the same
    // reason (a write in an ERP moves more than the list it happened on).
    void queryClient.invalidateQueries({ queryKey: [TENANT_KEY] });
  }
  return { sent, rejected, remaining: queuedCount() };
}

function update(id: string, patch: Partial<OutboxEntry>): void {
  entries = entries.map((e) => (e.id === id ? { ...e, ...patch } : e));
  persist();
}

/** Drop an entry — the user has decided they do not want it sent. */
export function discardEntry(id: string): void {
  load();
  entries = entries.filter((e) => e.id !== id);
  persist();
}

/** Put a rejected entry back in the queue, e.g. after the cause was fixed. */
export function retryEntry(id: string): void {
  update(id, { state: "queued", attempts: 0, lastError: undefined });
  void flushOutbox();
}

let uninstall: (() => void) | null = null;

/**
 * Start replaying on reconnect. Call once, at boot.
 *
 * Also flushes immediately, which covers the case the whole feature is for: the
 * user queued a write, the tab was closed or crashed, and the app is opening
 * again on a working connection with something still owed to the server.
 */
export function installOutbox(): () => void {
  if (uninstall) return uninstall;
  load();
  const off = onReconnect(() => {
    void flushOutbox();
  });
  if (queuedCount() > 0) void flushOutbox();
  uninstall = () => {
    off();
    uninstall = null;
  };
  return uninstall;
}

/** Test seam: empty the queue and forget every listener. */
export function __resetOutboxForTests(): void {
  entries = [];
  loaded = true;
  flushing = null;
  listeners.clear();
  uninstall?.();
  try {
    storage()?.removeItem(KEY);
  } catch {
     /* @silent:storage|parse|teardown */ 
    /* nothing to do */
  }
}
