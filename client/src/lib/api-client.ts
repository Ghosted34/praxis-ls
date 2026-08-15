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
import { reportReachable, reportUnreachable } from "./connection";

/**
 * Field name -> the message(s) that failed for it.
 *
 * `string[]` is what zod's `flatten().fieldErrors` produces and what the server
 * sends. A bare `string` is admitted because the existing consumers already
 * handle both (`use-resource.ts`, `form.tsx`), and narrowing the type to
 * `string[]` alone would make the looser runtime behaviour a compile error
 * without making anything safer.
 */
export type FieldErrors = Record<string, string[] | string>;

export class ApiError extends Error {
  code: string;
  status: number;
  /**
   * Per-field validation messages, when the server sent any.
   *
   * API F-2. This used to be populated from `error.details`, which the server
   * emitted in exactly ONE file — the auth validator. Every other route (~700
   * of them) emits `error.fields`, so `details` was `undefined` and field-level
   * validation messages NEVER REACHED THE UI anywhere except login. The client
   * looked correct and silently dropped the useful half of every 422.
   *
   * Reads `fields` first now, falling back to `details` so a server that has
   * not been redeployed yet still works during a rolling deploy.
   */
  fields?: FieldErrors;
  /** @deprecated alias of `fields`; the server will stop sending it. */
  details?: unknown;
  constructor(
    code: string,
    message: string,
    status: number,
    fields?: FieldErrors,
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.fields = fields;
    this.details = fields;
  }
}

type Opts = Omit<RequestInit, "body"> & {
  body?: unknown;
  auth?: boolean;
  retry?: boolean;
};

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
export type Paged<T> = {
  data: T;
  total: number | null;
  /**
   * The window this page represents, when the server reported one.
   *
   * API F-26. Every list endpoint returned a bare array and `page()` clamps to
   * 50 rows, so every list screen in the app showed at most the 50 most recent
   * rows AND PRESENTED THEM AS THE COMPLETE SET — a tenant with 300 clients saw
   * 50 with no indication of the rest. The server now sends `meta` alongside
   * `data`; `hasMore` is the flag a list screen needs to stop lying.
   */
  limit: number | null;
  offset: number | null;
  hasMore: boolean;
  /**
   * The raw `meta` object from the response, or `null` when the server did
   * not send one.
   *
   * The typed fields above (`total`, `limit`, `offset`, `hasMore`) cover what
   * a paginated list wants; endpoints that need MORE meta — e.g.
   * `/audit/my-feed` reports `window: '24h' | 'all_time'` so the widget can
   * label its section head honestly — read it from here instead of every
   * caller re-fetching the response.
   *
   * `unknown` on the values because different endpoints ship different meta
   * shapes and this is the escape hatch, not a schema.
   */
  meta: Record<string, unknown> | null;
};

/**
 * The `code` on an `ApiError` that means "we never got an answer".
 *
 * Status is 0, because there was no HTTP status — nothing came back. Everything
 * downstream (`isNetworkError`, the connection screen, the outbox) keys off
 * this rather than sniffing for `TypeError`, whose message text differs across
 * every browser ("Failed to fetch", "NetworkError when attempting to fetch
 * resource.", "Load failed") and is therefore not something to match on.
 */
export const NETWORK_DOWN = "NETWORK_DOWN";

/** Gateway statuses that mean the request died in front of the app, not in it. */
const GATEWAY_DOWN = new Set([502, 503, 504]);

/**
 * True when the failure was the connection, not a decision the server made.
 *
 * THE DISTINCTION IS THE WHOLE POINT. A 403 and a dead wifi both used to render
 * the same red "Something went wrong." box; only one of them is fixed by
 * waiting, and only one of them should ever show the connection screen. A 500
 * is deliberately NOT a network error — the server answered, so the network is
 * demonstrably fine, and telling the user their internet is down when we have a
 * bug sends them to reboot a router that is working perfectly.
 */
export function isNetworkError(e: unknown): boolean {
  return (
    e instanceof ApiError &&
    (e.code === NETWORK_DOWN || GATEWAY_DOWN.has(e.status))
  );
}

/**
 * `fetch`, with the connection monitor wired to the outcome.
 *
 * A rejected fetch is the ONLY signal a browser gives that a request never
 * landed — there is no status, no body, and no way from here to tell "the wifi
 * died" from "DNS failed" from "the request left and the response was lost on
 * the way back". That last case is why the outbox stores an idempotency key
 * rather than simply re-sending: this layer honestly cannot promise the write
 * did not happen, so the server is given what it needs to make the replay safe.
 */
