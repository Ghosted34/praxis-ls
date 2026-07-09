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

async function tryRefresh(): Promise<boolean> {
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
        if (j.access_token) {
          tokenStore.setAccess(j.access_token);
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

export async function api<T = unknown>(path: string, opts: Opts = {}): Promise<T> {
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
    if (ok) return api<T>(path, { ...opts, retry: false });
  }

  const text = await res.text();
  const json = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const err = (json && json.error) || {};
    throw new ApiError(err.code || "ERROR", err.message || res.statusText, res.status, err.details);
  }
  // Endpoints wrap payloads as { data: ... }; unwrap when present.
  return (json && "data" in json ? json.data : json) as T;
}

export const tenant = <T = unknown>(p: string, o?: Opts) => api<T>(`/tenant${p}`, o);
export const platform = <T = unknown>(p: string, o?: Opts) => api<T>(`/platform${p}`, o);
