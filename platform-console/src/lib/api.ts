// Typed client for /api/platform. Envelopes: success { data }, error
// { error: { code, message, fields? } }. Stateless Bearer token (no refresh at
// the platform tier yet). 401 clears the session so the app bounces to login.
import type { LoginResult, PlatformUser } from "./types";

const LS = { base: "praxis_pc_apibase", token: "praxis_pc_token", user: "praxis_pc_user" };

function defaultBase(): string {
  return localStorage.getItem(LS.base) || window.location.origin + "/api/platform";
}

export const session = {
  base: defaultBase(),
  token: localStorage.getItem(LS.token),
  user: safeParse<PlatformUser>(localStorage.getItem(LS.user)),
};

function safeParse<T>(s: string | null): T | null {
  try {
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}

export function setBase(base: string) {
  session.base = base;
  localStorage.setItem(LS.base, base);
}

export function saveSession(base: string, token: string, user: PlatformUser) {
  session.base = base;
  session.token = token;
  session.user = user;
  localStorage.setItem(LS.base, base);
  localStorage.setItem(LS.token, token);
  localStorage.setItem(LS.user, JSON.stringify(user));
}

export function clearSession() {
  session.token = null;
  session.user = null;
  localStorage.removeItem(LS.token);
  localStorage.removeItem(LS.user);
}

export class ApiError extends Error {
  code?: string;
  status?: number;
  fields?: Record<string, string[]>;
  reauth?: boolean;
  constructor(message: string) {
    super(message);
    this.name = "ApiError";
  }
}

type ReqOpts = { method?: string; body?: unknown };

export async function api<T = unknown>(path: string, opts: ReqOpts = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (session.token) headers["Authorization"] = "Bearer " + session.token;

  const res = await fetch(session.base + path, {
    method: opts.method || "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  const txt = await res.text();
  const json = txt ? safeParse<{ data?: T; error?: { code?: string; message?: string; fields?: Record<string, string[]> } }>(txt) : null;

  if (!res.ok) {
    const err = (json && json.error) || {};
    const e = new ApiError(err.message || `Request failed (${res.status})`);
    e.code = err.code;
    e.status = res.status;
    e.fields = err.fields;
    if (res.status === 401 && session.token) {
      clearSession();
      e.reauth = true;
    }
    throw e;
  }
  return (json ? (json.data as T) : (null as T));
}

// Endpoint helpers ----------------------------------------------------------
export const platform = {
  login: (email: string, password: string) =>
    api<LoginResult>("/auth/login", { method: "POST", body: { email, password } }),

  tenants: () => api("/tenants"),
  tenant: (slug: string) => api(`/tenants/${encodeURIComponent(slug)}`),
  provision: (body: { slug: string; name: string; plan?: string; subdomain?: string }) =>
    api("/tenants", { method: "POST", body }),

  suspend: (slug: string) => api(`/tenants/${encodeURIComponent(slug)}/suspend`, { method: "POST" }),
  resume: (slug: string) => api(`/tenants/${encodeURIComponent(slug)}/resume`, { method: "POST" }),
  goLive: (slug: string) => api(`/tenants/${encodeURIComponent(slug)}/go-live`, { method: "POST" }),
  migrate: (slug: string) => api(`/tenants/${encodeURIComponent(slug)}/migrate`, { method: "POST" }),
  wipeSandbox: (slug: string) => api(`/tenants/${encodeURIComponent(slug)}/sandbox/wipe`, { method: "POST" }),
  setCapacity: (slug: string, tier: string) =>
    api(`/tenants/${encodeURIComponent(slug)}/capacity`, { method: "PATCH", body: { tier } }),
  setSandbox: (slug: string, days: number) =>
    api(`/tenants/${encodeURIComponent(slug)}/sandbox`, { method: "PATCH", body: { days } }),

  features: (slug: string) => api(`/tenants/${encodeURIComponent(slug)}/features`),
  setFeature: (slug: string, key: string, state: "on" | "off") =>
    api(`/tenants/${encodeURIComponent(slug)}/features/${encodeURIComponent(key)}`, { method: "PATCH", body: { state } }),
  clearFeature: (slug: string, key: string) =>
    api(`/tenants/${encodeURIComponent(slug)}/features/${encodeURIComponent(key)}`, { method: "DELETE" }),

  plans: () => api("/plans"),
  modules: () => api("/catalogue/modules"),
  catalogueFeatures: () => api("/catalogue/features"),

  // Added this session (BE: GET /api/platform/audit).
  audit: (params?: { tenant?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.tenant) q.set("tenant", params.tenant);
    if (params?.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return api(`/audit${qs ? "?" + qs : ""}`);
  },

  // Support & Feedback triage (BE: /api/platform/support/*).
  supportTickets: (params?: { status?: string; kind?: string; tenant?: string }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    if (params?.kind) q.set("kind", params.kind);
    if (params?.tenant) q.set("tenant", params.tenant);
    const qs = q.toString();
    return api(`/support/tickets${qs ? "?" + qs : ""}`);
  },
  setTicketStatus: (id: string, status: string) =>
    api(`/support/tickets/${encodeURIComponent(id)}`, { method: "PATCH", body: { status } }),
};