async function send(url: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (cause) {
    // An aborted request is the caller changing its mind (a cancelled query, an
    // unmounted screen), not the network failing. Reporting it as a drop would
    // put the whole app on the offline screen every time someone navigated away
    // from a slow list.
    if (cause instanceof DOMException && cause.name === "AbortError")
      throw cause;
    reportUnreachable();
    throw new ApiError(
      NETWORK_DOWN,
      "Can't reach the server — you appear to be offline.",
      0,
    );
  }
  if (GATEWAY_DOWN.has(res.status)) {
    // A 502/503/504 comes from the proxy in front of the app, which means the
    // browser's connection is fine but ours is not. Same user experience, same
    // recovery, so it takes the same path — but the real status is preserved on
    // the error so a support conversation can tell the two apart.
    reportUnreachable();
  } else {
    reportReachable();
  }
  return res;
}

/**
 * The full request, returning headers as well as the unwrapped body.
 *
 * `api()` is this with the metadata dropped. List screens that need to page
 * want the count, so it cannot simply be discarded here — but every existing
 * caller expects the bare payload, hence the two entry points.
 */
export async function apiPaged<T = unknown>(
  path: string,
  opts: Opts = {},
): Promise<Paged<T>> {
  const { body, auth = true, retry = true, headers, ...rest } = opts;
  const h = new Headers(headers);
  if (body !== undefined) h.set("Content-Type", "application/json");
  h.set("X-Praxis-Env", tokenStore.getEnv());
  if (auth) {
    const t = tokenStore.getAccess();
    if (t) h.set("Authorization", `Bearer ${t}`);
  }

  const res = await send(`/api${path}`, {
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
    throw new ApiError(
      err.code || "ERROR",
      err.message || res.statusText,
      res.status,
      err.fields ?? err.details,
    );
  }
  // Endpoints wrap payloads as { data: ... }; unwrap when present.
  //
  // Envelope-aware: the ~25 action endpoints wrapped with withResult() speak
  // { ok, changed, data?, message? } — for those, hand the envelope back
  // WHOLE so useAction can distinguish changed:true from changed:false. Any
  // response with an `ok` AND a `changed` key is such an envelope; that pair
  // was not a shape any pre-envelope endpoint returned, so this is safe.
  // useAction (client/src/lib/use-action.ts) does its own envelope unwrapping
  // downstream.
  const isEnvelope =
    json && typeof json === "object" && "ok" in json && "changed" in json;
  const data = (
    isEnvelope ? (json as unknown) : json && "data" in json ? json.data : json
  ) as T;

  // API F-26: `meta` in the body is the primary source now. The header is kept
  // as a fallback because it is absent CROSS-ORIGIN unless the API lists it in
  // CORS `exposedHeaders`, and because endpoints that do not go through the
  // shared CRUD kit send neither — in which case `total` is null and the caller
  // falls back to a single page rather than breaking.
  const meta = (json && json.meta) || null;
  const raw = res.headers.get("X-Total-Count");
  const parsed = raw === null ? NaN : Number(raw);
  const headerTotal = Number.isFinite(parsed) ? parsed : null;
  const total = typeof meta?.total === "number" ? meta.total : headerTotal;

  return {
    data,
    total,
    limit: typeof meta?.limit === "number" ? meta.limit : null,
    offset: typeof meta?.offset === "number" ? meta.offset : null,
    // Only ever true when the server actually said so. Inferring "more" from a
    // full-looking page would guess wrong on a list whose length happens to
    // equal the limit, and a pager that offers a next page that does not exist
    // is worse than no pager.
    hasMore: meta?.has_more === true,
    // Escape hatch for endpoints whose meta carries fields beyond the four
    // typed above (`/audit/my-feed` uses this for its `window` flag). See the
    // `Paged<T>.meta` doc — this is intentionally raw, not schematised.
    meta:
      meta && typeof meta === "object"
        ? (meta as Record<string, unknown>)
        : null,
  };
}

export async function api<T = unknown>(
  path: string,
  opts: Opts = {},
): Promise<T> {
  return (await apiPaged<T>(path, opts)).data;
}

/**
 * JSON request with real browser upload progress. `fetch` deliberately does not
 * expose upload progress, so file uploads use XHR while keeping the same auth,
 * tenant header, response unwrapping and one-time refresh semantics as `api()`.
 */
export async function apiWithProgress<T = unknown>(
  path: string,
  opts: Opts = {},
  onProgress?: (percent: number) => void,
): Promise<T> {
  const { body, auth = true, retry = true, headers, ...rest } = opts;
  const method = String(rest.method || "GET");

  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, `/api${path}`);
    const h = new Headers(headers);
    if (body !== undefined) h.set("Content-Type", "application/json");
    h.set("X-Praxis-Env", tokenStore.getEnv());
    if (auth) {
      const t = tokenStore.getAccess();
      if (t) h.set("Authorization", `Bearer ${t}`);
    }
    h.forEach((value, key) => xhr.setRequestHeader(key, value));

    onProgress?.(0);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        onProgress?.(
          Math.min(99, Math.round((event.loaded / event.total) * 100)),
        );
    };
    xhr.onerror = () => {
      reportUnreachable();
      reject(
        new ApiError(
          NETWORK_DOWN,
          "Can't reach the server — you appear to be offline.",
          0,
        ),
      );
    };
    xhr.onabort = () =>
      reject(new ApiError("UPLOAD_ABORTED", "The upload was cancelled.", 0));
    xhr.onload = async () => {
      const text = xhr.responseText || "";
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        /* non-JSON response */
      }

      if (xhr.status === 401 && auth && retry) {
        const ok = await tryRefresh();
        if (ok) {
          try {
            resolve(
              await apiWithProgress<T>(
                path,
                { ...opts, retry: false },
                onProgress,
              ),
            );
          } catch (e) {
            reject(e);
          }
          return;
        }
        endSession();
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        reportReachable();
        onProgress?.(100);
        const data = (
          json && typeof json === "object" && "data" in json
            ? (json as { data: T }).data
            : json
        ) as T;
        resolve(data);
        return;
      }

      const err =
        json && typeof json === "object" && "error" in json
          ? (
              json as {
                error?: {
                  code?: string;
                  message?: string;
                  fields?: FieldErrors;
                };
              }
            ).error || {}
          : {};
      reject(
        new ApiError(
          err.code || "ERROR",
          err.message || xhr.statusText,
          xhr.status,
          err.fields,
        ),
      );
    };

    xhr.send(body === undefined ? undefined : JSON.stringify(body));
  });
}

