/**
 * API client for the EXTERNAL portal.
 *
 * Separate from anything the staff app does, on purpose: a portal user is not
 * an `app_user`, has no role, and must never have a portal token sent to a
 * staff endpoint or a staff session clobbered by a client signing in on the
 * same browser. Its own storage keys (lib/portal-session.ts), its own fetch.
 *
 * What it adds over a bare fetch:
 *   · ONE retry after a refresh, when the device was kept signed in and the
 *     two-hour access token has run out — so a client who opens the portal
 *     tomorrow lands on their home screen, not on a sign-in form.
 *   · Uploads with real progress (XMLHttpRequest, not fetch — fetch still has
 *     no upload progress), so a slow photo on a phone shows a percentage
 *     instead of a frozen screen.
 */

import { tStatic } from "./i18n";
import { portalSession, refreshPortalSession, PORTAL_SIGNED_OUT } from "./portal-session";

const BASE = "/api/tenant/portal";

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

function signedOut() {
  portalSession.dropAccess();
  window.dispatchEvent(new CustomEvent(PORTAL_SIGNED_OUT));
}

async function send(path: string, opts: Opts): Promise<Response | null> {
  const { body, auth = true, headers, ...rest } = opts;
  const h = new Headers(headers);
  if (body !== undefined) h.set("Content-Type", "application/json");
  if (auth) {
    const t = portalSession.access();
    if (t) h.set("Authorization", `Bearer ${t}`);
  }
  return fetch(`${BASE}${path}`, {
    ...rest,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => null);
}

async function errorFrom(res: Response): Promise<PortalError> {
  const text = await res.text().catch(() => "");
  let json: { error?: { code?: string; message?: string } } | null = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  const err = (json && json.error) || {};
  return new PortalError(err.code || "ERROR", err.message || tStatic("errors.generic"), res.status);
}

export async function portalApi<T = unknown>(path: string, opts: Opts = {}): Promise<T> {
  let res = await send(path, opts);
  if (!res) throw new PortalError("OFFLINE", tStatic("portal.offline"), 0);
  if (res.status === 401 && opts.auth !== false) {
    // One retry, and only if a refresh actually happened — never a loop.
    if (await refreshPortalSession()) {
      res = await send(path, opts);
      if (!res) throw new PortalError("OFFLINE", tStatic("portal.offline"), 0);
    }
    if (res.status === 401) signedOut();
  }
  if (!res.ok) throw await errorFrom(res);
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  return (json && "data" in json ? json.data : json) as T;
}

/**
 * Multipart upload with progress. `onProgress` receives 0-100 for the bytes
 * sent; the caller shows "Upload complete" only once this resolves, which is
 * when the SERVER has answered — not when the last byte left the phone.
 */
export function portalUpload<T = unknown>(
  path: string,
  form: FormData,
  onProgress?: (pct: number) => void,
): Promise<T> {
  const attempt = () =>
    new Promise<{ status: number; body: string }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${BASE}${path}`);
      const t = portalSession.access();
      if (t) xhr.setRequestHeader("Authorization", `Bearer ${t}`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.min(99, Math.round((e.loaded / e.total) * 100)));
      };
      xhr.onload = () => resolve({ status: xhr.status, body: xhr.responseText });
      xhr.onerror = () => reject(new PortalError("OFFLINE", tStatic("portal.offline"), 0));
      xhr.send(form);
    });
  const parse = (r: { status: number; body: string }): T => {
    let json: { data?: T; error?: { code?: string; message?: string } } | null = null;
    try {
      json = r.body ? JSON.parse(r.body) : null;
    } catch {
      json = null;
    }
    if (r.status < 200 || r.status >= 300) {
      const e = (json && json.error) || {};
      throw new PortalError(e.code || "ERROR", e.message || tStatic("errors.generic"), r.status);
    }
    onProgress?.(100);
    return (json && "data" in json ? json.data : json) as T;
  };
  return attempt().then(async (r) => {
    if (r.status === 401 && (await refreshPortalSession())) return parse(await attempt());
    if (r.status === 401) signedOut();
    return parse(r);
  });
}

/** Bytes to a Save-As, with the session. A pop-up-free anchor click. */
export async function portalDownload(path: string, filename: string): Promise<void> {
  const get = () => {
    const t = portalSession.access();
    return fetch(`${BASE}${path}`, { headers: t ? { Authorization: `Bearer ${t}` } : {} }).catch(() => null);
  };
  let res = await get();
  if (res && res.status === 401 && (await refreshPortalSession())) res = await get();
  if (!res || !res.ok) {
    const message = !res
      ? tStatic("portal.offline")
      : res.status === 404
        ? tStatic("errors.docGone")
        : res.status === 401
          ? tStatic("errors.sessionExpired")
          : tStatic("errors.downloadFailed");
    throw new PortalError("DOWNLOAD_FAILED", message, res ? res.status : 0);
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

// ── Sign-in ─────────────────────────────────────────────────────────────────

export type PortalUser = {
  portal_user_id: string;
  email: string;
  full_name?: string | null;
};
export type Tokens = {
  access_token: string;
  refresh_token?: string | null;
  portal_user: PortalUser;
  trusted?: boolean;
  credential_id?: string;
};

export const portalLogin = (email: string, password: string, trust: boolean) =>
  portalApi<Tokens>("/auth/login", { method: "POST", auth: false, body: { email, password, trust_device: trust } });
export const portalRequestCode = (email: string) =>
  portalApi<{ ok: true }>("/auth/code", { method: "POST", auth: false, body: { email } });
export const portalVerifyCode = (email: string, code: string, trust: boolean) =>
  portalApi<Tokens>("/auth/code/verify", { method: "POST", auth: false, body: { email, code, trust_device: trust } });
export const portalForgot = (email: string) =>
  portalApi<{ ok: true }>("/auth/forgot", { method: "POST", auth: false, body: { email } });
export const portalAccept = (token: string, password: string, trust: boolean) =>
  portalApi<Tokens>("/auth/accept", { method: "POST", auth: false, body: { token, password, trust_device: trust } });
export const portalLogout = () => {
  const refresh_token = portalSession.refreshToken();
  return portalApi<{ ok: true }>("/auth/logout", {
    method: "POST",
    auth: false,
    body: refresh_token ? { refresh_token } : {},
  }).catch(() => ({ ok: true }));
};
export const portalPasskeyLoginOptions = (email: string | null, credentialIds: string[]) =>
  portalApi<Record<string, unknown>>("/auth/passkey/login/options", {
    method: "POST",
    auth: false,
    body: { email, credential_ids: credentialIds },
  });
export const portalPasskeyLoginVerify = (assertion: unknown, challengeToken: string, trust: boolean) =>
  portalApi<Tokens>("/auth/passkey/login/verify", {
    method: "POST",
    auth: false,
    body: { assertion, challengeToken, trust_device: trust },
  });
export const portalPasskeyRegisterOptions = () =>
  portalApi<Record<string, unknown>>("/auth/passkey/register/options", { method: "POST" });
export const portalPasskeyRegisterVerify = (attestation: unknown, challengeToken: string) =>
  portalApi<{ credential_id: string; label: string | null }>("/auth/passkey/register/verify", {
    method: "POST",
    body: { attestation, challengeToken },
  });
export type PortalPasskey = { credential_id: string; label: string | null; created_at: string; last_used_at: string | null };
export const portalPasskeys = () => portalApi<PortalPasskey[]>("/auth/passkeys");
export const portalDeletePasskey = (id: string) =>
  portalApi<{ deleted: true }>(`/auth/passkeys/${encodeURIComponent(id)}`, { method: "DELETE" });
export type PortalDevice = {
  portal_session_id: string;
  method: string;
  device_label: string | null;
  created_at: string;
  last_seen_at: string;
  is_current: boolean;
};
export const portalDevices = () => portalApi<PortalDevice[]>("/auth/sessions");
export const portalRevokeDevice = (id: string) =>
  portalApi<{ revoked: true }>(`/auth/sessions/${encodeURIComponent(id)}/revoke`, { method: "POST" });

// ── Who is signed in ────────────────────────────────────────────────────────

export type Scope = "ALL" | "OPERATIONS" | "BILLING";
export type PortalGrant = {
  allowed: boolean;
  client_id: string | null;
  expires_at: string | null;
  access_scope?: Scope | null;
  is_client_admin?: boolean;
};
export type PortalMe = {
  portal_user: PortalUser;
  grants: Record<"CLIENT" | "INVESTOR" | "AUDITOR", PortalGrant>;
  company: { client_id: string; name: string; legal_name: string | null; language: string | null } | null;
};
export const portalMe = () => portalApi<PortalMe>("/me");

// ── Client: home, shipments ─────────────────────────────────────────────────

export type Mode = "SEA" | "AIR" | "ROAD" | "RAIL" | "STORAGE" | "CUSTOMS" | "OTHER";
export type ShipmentCard = {
  dossier_id: string;
  ref: string;
  title: string | null;
  status: string;
  mode: Mode;
  service: string | null;
  origin: string | null;
  destination: string | null;
  arrival: string | null;
  arrived: boolean;
  transport_ref: string | null;
  conveyance: string | null;
  progress: { done: number; total: number; percent: number };
  current_step: string | null;
  current_status: string | null;
  next_due: string | null;
  last_update: string | null;
  created_at: string;
  open_requests: number;
};

export type RequestStatus = "OPEN" | "SUBMITTED" | "ACCEPTED" | "REJECTED" | "CANCELLED";
export type ClientRequest = {
  client_request_id: string;
  dossier_id: string | null;
  dossier_ref: string | null;
  source: "RULE" | "STAFF" | "CLIENT";
  kind: "DOCUMENT" | "INFO";
  doc_type_code: string | null;
  doc_type_en: string | null;
  doc_type_fr: string | null;
  title: string | null;
  note: string | null;
  due_on: string | null;
  status: RequestStatus;
  answer_text: string | null;
  answer_doc_id: string | null;
  answer_doc_name: string | null;
  answered_at: string | null;
  review_note: string | null;
  created_at: string;
};

export type InvoiceState = "DUE" | "OVERDUE" | "PART_PAID" | "PAID" | "IN_REVIEW" | "CANCELLED";
export type InvoiceSummary = {
  invoice_id: string;
  doc_number: string | null;
  issued_on: string | null;
  payment_due_on: string | null;
  days_to_due: number | null;
  currency: string;
  total: number;
  paid: number;
  in_review: number;
  outstanding: number;
  state: InvoiceState;
  dossier_id: string | null;
  dossier_ref: string | null;
};
export type CurrencyTotal = { currency: string; due: number; overdue: number; count: number };

export type PortalHome = {
  company: PortalMe["company"];
  scope: Scope;
  shipments: { active_count: number; items: ShipmentCard[] } | null;
  requests: { open_count: number; in_review_count: number; items: ClientRequest[] } | null;
  billing: {
    totals: CurrencyTotal[];
    due_count: number;
    overdue_count: number;
    in_review_count: number;
    next_due: InvoiceSummary | null;
  } | null;
};

const langQ = (lang: string) => `lang=${lang === "fr" ? "fr" : "en"}`;

export const portalHome = (lang: string) => portalApi<PortalHome>(`/client/home?${langQ(lang)}`);
export const portalShipments = (state: "active" | "done", lang: string) =>
  portalApi<ShipmentCard[]>(`/client/shipments?state=${state}&${langQ(lang)}`);

export type Milestone = {
  code: string;
  label: string;
  label_en?: string | null;
  planned_due?: string | null;
  forecast_due?: string | null;
  status: string;
  completed_at?: string | null;
  stage_seq?: number;
  milestone_instance_id: string | null;
};
export type Facet = { value: string; label?: string };
export type ShipmentDetail = {
  shipment: ShipmentCard;
  milestones: Milestone[];
  assumptions: { code: string; text_fr: string; text_en?: string | null }[];
  facts: {
    facets: Record<string, Facet>;
    facet_order: string[];
    route_label: string | null;
    containers: {
      summary: { lines: number; boxes: number; teu: number; identified: number };
      units: {
        type: string | null;
        container_no: string | null;
        seal_no: string | null;
        discharged_on: string | null;
        out_of_port_on: string | null;
        returned_on: string | null;
      }[];
    } | null;
  } | null;
  requests: ClientRequest[];
  documents: PortalDocument[];
  invoices: InvoiceSummary[];
};
export const portalShipment = (id: string, lang: string) =>
  portalApi<ShipmentDetail>(`/client/shipments/${encodeURIComponent(id)}?${langQ(lang)}`);

/** Q tickets — a question raised against one stage of one shipment. */
export const portalRaiseTicket = (body: {
  dossier_id: string;
  milestone_instance_id?: string;
  subject: string;
  body?: string;
}) => portalApi<{ q_ticket_id: string }>("/client/tickets", { method: "POST", body });

export type TicketStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED";
export type PortalTicket = {
  q_ticket_id: string;
  subject: string;
  body: string | null;
  status: TicketStatus;
  created_at: string;
  dossier_ref: string | null;
  milestone_label: string | null;
};
export type TicketReply = {
  q_ticket_reply_id?: string;
  body: string;
  is_from_client: boolean;
  author_label: string | null;
  created_at: string;
};
export const portalTickets = () => portalApi<PortalTicket[]>("/client/tickets");
export const portalTicket = (id: string) =>
  portalApi<{ ticket: PortalTicket & { dossier_id: string }; replies: TicketReply[] }>(`/client/tickets/${encodeURIComponent(id)}`);
export const portalReplyTicket = (id: string, body: string) =>
  portalApi<TicketReply>(`/client/tickets/${encodeURIComponent(id)}/replies`, { method: "POST", body: { body } });

// ── Client: documents and requests ──────────────────────────────────────────

/** A client-visible vault document. */
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
export const portalDocuments = () => portalApi<PortalDocument[]>("/client/documents");
export const portalDocumentDownload = (id: string, filename: string) =>
  portalDownload(`/client/documents/${encodeURIComponent(id)}/download`, filename);
export const portalRequests = () => portalApi<ClientRequest[]>("/client/requests");
export type DocType = { code: string; name_en: string | null; name_fr: string | null };
export const portalDocumentTypes = () => portalApi<DocType[]>("/client/document-types");

export function portalUploadForRequest(requestId: string, file: File, onProgress?: (pct: number) => void) {
  const form = new FormData();
  form.append("file", file, file.name);
  return portalUpload<ClientRequest>(`/client/requests/${encodeURIComponent(requestId)}/upload`, form, onProgress);
}
export const portalAnswerRequest = (requestId: string, text: string) =>
  portalApi<ClientRequest>(`/client/requests/${encodeURIComponent(requestId)}/answer`, { method: "POST", body: { text } });
export const portalRequestFile = (requestId: string, filename: string) =>
  portalDownload(`/client/requests/${encodeURIComponent(requestId)}/file`, filename);
export function portalShareDocument(
  input: { docTypeCode?: string | null; dossierId?: string | null; note?: string | null },
  file: File,
  onProgress?: (pct: number) => void,
) {
  const form = new FormData();
  if (input.docTypeCode) form.append("doc_type_code", input.docTypeCode);
  if (input.dossierId) form.append("dossier_id", input.dossierId);
  if (input.note) form.append("note", input.note);
  form.append("file", file, file.name);
  return portalUpload<ClientRequest>("/client/documents", form, onProgress);
}

// ── Client: billing ─────────────────────────────────────────────────────────

export type PayTo = {
  label: string | null;
  bank_name: string | null;
  branch: string | null;
  account_number: string | null;
  iban: string | null;
  swift_bic: string | null;
  currency: string | null;
  holder_name: string | null;
};
export type ProofStatus = "SUBMITTED" | "CONFIRMED" | "REJECTED";
export type PaymentProof = {
  payment_proof_id: string;
  amount: number;
  currency: string;
  method: "BANK" | "MOBILE_MONEY" | "CASH" | "CHEQUE";
  provider: string | null;
  paid_on: string;
  reference: string | null;
  note: string | null;
  dossier_id: string | null;
  dossier_ref: string | null;
  status: ProofStatus;
  review_note: string | null;
  reviewed_at: string | null;
  submitted_by_email: string | null;
  created_at: string;
  has_file: boolean;
  allocations: { invoice_id: string; doc_number: string | null; amount: number }[];
};
export type PortalBilling = {
  totals: CurrencyTotal[];
  invoices: InvoiceSummary[];
  proofs: PaymentProof[];
  how_to_pay: PayTo | null;
};
export const portalBilling = () => portalApi<PortalBilling>("/client/billing");

/** One issued invoice, its lines grouped by family as the printed copy groups them. */
export type PortalInvoiceDetail = {
  invoice: {
    invoice_id: string;
    doc_number: string | null;
    issued_on: string | null;
    payment_due_on: string | null;
    status: string;
    currency: string | null;
    service_ht: number;
    disbursement_total: number;
    vat_total: number;
    total_ttc: number;
  };
  lines: { label: string; amount: number; tax: number | null; is_disbursement: boolean }[];
  summary: InvoiceSummary | null;
  how_to_pay: PayTo | null;
};
export const portalInvoice = (invoiceId: string, lang: string) =>
  portalApi<PortalInvoiceDetail>(`/client/invoice/${encodeURIComponent(invoiceId)}?${langQ(lang)}`);
export const portalInvoicePdf = (invoiceId: string, filename: string, lang: string) =>
  portalDownload(`/client/invoice/${encodeURIComponent(invoiceId)}/pdf?${langQ(lang)}`, filename);

export function portalSubmitProof(
  input: {
    amount: number;
    currency: string;
    method: PaymentProof["method"];
    provider?: string | null;
    paid_on: string;
    reference?: string | null;
    note?: string | null;
    dossier_id?: string | null;
    allocations: { invoice_id: string; amount: number }[];
  },
  file: File,
  onProgress?: (pct: number) => void,
) {
  const form = new FormData();
  form.append("amount", String(input.amount));
  form.append("currency", input.currency);
  form.append("method", input.method);
  if (input.provider) form.append("provider", input.provider);
  form.append("paid_on", input.paid_on);
  if (input.reference) form.append("reference", input.reference);
  if (input.note) form.append("note", input.note);
  if (input.dossier_id) form.append("dossier_id", input.dossier_id);
  form.append("allocations", JSON.stringify(input.allocations));
  form.append("file", file, file.name);
  return portalUpload<PaymentProof>("/client/payment-proofs", form, onProgress);
}
export const portalProofFile = (id: string, filename: string) =>
  portalDownload(`/client/payment-proofs/${encodeURIComponent(id)}/file`, filename);

// ── Client: team ────────────────────────────────────────────────────────────

export type TeamMember = {
  portal_access_id: string;
  email: string;
  full_name: string | null;
  access_scope: Scope;
  is_client_admin: boolean;
  invited_by_email: string | null;
  created_at: string;
  last_login_at: string | null;
  pending: boolean;
  is_you: boolean;
};
export const portalTeam = () => portalApi<{ can_manage: boolean; members: TeamMember[] }>("/client/team");
export const portalInvite = (body: { email: string; full_name?: string; access_scope: Scope; is_client_admin?: boolean }) =>
  portalApi<{ emailed: boolean }>("/client/team", { method: "POST", body });
export const portalUpdateMember = (id: string, body: { access_scope?: Scope; is_client_admin?: boolean }) =>
  portalApi<TeamMember>(`/client/team/${encodeURIComponent(id)}`, { method: "POST", body });
export const portalRemoveMember = (id: string) =>
  portalApi<{ portal_access_id: string }>(`/client/team/${encodeURIComponent(id)}/remove`, { method: "POST", body: {} });

// ── Client: messages and quote requests (kept from the first portal) ────────

export type PortalMessage = {
  message_id: string;
  client_id: string;
  dossier_id: string | null;
  dossier_ref?: string | null;
  direction: "STAFF" | "CLIENT";
  body: string;
  author_user_id: string | null;
  author_email: string | null;
  author_name: string | null;
  created_at: string;
};
export const portalMessages = (dossierId?: string | null) =>
  portalApi<PortalMessage[]>(`/client/messages${dossierId ? `?dossier_id=${encodeURIComponent(dossierId)}` : ""}`);
export const portalSendMessage = (body: string, dossierId?: string | null) =>
  portalApi<PortalMessage>("/client/messages", {
    method: "POST",
    body: dossierId ? { body, dossier_id: dossierId } : { body },
  });
export const portalExportChat = () =>
  portalDownload("/client/messages/export", `conversation-${new Date().toISOString().slice(0, 10)}.pdf`);

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
export const portalQuoteRequests = () => portalApi<PortalQuoteRequest[]>("/client/quote-requests");
export const portalCreateQuote = (data: {
  service_category: string;
  service_type?: string;
  origin_location: string;
  destination_location: string;
  estimated_weight?: number;
  cargo_description?: string;
  incoterm?: string;
}) => portalApi<PortalQuoteRequest>("/client/quote-requests", { method: "POST", body: data });

// ── Investor and auditor terminals ──────────────────────────────────────────

type IncomeStatement = { charges: number; produits: number; hao_net: number; result: number };
type BalanceSheet = { active: number; passif: number; result: number; balanced: boolean };

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
  cash_position: { accounts: { account_code: string; balance: number }[]; total_cash: number };
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
export type TrialBalanceRow = { account_code: string; debit: string | number; credit: string | number };
export type AuditorView = {
  portal: "AUDITOR";
  basis: "OHADA";
  period: { from: string; to: string };
  scope: { entity_id: string | null };
  disclosure: string;
  income_statement: IncomeStatement;
  balance_sheet: BalanceSheet;
  cash_flow: Record<string, unknown>;
  trial_balance: { rows: TrialBalanceRow[]; totals: { debit: number; credit: number; balanced?: boolean } };
  procurement_spend: unknown;
  audit_trail: AuditTrailEntry[];
};
const periodQs = (q?: { from?: string; to?: string }) =>
  new URLSearchParams(Object.entries(q || {}).filter(([, v]) => !!v) as [string, string][]).toString();
export const portalInvestorView = (q?: { from?: string; to?: string }) => {
  const s = periodQs(q);
  return portalApi<InvestorView>(`/investor${s ? `?${s}` : ""}`);
};
export const portalAuditorView = (q?: { from?: string; to?: string }) => {
  const s = periodQs(q);
  return portalApi<AuditorView>(`/auditor${s ? `?${s}` : ""}`);
};

// ── Auditor data room (PRD §5.2) ────────────────────────────────────────────

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
export type PortalDataRoomDetail = { room: PortalDataRoom; docs: PortalDataRoomDoc[] };
export const portalDataRoomList = () => portalApi<PortalDataRoom[]>("/auditor/data-room");
export const portalDataRoomCreate = (note: string) =>
  portalApi<PortalDataRoom>("/auditor/data-room", { method: "POST", body: { note } });
export const portalDataRoomDetail = (id: string) =>
  portalApi<PortalDataRoomDetail>(`/auditor/data-room/${encodeURIComponent(id)}`);
export const portalDataRoomDownload = (roomId: string, docId: string, filename: string) =>
  portalDownload(
    `/auditor/data-room/${encodeURIComponent(roomId)}/documents/${encodeURIComponent(docId)}/download`,
    filename,
  );
