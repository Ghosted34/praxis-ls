/**
 * Connection monitor — the app's single answer to "can we reach the server?".
 *
 * WHY THIS EXISTS. Before this, a network drop produced the worst possible
 * result in a system of record: `useList` threw, `errMsg` flattened the thrown
 * `TypeError` to the default branch, and the screen rendered a bare red
 * "Something went wrong." — the same four words shown for a genuine server bug.
 * The user could not tell a dead wifi from a dead API, nothing retried, and
 * anything typed into an open form was gone the moment they reloaded to find
 * out which it was.
 *
 * `navigator.onLine` IS NOT THAT ANSWER, and this deliberately does not trust
 * it as one. It reports whether the machine has *a* network interface up, so it
 * is `true` on a captive-portal hotel wifi, on a VPN that has dropped its
 * tunnel, and whenever the API itself is down while the internet is fine — all
 * three of which are exactly the cases the user is looking at an error for. It
 * is used here only as a FAST NEGATIVE (`onLine === false` really does mean
 * offline) and as a hint to probe sooner; the authoritative signal is whether a
 * real request to our own API completed.
 *
 * TWO INPUTS, ONE STATE:
 *   1. Every response the api-client receives calls `reportReachable()` — note
 *      that a 500 counts as reachable. The server answering "I'm broken" is
 *      proof the network is fine, and dressing a genuine server bug up as an
 *      internet problem sends the user to reboot their router over our bug.
 *   2. A fetch that REJECTS (no response at all) or a 502/503/504 from a proxy
 *      calls `reportUnreachable()`.
 *
 * While unreachable it polls `/api/health` — liveness, unauthenticated, and
 * documented as touching no dependency, so the probe cannot itself fail for a
 * reason unrelated to connectivity (src/routes/health.js).
 *
 * @example  // read the state in a component
 * const { status, since } = useConnection();
 * if (status === "unreachable") return <ConnectionLost />;
 *
 * @example  // act once, on the transition back
 * React.useEffect(() => onReconnect(() => refetchEverything()), []);
 */
import * as React from "react";

export type ConnectionStatus = "online" | "unreachable";

export type ConnectionState = {
  status: ConnectionStatus;
  /** Epoch ms of the moment we went unreachable; null while online. */
  since: number | null;
  /** A probe is in flight right now — drives the "Checking…" affordance. */
  probing: boolean;
  /** Failed probes since going down. Drives the backoff and the copy. */
  attempts: number;
  /** Epoch ms the next automatic probe is due; null when none is scheduled. */
  nextProbeAt: number | null;
};

/**
 * Probe spacing, in ms, indexed by attempt count.
 *
 * The first six are the 5-second cadence the feature was specified with: a
 * blip is over in seconds and the user should not have to touch anything. After
 * half a minute it is not a blip, so it backs off — a laptop shut in a bag with
 * this tab open should not spend the afternoon firing a request every five
 * seconds into a dead network, which costs battery and, on a metered mobile
 * connection, the user's money.
 *
 * The backoff is short-circuited entirely by the `online` event and by the
 * manual Retry button, which are the two moments something actually changed.
 */
const BACKOFF_MS = [5_000, 5_000, 5_000, 5_000, 5_000, 5_000, 10_000, 20_000];
const MAX_BACKOFF_MS = 30_000;

/** A probe that has not answered in this long is a failed probe. */
const PROBE_TIMEOUT_MS = 8_000;

const delayFor = (attempts: number) => BACKOFF_MS[attempts] ?? MAX_BACKOFF_MS;

let state: ConnectionState = {
  status: "online",
  since: null,
  probing: false,
  attempts: 0,
  nextProbeAt: null,
};

const listeners = new Set<() => void>();
const reconnectListeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let installed = false;

function emit() {
  listeners.forEach((l) => l());
}

function set(next: Partial<ConnectionState>) {
  state = { ...state, ...next };
  emit();
}

function clearTimer() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

export function getConnection(): ConnectionState {
  return state;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Run `fn` on each transition from unreachable back to online.
 *
 * This is the hook the outbox and the query cache hang off: the moment the
 * server is answering again is the moment queued writes should go out and stale
 * screens should refetch. It does NOT fire on the first load while online —
 * only on a genuine recovery — so a listener can safely assume "we were just
 * down, and something may need re-doing".
 */
export function onReconnect(fn: () => void): () => void {
  reconnectListeners.add(fn);
  return () => reconnectListeners.delete(fn);
}

/**
 * The server answered. Any answer at all, including a 500.
 *
 * Cheap on purpose — this runs on every single successful response in the app,
 * so the common case is one comparison and a return.
 */
export function reportReachable(): void {
  if (state.status === "online") return;
  clearTimer();
  set({
    status: "online",
    since: null,
    probing: false,
    attempts: 0,
    nextProbeAt: null,
  });
  reconnectListeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // A listener that throws must not stop the others from being told the
      // connection is back — that would strand the outbox behind a broken
      // refetch, which is the failure this whole feature exists to prevent.
    }
  });
}

/**
 * Nothing answered. Starts the probe loop if it is not already running.
 *
 * Idempotent: a screen firing nine parallel requests (the finance hub does
 * exactly that) produces nine of these in the same tick, and they must add up
 * to ONE state transition and ONE probe loop, not nine.
 */
export function reportUnreachable(): void {
  if (state.status === "unreachable") return;
  set({ status: "unreachable", since: Date.now(), attempts: 0 });
  schedule(0);
}

function schedule(attempts: number) {
  clearTimer();
  const delay = delayFor(attempts);
  set({ nextProbeAt: Date.now() + delay });
  timer = setTimeout(() => {
    void probe();
  }, delay);
}