export const tenant = <T = unknown>(p: string, o?: Opts) =>
  api<T>(`/tenant${p}`, o);
export const tenantWithProgress = <T = unknown>(
  p: string,
  body: unknown,
  onProgress: (percent: number) => void,
) => apiWithProgress<T>(`/tenant${p}`, { method: "POST", body }, onProgress);
export const tenantPaged = <T = unknown>(p: string, o?: Opts) =>
  apiPaged<T>(`/tenant${p}`, o);
export const platform = <T = unknown>(p: string, o?: Opts) =>
  api<T>(`/platform${p}`, o);

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
  const res = await send(`/api${path}`, { headers: h });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let message = res.statusText;
    try {
      const j = body ? JSON.parse(body) : null;
      message = (j && j.error && j.error.message) || message;
    } catch {
      /* @silent:parse — non-JSON body */
    }
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
export const tenantDownload = (p: string, filename: string) =>
  download(`/tenant${p}`, filename);

/**
 * As `download`, but POSTs a JSON body first.
 *
 * `download` covers the usual export: a GET whose parameters fit in a query
 * string. This is for the case where the thing being exported IS the payload —
 * the assistant's Excel export sends the table rows it lifted out of an answer,
 * which are far too large for a URL and are not addressable by an id because
 * they were never persisted anywhere.
 *
 * Deliberately a sibling rather than an option on `download`: the two differ in
 * method, body and content-type, and the call sites read better naming which
 * one they mean than passing a flag.
 */
export async function downloadPost(
  path: string,
  body: unknown,
  filename: string,
): Promise<void> {
  const h = new Headers({ "Content-Type": "application/json" });
  h.set("X-Praxis-Env", tokenStore.getEnv());
  const t = tokenStore.getAccess();
  if (t) h.set("Authorization", `Bearer ${t}`);
  const res = await send(`/api${path}`, {
    method: "POST",
    headers: h,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const raw = await res.text().catch(() => "");
    let message = res.statusText;
    try {
      const j = raw ? JSON.parse(raw) : null;
      message = (j && j.error && j.error.message) || message;
    } catch {
      /* @silent:parse — non-JSON body; keep the status text */
    }
    throw new ApiError("DOWNLOAD_FAILED", message, res.status);
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
