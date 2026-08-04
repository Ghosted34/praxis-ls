/**
 * API client. Thin fetch wrapper that:
 *   - prefixes /api (Vite proxies to the Node API; Host/tenant handled there),
 *   - attaches the Bearer access token and the X-Praxis-Env header,
 *   - on a 401, transparently tries ONE refresh (POST /api/tenant/auth/refresh)
 *     and retries — unless the caller opts out (auth calls do),
 *   - throws a typed ApiError { code, message, status } on non-2xx.
 * The tenant is resolved server-side from the Host header, so the browser never
 * needs to know the tenant subdomain — the dev proxy sets it (vite.config.ts).
 */
import { tokenStore } from "./token-store";

export class ApiError extends Error {
  code: string;
  status: number;
  details?: unknown;
  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

type Opts = Omit<RequestInit, "body"> & { body?: unknown; auth?: boolean; retry?: boolean };

let refreshing: Promise<boolean> | null = null;

/**
 * Fired once when a refresh fails mid-session, i.e. the session is dead
 * server-side and cannot be recovered without signing in again.
 *
 * WHY THIS EXISTS. `api()` used to try a refresh on a 401 and, if it failed,
 * simply fall through and throw the 401 — no token clear, no state change, no
 * redirect. The app went on believing it was authenticated while holding a dead
 * refresh token, so every subsequent action produced the same error and the user
 * sat looking at "token expired" indefinitely. The only escape was a manual sign
 * out, which is exactly what users reported doing.
 *
 * The boot path in auth-context has always handled this correctly (clear tokens,
 * status → anon, back to the login screen); mid-session simply never got the
 * same treatment. This event gives it that, without api-client having to import
 * React state.
 *
 * `SESSION_ENDED_EVENT` is dispatched on `window`; auth-context listens.
 */
export const SESSION_ENDED_EVENT = "praxis:session-ended";

let sessionEndedAnnounced = false;

/**
 * Tear down a session the server has already rejected.
 *
 * Idempotent: a page mid-render can fire several failing requests at once, and
 * the user should see one transition to the login screen, not a storm of them.
 * The flag resets on a successful refresh so a later session can end too.
 */
function endSession() {
  tokenStore.clear();
  if (sessionEndedAnnounced) return;
  sessionEndedAnnounced = true;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SESSION_ENDED_EVENT));
  }
}

/**
 * Exchange the refresh token for a fresh access token, de-duped so concurrent
 * callers (the 401-retry path here AND the boot restore in auth-context) share a
 * SINGLE network refresh. This matters because the BE rotates the refresh token
 * on every refresh and revokes the session if a rotated-away token is ever
 * presented again (reuse-detection) — two independent refreshes with the same
 * token would otherwise trip that and log the user out early. Persists the
 * rotated refresh token so the next refresh presents the current one.
 */
export async function tryRefresh(): Promise<boolean> {
  const refresh_token = tokenStore.getRefresh();
  if (!refresh_token) return false;
  // De-dupe concurrent refreshes.
  if (!refreshing) {
    refreshing = fetch("/api/tenant/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token }),
    })
      .then(async (r) => {
        if (!r.ok) return false;
        const j = await r.json();
        // Unwrap { data: ... } if the endpoint wraps its payload.
        const d = j && typeof j === "object" && "data" in j ? j.data : j;
        if (d && d.access_token) {
          // A live session again — allow a future end-of-session to announce.
          sessionEndedAnnounced = false;
          tokenStore.setAccess(d.access_token);
          // Refresh-token rotation: if the BE rotates and returns a new refresh
          // token, persist it (into whichever store the keep-signed-in choice
          // selected). Today the BE returns access only, so this is a no-op.
          if (d.refresh_token) tokenStore.setRefresh(d.refresh_token);
          return true;
        }
        return false;
      })
      .catch(() => false)
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

/**
 * A response body plus the pagination metadata that rides in the headers.
 *
 * `total` is the number of rows matching the filter BEFORE the server's
 * `LIMIT` — null when the endpoint does not report one (most don't). It comes
 * from `X-Total-Count`; see src/shared/http/paged.js on the API side.
 */
export type Paged<T> = { data: T; total: number | null };

/**
 * The full request, returning headers as well as the unwrapped body.
 *
 * `api()` is this with the metadata dropped. List screens that need to page
 * want the count, so it cannot simply be discarded here — but every existing
 * caller expects the bare payload, hence the two entry points.
 */
export async function apiPaged<T = unknown>(path: string, opts: Opts = {}): Promise<Paged<T>> {
  const { body, auth = true, retry = true, headers, ...rest } = opts;
  const h = new Headers(headers);
  if (body !== undefined) h.set("Content-Type", "application/json");
  h.set("X-Praxis-Env", tokenStore.getEnv());
  if (auth) {
    const t = tokenStore.getAccess();
    if (t) h.set("Authorization", `Bearer ${t}`);
  }

  const res = await fetch(`/api${path}`, {
    ...rest,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 401 && auth && retry) {
    const ok = await tryRefresh();
    if (ok) return apiPaged<T>(path, { ...opts, retry: false });
    // Refresh failed: the session is gone (idle timeout, revoked, or the refresh
    // token no longer valid). Ending it here is what stops the app sitting on a
    // dead token showing "token expired" until the user signs out by hand.
    // The error still throws, so the caller's own handling is unchanged.
    endSession();
  }

  const text = await res.text();
  const json = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const err = (json && json.error) || {};
    throw new ApiError(err.code || "ERROR", err.message || res.statusText, res.status, err.details);
  }
  // Endpoints wrap payloads as { data: ... }; unwrap when present.
  const data = (json && "data" in json ? json.data : json) as T;

  // Absent on most endpoints, and absent CROSS-ORIGIN unless the API lists it
  // in CORS `exposedHeaders` — in which case this reads null and the caller
  // falls back to a single page rather than breaking.
  const raw = res.headers.get("X-Total-Count");
  const parsed = raw === null ? NaN : Number(raw);
  return { data, total: Number.isFinite(parsed) ? parsed : null };
}

export async function api<T = unknown>(path: string, opts: Opts = {}): Promise<T> {
  return (await apiPaged<T>(path, opts)).data;
}

export const tenant = <T = unknown>(p: string, o?: Opts) => api<T>(`/tenant${p}`, o);
export const tenantPaged = <T = unknown>(p: string, o?: Opts) => apiPaged<T>(`/tenant${p}`, o);
export const platform = <T = unknown>(p: string, o?: Opts) => api<T>(`/platform${p}`, o);

/**
 * Fetch a binary endpoint (auth + env headers) and trigger a browser download.
 * Used for file exports (csv/xlsx/pdf) where the response is a blob, not JSON —
 * a plain <a href> can't carry the Bearer token, so this fetches then saves.
 */
export async function download(path: string, filename: string): Promise<void> {
  const h = new Headers();
  h.set("X-Praxis-Env", tokenStore.getEnv());
  const t = tokenStore.getAccess();
  if (t) h.set("Authorization", `Bearer ${t}`);
  const res = await fetch(`/api${path}`, { headers: h });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let message = res.statusText;
    try { const j = body ? JSON.parse(body) : null; message = (j && j.error && j.error.message) || message; } catch { /* non-JSON body */ }
    throw new ApiError("DOWNLOAD_FAILED", message, res.status);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
export const tenantDownload = (p: string, filename: string) => download(`/tenant${p}`, filename);
