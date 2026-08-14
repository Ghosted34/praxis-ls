/**
 * Browser crash reporting for the PLATFORM CONSOLE.
 *
 * Mirrors client/src/lib/error-reporting.ts. Two facts about this app made a
 * separate module worth it rather than a shared import:
 *
 *   1. The console has 37 source files, an ErrorBoundary that catches nothing,
 *      no window.onerror, no unhandledrejection handler, and no reporting
 *      client. If the console breaks, the error monitor it RENDERS cannot tell
 *      you (doc/ERROR_HANDLING.md §7).
 *
 *   2. `surface: "platform-console"` is the tag that makes a console bug
 *      filterable apart from a tenant-app bug. Without it, a console
 *      regression reads as a tenant regression and gets triaged wrong.
 *
 * The reporter has the same guarantees as the tenant version: cheap
 * client-side dedupe so a render loop cannot spend the origin's bandwidth,
 * sendBeacon on tab close so a crash before reload still lands, and it never
 * throws — a reporter that itself failed would be an infinite loop with a
 * network round-trip in it.
 */

const ENDPOINT = "/api/client-errors";
const SURFACE = "platform-console";

const DEDUPE_WINDOW_MS = 60_000;
const MAX_PER_SESSION = 50;

const seen = new Map<string, number>();
let sentThisSession = 0;

type Kind = "render" | "window" | "unhandledrejection";

export type ClientErrorReport = {
  message: string;
  name?: string;
  stack?: string;
  kind: Kind;
  route?: string;
  url?: string;
  componentStack?: string;
  fatal?: boolean;
  release?: string;
};

function fingerprint(r: ClientErrorReport): string {
  const msg = r.message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>")
    .replace(/\b\d+\b/g, "<n>")
    .slice(0, 200);
  const frame = (r.stack || "").split("\n")[1]?.trim().slice(0, 120) ?? "";
  return `${r.name ?? "Error"}|${msg}|${frame}|${r.kind}`;
}

function send(body: ClientErrorReport & { surface: string }): void {
  try {
    const payload = JSON.stringify(body);
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const ok = navigator.sendBeacon(ENDPOINT, new Blob([payload], { type: "application/json" }));
      if (ok) return;
    }
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => {
      /* @silent:teardown — reporting must never surface an error of its own */
    });
  } catch {
    /* @silent:teardown — as above */
  }
}

export function reportClientError(r: ClientErrorReport): void {
  try {
    if (sentThisSession >= MAX_PER_SESSION) return;
    const fp = fingerprint(r);
    const now = Date.now();
    const last = seen.get(fp);
    if (last && now - last < DEDUPE_WINDOW_MS) return;
    seen.set(fp, now);
    sentThisSession += 1;
    send({
      ...r,
      surface: SURFACE,
      route: r.route ?? (typeof location !== "undefined" ? location.pathname : undefined),
      url: r.url ?? (typeof location !== "undefined" ? location.href : undefined),
      stack: r.stack?.slice(0, 4000),
      componentStack: r.componentStack?.slice(0, 2000),
    });
  } catch {
    /* @silent:teardown — never let the reporter break the app */
  }
}

/**
 * Attach the two global listeners React cannot see. Call ONCE, at boot,
 * BEFORE the app renders — a throw during module evaluation still lands here.
 */
export function installGlobalErrorReporting(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("error", (e: ErrorEvent) => {
    if (!e.error && !e.message) return; // resource load failures are noise
    reportClientError({
      kind: "window",
      message: e.message || String(e.error),
      name: e.error?.name,
      stack: e.error?.stack,
      fatal: false,
    });
  });
  window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
    const reason = e.reason;
    reportClientError({
      kind: "unhandledrejection",
      message: reason?.message ?? String(reason),
      name: reason?.name ?? "UnhandledRejection",
      stack: reason?.stack,
      fatal: false,
    });
  });
}
