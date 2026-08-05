/**
 * Browser crash reporting.
 *
 * Audit OBS-E2 (Critical): frontend errors were completely invisible. The
 * ErrorBoundary had an `onError` hook wired to nothing, and no listener existed
 * for `window.onerror` or unhandled promise rejections. A user hitting a white
 * screen produced no record anywhere — the only signal was them telling
 * somebody, which means every bug that did not generate a support ticket
 * effectively did not happen.
 *
 * Three sources are covered, because a React app breaks in three ways:
 *
 *   render          → ErrorBoundary.componentDidCatch  (caught by React)
 *   event handlers, → window "error"                   (never reaches React)
 *   setTimeout
 *   async/await     → window "unhandledrejection"      (never reaches React)
 *
 * The ErrorBoundary docblock is explicit that it catches only the first. The
 * other two are where most real failures live, and they were the ones going
 * nowhere at all.
 *
 * DESIGN
 *
 *   Dedupe client-side too. The server dedupes, but a render loop can fire
 *   hundreds of times a second and there is no reason to spend the user's
 *   bandwidth on it.
 *
 *   sendBeacon when the page is going away. A crash often precedes a reload or
 *   a close, and a normal fetch gets cancelled mid-flight. sendBeacon survives
 *   unload; fetch with keepalive is the fallback.
 *
 *   Never throws. Reporting an error must not itself produce one — that is an
 *   infinite loop with a network round-trip in it.
 *
 *   No PII beyond what is already in the message. The route is sent, the URL is
 *   sent; form values are not.
 */

const ENDPOINT = "/api/client-errors";
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

/** Same normalisation as the server, so the two agree on what "identical" means. */
function fingerprint(r: ClientErrorReport): string {
  const msg = r.message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>")
    .replace(/\b\d+\b/g, "<n>")
    .slice(0, 200);
  const frame = (r.stack || "").split("\n")[1]?.trim().slice(0, 120) ?? "";
  return `${r.name ?? "Error"}|${msg}|${frame}|${r.kind}`;
}

function send(body: ClientErrorReport): void {
  try {
    const payload = JSON.stringify(body);

    // A crash is frequently followed by a reload or a tab close. sendBeacon is
    // the only transport guaranteed to survive that; a plain fetch is cancelled.
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
      /* reporting must never surface an error of its own */
    });
  } catch {
    /* as above */
  }
}

/** Report a client-side error. Safe to call from anywhere, never throws. */
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
      route: r.route ?? (typeof location !== "undefined" ? location.pathname : undefined),
      url: r.url ?? (typeof location !== "undefined" ? location.href : undefined),
      stack: r.stack?.slice(0, 4000),
      componentStack: r.componentStack?.slice(0, 2000),
    });
  } catch {
    /* never let the reporter break the app */
  }
}

/**
 * Attach the two global listeners React cannot see. Call once, at boot, before
 * the app renders — an exception during module evaluation still lands here.
 */
export function installGlobalErrorReporting(): void {
  if (typeof window === "undefined") return;

  window.addEventListener("error", (e: ErrorEvent) => {
    // Resource load failures (a broken <img>) also fire this with no `error`.
    // They are noise, not crashes.
    if (!e.error && !e.message) return;
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

/** Test seam. */
export function __resetClientErrorReporting(): void {
  seen.clear();
  sentThisSession = 0;
}
