// Typed client for /api/platform. Envelopes: success { data }, error
// { error: { code, message, fields? } }. Stateless Bearer token + refresh token:
// on a 401 the client transparently exchanges the refresh token for a fresh
// access token (POST /auth/refresh) and retries; only if THAT fails does it
// clear the session and bounce to login. Keeps an admin signed in past the short
// access TTL instead of getting kicked out on the next request.
import type { LoginResult, PlatformUser } from "./types";

const LS = { base: "praxis_pc_apibase", token: "praxis_pc_token", refresh: "praxis_pc_refresh", user: "praxis_pc_user" };

function defaultBase(): string {
  return localStorage.getItem(LS.base) || window.location.origin + "/api/platform";
}

export const session = {
  base: defaultBase(),
  token: localStorage.getItem(LS.token),
  refresh: localStorage.getItem(LS.refresh),
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

export function saveSession(base: string, token: string, refresh: string | null, user: PlatformUser) {
  session.base = base;
  session.token = token;
  session.refresh = refresh;
  session.user = user;
  localStorage.setItem(LS.base, base);
  localStorage.setItem(LS.token, token);
  if (refresh) localStorage.setItem(LS.refresh, refresh);
  else localStorage.removeItem(LS.refresh);
  localStorage.setItem(LS.user, JSON.stringify(user));
}

export function clearSession() {
  session.token = null;
  session.refresh = null;
  session.user = null;
  localStorage.removeItem(LS.token);
  localStorage.removeItem(LS.refresh);
  localStorage.removeItem(LS.user);
}

/** Does the signed-in platform user have a capability? (Root Admin gets all,
 *  reflected server-side in the login payload's capabilities.) */
export function can(cap: string): boolean {
  const caps = session.user?.capabilities;
  return Array.isArray(caps) ? caps.includes(cap) : false;
}

// De-duped refresh: concurrent 401s share ONE /auth/refresh network call.
let refreshing: Promise<boolean> | null = null;
async function tryRefresh(): Promise<boolean> {
  if (!session.refresh) return false;
  if (!refreshing) {
    refreshing = fetch(session.base + "/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ refresh_token: session.refresh }),
    })
      .then(async (r) => {
        if (!r.ok) return false;
        const txt = await r.text();
        const j = txt ? safeParse<{ data?: LoginResult }>(txt) : null;
        const d = j && j.data;
        if (d && d.access_token) {
          session.token = d.access_token;
          localStorage.setItem(LS.token, d.access_token);
          if (d.refresh_token) {
            session.refresh = d.refresh_token;
            localStorage.setItem(LS.refresh, d.refresh_token);
          }
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

type ReqOpts = { method?: string; body?: unknown; retry?: boolean };

export async function api<T = unknown>(path: string, opts: ReqOpts = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (session.token) headers["Authorization"] = "Bearer " + session.token;

  const res = await fetch(session.base + path, {
    method: opts.method || "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  // Access token expired: transparently refresh ONCE and retry before giving up.
  if (res.status === 401 && session.token && opts.retry !== false && !path.startsWith("/auth/")) {
    const ok = await tryRefresh();
    if (ok) return api<T>(path, { ...opts, retry: false });
  }

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
  createAdmin: (slug: string, body: { email: string; name?: string; password: string; role?: string }) =>
    api(`/tenants/${encodeURIComponent(slug)}/admin`, { method: "POST", body }),

  suspend: (slug: string) => api(`/tenants/${encodeURIComponent(slug)}/suspend`, { method: "POST" }),
  resume: (slug: string) => api(`/tenants/${encodeURIComponent(slug)}/resume`, { method: "POST" }),
  goLive: (slug: string) => api(`/tenants/${encodeURIComponent(slug)}/go-live`, { method: "POST" }),
  migrate: (slug: string) => api(`/tenants/${encodeURIComponent(slug)}/migrate`, { method: "POST" }),
  wipeSandbox: (slug: string) => api(`/tenants/${encodeURIComponent(slug)}/sandbox/wipe`, { method: "POST" }),
  setPlan: (slug: string, plan: string) =>
    api(`/tenants/${encodeURIComponent(slug)}/plan`, { method: "PATCH", body: { plan } }),
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
  createPlan: (body: { code: string; name: string; price_setup_xaf?: number; price_yearly_xaf?: number }) =>
    api("/plans", { method: "POST", body }),
  updatePlan: (id: string, body: { name?: string; price_setup_xaf?: number; price_yearly_xaf?: number }) =>
    api(`/plans/${encodeURIComponent(id)}`, { method: "PATCH", body }),
  planFeatures: (id: string) => api(`/plans/${encodeURIComponent(id)}/features`),
  setPlanFeatures: (id: string, features: { feature_key: string; included: boolean }[]) =>
    api(`/plans/${encodeURIComponent(id)}/features`, { method: "PUT", body: { features } }),
  deletePlan: (id: string, replacement?: string) =>
    api(`/plans/${encodeURIComponent(id)}`, { method: "DELETE", body: { replacement } }),

  // RBAC roles + permission matrix
  capabilities: () => api("/catalogue/capabilities"),
  roles: () => api("/roles"),
  createRole: (body: { code: string; name: string; capabilities?: string[] }) =>
    api("/roles", { method: "POST", body }),
  setRolePermissions: (id: string, capabilities: string[]) =>
    api(`/roles/${encodeURIComponent(id)}/permissions`, { method: "PUT", body: { capabilities } }),
  deleteRole: (id: string) => api(`/roles/${encodeURIComponent(id)}`, { method: "DELETE" }),

  // Platform users
  users: () => api("/users"),
  createUser: (body: { email: string; full_name?: string; password: string; role?: string }) =>
    api("/users", { method: "POST", body }),
  updateUser: (id: string, body: { full_name?: string; role?: string; is_active?: boolean }) =>
    api(`/users/${encodeURIComponent(id)}`, { method: "PATCH", body }),
  setUserPassword: (id: string, password: string) =>
    api(`/users/${encodeURIComponent(id)}/password`, { method: "POST", body: { password } }),
  deleteUser: (id: string) => api(`/users/${encodeURIComponent(id)}`, { method: "DELETE" }),

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

  // Deploy-wide integrations (S3 / Geoapify / VAPID). Secrets are write-only:
  // reads return presence + last4, writes send { value?, secret? }.
  settings: () => api<PlatformSetting[]>("/settings"),
  putSetting: (section: string, key: string, body: { value?: Record<string, unknown>; secret?: string }) =>
    api<PlatformSetting>(`/settings/${encodeURIComponent(section)}/${encodeURIComponent(key)}`, { method: "PUT", body }),
  testSetting: (section: string, key: string) =>
    api<SettingTestResult>(`/settings/${encodeURIComponent(section)}/${encodeURIComponent(key)}/test`, { method: "POST" }),
  generateVapid: (subject?: string) =>
    api<{ public_key: string; subject: string }>("/settings/push/vapid/generate", { method: "POST", body: { subject } }),
};

export type PlatformSetting = {
  section: string;
  key: string;
  value: Record<string, unknown>;
  secret_set: boolean;
  last4: string | null;
  version: number;
  updated_at: string;
};
export type SettingTestResult = { ok: boolean; error?: string; status?: number } & Record<string, unknown>;