/**
 * Ask `/api/health` whether the server is there.
 *
 * Resolves true when it answered, false otherwise. Safe to call at any time,
 * including while online (the manual Retry button does, to confirm rather than
 * assume). Concurrent calls share the in-flight probe rather than stacking.
 */
let inFlight: Promise<boolean> | null = null;

export function probeNow(): Promise<boolean> {
  return probe();
}

function probe(): Promise<boolean> {
  if (inFlight) return inFlight;
  clearTimer();
  set({ probing: true, nextProbeAt: null });
  // Snapshotted, so a probe cannot resurrect a verdict that a REAL request has
  // meanwhile disproved. Without this, a probe that times out a second after
  // `reportReachable()` flipped us back online drags the offline UI onto the
  // screen again — and fires every reconnect listener a second time on the
  // next success, which means the outbox flushes twice.
  const probedWhileDown = state.status === "unreachable";

  inFlight = healthCheck()
    .then((ok) => {
      if (ok) {
        reportReachable();
      } else if (probedWhileDown && state.status === "unreachable") {
        const attempts = state.attempts + 1;
        set({
          status: "unreachable",
          since: state.since ?? Date.now(),
          probing: false,
          attempts,
        });
        schedule(attempts);
      }
      return ok;
    })
    .finally(() => {
      inFlight = null;
      // `reportReachable` already cleared `probing`; this covers the path where
      // the promise settled without going through either branch (a listener
      // throwing during the transition, say).
      if (state.probing) set({ probing: false });
    });

  return inFlight;
}

async function healthCheck(): Promise<boolean> {
  // A fast negative: no interface up means there is nothing to probe, and
  // issuing the request anyway just burns a timeout before the same answer.
  if (typeof navigator !== "undefined" && navigator.onLine === false)
    return false;
  try {
    const res = await fetch(`/api/health?_=${Date.now()}`, {
      method: "GET",
      // The service worker never caches /api (only fonts are runtimeCached —
      // vite.config.ts), but a probe answered from ANY cache is a lie by
      // construction, so this says so explicitly rather than relying on that
      // staying true.
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
      signal: timeoutSignal(PROBE_TIMEOUT_MS),
    });
    // 5xx from our own liveness endpoint still proves the round trip completed.
    // The question this asks is "is the server reachable", not "is it healthy" —
    // `/api/health/ready` is the endpoint for the second question, and using it
    // here would keep the user on the offline screen during a Postgres blip
    // when the app can in fact still serve most of what they were doing.
    return res.status > 0;
  } catch {
    return false;
  }
}

/**
 * `AbortSignal.timeout` with a fallback.
 *
 * The static method is Safari 16+/Chrome 103+, which the browser support target
 * covers — but this module is also imported by the vitest suite under jsdom,
 * where it has been missing in some versions, and a probe helper that throws on
 * import would take the whole app down at boot rather than degrade.
 */
function timeoutSignal(ms: number): AbortSignal | undefined {
  if (
    typeof AbortSignal !== "undefined" &&
    typeof AbortSignal.timeout === "function"
  ) {
    return AbortSignal.timeout(ms);
  }
  if (typeof AbortController === "undefined") return undefined;
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

/**
 * Wire the browser's own connectivity events. Call once, at boot.
 *
 * `offline` is trusted as an immediate negative (see the header — the false
 * case is the reliable one). `online` is NOT trusted as a positive: it fires
 * when an interface comes up, which on hotel wifi is several seconds before
 * anything can actually route. So it triggers an immediate probe instead of an
 * immediate "we're back", and the probe decides.
 */
export function installConnectionMonitor(): () => void {
  if (typeof window === "undefined" || installed) return () => {};
  installed = true;

  const onOffline = () => reportUnreachable();
  const onOnline = () => {
    if (state.status === "unreachable") {
      set({ attempts: 0 });
      void probe();
    }
  };
  // Coming back to a tab that was backgrounded during a drop should not make
  // the user wait out the remaining backoff before the app notices it is fine.
  const onVisible = () => {
    if (
      document.visibilityState === "visible" &&
      state.status === "unreachable"
    )
      void probe();
  };

  window.addEventListener("offline", onOffline);
  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisible);

  if (navigator.onLine === false) reportUnreachable();

  return () => {
    window.removeEventListener("offline", onOffline);
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisible);
    clearTimer();
    installed = false;
  };
}

/** Subscribe a component to the connection state. */
export function useConnection(): ConnectionState {
  return React.useSyncExternalStore(subscribe, getConnection, getConnection);
}

/**
 * Re-run a screen's fetch when the connection comes back.
 *
 * MUST live in the component that survives the transition, not in the one that
 * only renders while offline. `ConnectionLost` unmounts the instant the status
 * flips — React commits the new branch in the same pass — so an effect there
 * never fires on the very transition it exists for, and the screen would fall
 * back to a red box still saying "you appear to be offline". That was a real
 * bug; this hook is the reason it cannot come back.
 */
export function useRetryOnReconnect(onRetry?: () => void): void {
  const latest = React.useRef(onRetry);
  latest.current = onRetry;
  // The subscription is set up once and reads the callback through a ref, so a
  // parent re-rendering with a new inline `onRetry` does not tear down and
  // re-add the listener — and cannot miss a reconnect in the gap.
  React.useEffect(() => onReconnect(() => latest.current?.()), []);
}

/** Test seam: drop all state and listeners back to a cold boot. */
export function __resetConnectionForTests(): void {
  clearTimer();
  inFlight = null;
  installed = false;
  listeners.clear();
  reconnectListeners.clear();
  state = {
    status: "online",
    since: null,
    probing: false,
    attempts: 0,
    nextProbeAt: null,
  };
}
