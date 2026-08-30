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

import { tStatic } from "./i18n";

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

export async function portalApi<T = unknown>(
  path: string,
  opts: Opts = {},
): Promise<T> {
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
    throw new PortalError(
      err.code || "ERROR",
      err.message || res.statusText,
      res.status,
    );
  }
  return (json && "data" in json ? json.data : json) as T;
}

// ── Shapes returned by the backend (portal.service / portal_auth.service) ──

export type PortalUser = {
  portal_user_id: string;
  email: string;
  full_name?: string | null;
};
export type PortalGrant = {
  allowed: boolean;
  client_id: string | null;
  expires_at: string | null;
};
export type PortalMe = {
  portal_user: PortalUser;
  grants: Record<"CLIENT" | "INVESTOR" | "AUDITOR", PortalGrant>;
};

export type PortalDossier = {
  dossier_id: string;
  ref: string;
  status: string;
  created_at: string;
};
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
  portalApi<{ ok: true }>("/auth/forgot", {
    method: "POST",
    auth: false,
    body: { email },
  });

export const portalAccept = (token: string, password: string) =>
  portalApi<{ access_token: string; portal_user: PortalUser }>("/auth/accept", {
    method: "POST",
    auth: false,
    body: { token, password },
  });

type IncomeStatement = {
  charges: number;
  produits: number;
  hao_net: number;
  result: number;
};
type BalanceSheet = {
  active: number;
  passif: number;
  result: number;
  balanced: boolean;
};

export type InvestorView = {
  portal: "INVESTOR";
  /** OHADA basis. PRD open question 4 (IFRS view) resolved as OHADA — no restatement layer. */
  basis: "OHADA";
  period: { from: string; to: string };
  kpis: {
    revenue: number;
    charges: number;
    net_result: number;
    net_margin_pct: number | null;
    expense_ratio_pct: number | null;
    cash_on_hand: number;
    balance_sheet_total: number;
  };
  income_statement: IncomeStatement;
  balance_sheet: BalanceSheet;
  cash_position: {
    accounts: { account_code: string; balance: number }[];
    total_cash: number;
  };
  cash_flow: Record<string, unknown>;
};

export type AuditTrailEntry = {
  ledger_id: number;
  action: string;
  module_key: string | null;
  entity_ref: string | null;
  created_at: string;
  actor_user_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
};
export type TrialBalanceRow = {
  account_code: string;
  debit: string | number;
  credit: string | number;
};
export type AuditorView = {
  portal: "AUDITOR";
  basis: "OHADA";
  period: { from: string; to: string };
  scope: { entity_id: string | null };
  disclosure: string;
  income_statement: IncomeStatement;
  balance_sheet: BalanceSheet;
  cash_flow: Record<string, unknown>;
  trial_balance: {
    rows: TrialBalanceRow[];
    totals: { debit: number; credit: number; balanced?: boolean };
  };
  procurement_spend: unknown;
  audit_trail: AuditTrailEntry[];
};

export const portalMe = () => portalApi<PortalMe>("/me");
export const portalClientView = () => portalApi<ClientView>("/client");

/** A client-visible vault document (PRD §11.1 — the client's document vault). */
export type PortalDocument = {
  doc_id: string;
  doc_type: string | null;
  original_name: string | null;
  status: string;
  created_at: string;
  dossier_id: string | null;
  dossier_ref: string | null;
  name_en: string | null;
  name_fr: string | null;
  doc_type_code: string | null;
};

export const portalClientDocuments = () =>
  portalApi<PortalDocument[]>("/client/documents");

/**
 * Fetch a client-visible document with the portal session and save it. Same
 * reasoning as the staff `downloadVaultDoc`: the /download endpoint returns
 * bytes (not JSON), so we fetch with the portal token and trigger a real
 * Save-As via an anchor click rather than a pop-up-prone window.open.
 */
