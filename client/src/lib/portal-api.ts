/**
 * API client for the EXTERNAL portal.
 *
 * Deliberately separate from `lib/api-client.ts` rather than a flag on it. A
 * portal user is not an `app_user`: they have no role, no capability, no refresh
 * token and no session row. Sharing the staff client would mean sharing the
 * staff token store and its refresh-on-401 path, and the first bug in that seam
 * is a portal token being sent to a staff endpoint, or a staff session being
 * clobbered because a client contact signed in on the same browser.
 *
 * So: its own storage key, its own fetch, no refresh. The token is short-lived
 * (2h, `portal_auth.service` TOKEN_TTL); when it expires the user signs in again.
 */

const TOKEN_KEY = "praxis.portal.token";

/**
 * sessionStorage, not localStorage, and not "remember me".
 *
 * These sessions are often opened on a shared or borrowed machine — a client's
 * office PC, an auditor's laptop — and the data behind them is somebody's
 * commercial position. Closing the tab ends it. The staff app makes the opposite
 * choice for its own users, and that difference is intentional.
 */
export const portalToken = {
  get: (): string | null => sessionStorage.getItem(TOKEN_KEY),
  set: (t: string) => sessionStorage.setItem(TOKEN_KEY, t),
  clear: () => sessionStorage.removeItem(TOKEN_KEY),
};

export class PortalError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "PortalError";
    this.code = code;
    this.status = status;
  }
}

type Opts = Omit<RequestInit, "body"> & { body?: unknown; auth?: boolean };

export async function portalApi<T = unknown>(path: string, opts: Opts = {}): Promise<T> {
  const { body, auth = true, headers, ...rest } = opts;
  const h = new Headers(headers);
  if (body !== undefined) h.set("Content-Type", "application/json");
  if (auth) {
    const t = portalToken.get();
    if (t) h.set("Authorization", `Bearer ${t}`);
  }

  const res = await fetch(`/api/tenant/portal${path}`, {
    ...rest,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  const json = text ? JSON.parse(text) : null;

  if (res.status === 401 && auth) {
    // No refresh path exists for portal tokens, so an expired one is terminal:
    // drop it so the guard sends them to sign in rather than looping on 401s.
    portalToken.clear();
  }
  if (!res.ok) {
    const err = (json && json.error) || {};
    throw new PortalError(err.code || "ERROR", err.message || res.statusText, res.status);
  }
  return (json && "data" in json ? json.data : json) as T;
}

// ── Shapes returned by the backend (portal.service / portal_auth.service) ──

export type PortalUser = { portal_user_id: string; email: string; full_name?: string | null };
export type PortalGrant = { allowed: boolean; client_id: string | null; expires_at: string | null };
export type PortalMe = { portal_user: PortalUser; grants: Record<"CLIENT" | "INVESTOR" | "AUDITOR", PortalGrant> };

export type PortalDossier = { dossier_id: string; ref: string; status: string; created_at: string };
export type PortalInvoice = {
  invoice_id: string;
  doc_number: string | null;
  total_ttc: string | number | null;
  status: string;
  payment_due_on: string | null;
};
export type ClientView = {
  portal: "CLIENT";
  client_id: string;
  dossiers: PortalDossier[];
  invoices: PortalInvoice[];
  receivables_ageing: unknown;
};

export const portalLogin = (email: string, password: string) =>
  portalApi<{ access_token: string; portal_user: PortalUser }>("/auth/login", {
    method: "POST",
    auth: false,
    body: { email, password },
  });

export const portalForgot = (email: string) =>
  portalApi<{ ok: true }>("/auth/forgot", { method: "POST", auth: false, body: { email } });

export const portalAccept = (token: string, password: string) =>
  portalApi<{ access_token: string; portal_user: PortalUser }>("/auth/accept", {
    method: "POST",
    auth: false,
    body: { token, password },
  });

export type InvestorView = {
  portal: "INVESTOR";
  /** OHADA as kept. Surfaced because PRD open question 4 (IFRS view) is unanswered. */
  basis: "OHADA";
  period: { from: string; to: string };
  kpis: {
    revenue: number;
    charges: number;
    net_result: number;
    cash_on_hand: number;
    balance_sheet_total: number;
  };
  income_statement: { charges: number; produits: number; hao_net: number; result: number };
  balance_sheet: { active: number; passif: number; result: number; balanced: boolean };
  cash_position: { accounts: { account_code: string; balance: number }[]; total_cash: number };
  cash_flow: Record<string, unknown>;
};

export const portalMe = () => portalApi<PortalMe>("/me");
export const portalClientView = () => portalApi<ClientView>("/client");
export const portalInvestorView = (q?: { from?: string; to?: string }) => {
  const s = new URLSearchParams(Object.entries(q || {}).filter(([, v]) => !!v) as [string, string][]).toString();
  return portalApi<InvestorView>(`/investor${s ? `?${s}` : ""}`);
};