export async function portalClientDocumentDownload(
  id: string,
  filename: string,
): Promise<void> {
  const token = portalToken.get();
  const res = await fetch(
    `/api/tenant/portal/client/documents/${encodeURIComponent(id)}/download`,
    {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    },
  );
  if (!res.ok) {
    const message =
      res.status === 404
        ? tStatic("errors.docGone")
        : res.status === 401
          ? tStatic("errors.sessionExpired")
          : tStatic("errors.downloadFailed");
    throw new PortalError("DOWNLOAD_FAILED", message, res.status);
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

/**
 * One of the client's own files: the stages we chose to show them, the dates
 * they were committed to, and the published assumptions those dates rest on.
 * The forecast field is present only when the tenant has opted to share it.
 */
export type PortalChainStage = {
  code: string;
  label: string;
  label_en?: string | null;
  planned_due?: string | null;
  forecast_due?: string | null;
  status: string;
  completed_at?: string | null;
  stage_seq?: number;
};
export type PortalAssumption = {
  code: string;
  text_fr: string;
  text_en?: string | null;
};
export type PortalChain = {
  dossier: {
    dossier_id: string;
    ref: string;
    status: string;
    service_fr?: string | null;
    service_en?: string | null;
  };
  milestones: PortalChainStage[];
  assumptions: PortalAssumption[];
};
export const portalClientChain = (dossierId: string) =>
  portalApi<PortalChain>(`/client/dossier/${dossierId}`);

/** Q tickets — a client's queries, raised against a milestone and kept in-system. */
export type PortalTicket = {
  q_ticket_id: string;
  subject: string;
  body?: string | null;
  status: string;
  created_at: string;
  dossier_ref?: string | null;
  milestone_label?: string | null;
};
export const portalTickets = () => portalApi<PortalTicket[]>("/client/tickets");
export const portalRaiseTicket = (body: {
  dossier_id: string;
  milestone_instance_id?: string;
  subject: string;
  body?: string;
}) => portalApi<PortalTicket>("/client/tickets", { method: "POST", body });
const periodQs = (q?: { from?: string; to?: string }) =>
  new URLSearchParams(
    Object.entries(q || {}).filter(([, v]) => !!v) as [string, string][],
  ).toString();
export const portalInvestorView = (q?: { from?: string; to?: string }) => {
  const s = periodQs(q);
  return portalApi<InvestorView>(`/investor${s ? `?${s}` : ""}`);
};
export const portalAuditorView = (q?: { from?: string; to?: string }) => {
  const s = periodQs(q);
  return portalApi<AuditorView>(`/auditor${s ? `?${s}` : ""}`);
};

// ── Auditor data room (PRD §5.2 — "data room for document requests/answers") ─

export type PortalDataRoom = {
  room_id: string;
  subject_email: string;
  request_note: string;
  status: "OPEN" | "ANSWERED";
  created_at: string;
  answered_at: string | null;
  answered_by: string | null;
  doc_count: number;
};

export type PortalDataRoomDoc = {
  doc_id: string;
  doc_type: string | null;
  original_name: string | null;
  created_at: string;
  name_en: string | null;
  name_fr: string | null;
  doc_type_code: string | null;
};

export type PortalDataRoomDetail = {
  room: PortalDataRoom;
  docs: PortalDataRoomDoc[];
};

export const portalDataRoomList = () =>
  portalApi<PortalDataRoom[]>("/auditor/data-room");
export const portalDataRoomCreate = (note: string) =>
  portalApi<PortalDataRoom>("/auditor/data-room", {
    method: "POST",
    body: { note },
  });
export const portalDataRoomDetail = (id: string) =>
  portalApi<PortalDataRoomDetail>(
    `/auditor/data-room/${encodeURIComponent(id)}`,
  );

// ── Client portal: onboarding, messaging, self-service quoting (PRD §11.1) ──

export type PortalOnboardingStep = {
  client_onboarding_step_id: string;
  step_key: string;
  label_en: string;
  label_fr: string;
  done: boolean;
  done_at: string | null;
  done_by: string | null;
  sort_order: number;
};

export type PortalOnboarding = {
  client_id: string;
  steps: PortalOnboardingStep[];
  progress: number;
};

export type PortalMessage = {
  message_id: string;
  client_id: string;
  dossier_id: string | null;
  direction: "STAFF" | "CLIENT";
  body: string;
  author_user_id: string | null;
  author_email: string | null;
  author_name: string | null;
  created_at: string;
};

export type PortalQuoteRequest = {
  quote_request_id: string;
  public_ref: string | null;
  status: string;
  service_category: string | null;
  service_type: string | null;
  origin_location: string | null;
  destination_location: string | null;
  estimated_weight: number | null;
  cargo_description: string | null;
  created_at: string;
};

export const portalClientOnboarding = () =>
  portalApi<PortalOnboarding>("/client/onboarding");

export const portalClientMessages = () =>
  portalApi<PortalMessage[]>("/client/messages");
export const portalClientMessageSend = (body: string) =>
  portalApi<PortalMessage>("/client/messages", {
    method: "POST",
    body: { body },
  });

/** Fetch the certified chat PDF with the portal session and save it. The
 *  verify token comes back in the X-Praxis-Verify header. */
export async function portalClientMessagesExport(): Promise<void> {
  const token = portalToken.get();
  const res = await fetch("/api/tenant/portal/client/messages/export", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const message =
      res.status === 401
        ? tStatic("errors.sessionExpired")
        : tStatic("errors.exportFailed");
    throw new PortalError("EXPORT_FAILED", message, res.status);
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = `conversation-${new Date().toISOString().slice(0, 10)}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const portalClientQuoteRequests = () =>
  portalApi<PortalQuoteRequest[]>("/client/quote-requests");
export const portalClientQuoteCreate = (data: {
  service_category: string;
  service_type?: string;
  origin_location: string;
  destination_location: string;
  estimated_weight?: number;
  cargo_description?: string;
  incoterm?: string;
}) =>
  portalApi<PortalQuoteRequest>("/client/quote-requests", {
    method: "POST",
    body: data,
  });

/** Fetch an answered document with the portal session and save it. */
export async function portalDataRoomDownload(
  roomId: string,
  docId: string,
  filename: string,
): Promise<void> {
  const token = portalToken.get();
  const res = await fetch(
    `/api/tenant/portal/auditor/data-room/${encodeURIComponent(roomId)}/documents/${encodeURIComponent(docId)}/download`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  );
  if (!res.ok) {
    const message =
      res.status === 404
        ? tStatic("errors.roomDocGone")
        : res.status === 401
          ? tStatic("errors.sessionExpired")
          : tStatic("errors.downloadFailed");
    throw new PortalError("DOWNLOAD_FAILED", message, res.status);
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
