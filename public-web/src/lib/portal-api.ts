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

/**
 * Bytes with the session, as a Blob — a photo or a voice note shown in place,
 * which an `<img src>` cannot fetch because the session is a header, not a
 * cookie.
 */
export async function portalBlob(path: string): Promise<Blob> {
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
    // The server's own code when it sent one ("too large to download
    // together" is a different sentence from "it did not work").
    const code = res ? (await errorFrom(res)).code : "OFFLINE";
    throw new PortalError(code === "ERROR" ? "DOWNLOAD_FAILED" : code, message, res ? res.status : 0);
  }
  return res.blob();
}

/** Bytes to a Save-As, with the session. A pop-up-free anchor click. */
export async function portalDownload(path: string, filename: string): Promise<void> {
  const url = URL.createObjectURL(await portalBlob(path));
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
  /** Supporting documents finance shared with this invoice — the paperclip count. */
  documents_count?: number;
};
export type CurrencyTotal = { currency: string; due: number; overdue: number; count: number };

export type PortalHome = {
  company: PortalMe["company"];
  scope: Scope;
  /** What the team wrote since I last looked (14170) — the chat button's badge. */
  chat?: { unread: number } | null;
  /** Proposals waiting for this client's answer. */
  proposals?: { pending_count: number } | null;
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
  /** The supporting documents finance shared with it (14160), in the file's order. */
  documents?: InvoiceDocuments | null;
};
export type InvoiceDocuments = {
  published_at: string;
  items: { doc_id: string; position: number; label: string | null; name: string; ext: string }[];
};
export const portalInvoice = (invoiceId: string, lang: string) =>
  portalApi<PortalInvoiceDetail>(`/client/invoice/${encodeURIComponent(invoiceId)}?${langQ(lang)}`);
export const portalInvoicePdf = (invoiceId: string, filename: string, lang: string) =>
  portalDownload(`/client/invoice/${encodeURIComponent(invoiceId)}/pdf?${langQ(lang)}`, filename);
/** The invoice and every shared document, numbered, as one ZIP. */
export const portalInvoiceDocumentsZip = (invoiceId: string, filename: string, lang: string) =>
  portalDownload(`/client/invoice/${encodeURIComponent(invoiceId)}/documents/zip?${langQ(lang)}`, filename);
export const portalInvoiceDocument = (invoiceId: string, docId: string, filename: string) =>
  portalDownload(`/client/invoice/${encodeURIComponent(invoiceId)}/documents/${encodeURIComponent(docId)}`, filename);

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
export const portalTeam = () =>
  portalApi<{ can_manage: boolean; default_scope?: TeamMember["access_scope"]; members: TeamMember[] }>("/client/team");
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
// ── Client: the chat (14170) — General and one thread per shipment ─────────

export type ChatKind = "TEXT" | "IMAGE" | "FILE" | "VOICE" | "LOCATION";
export type ChatThread = {
  /** "general", or the shipment's id. */
  thread: string;
  dossier_id: string | null;
  dossier_ref: string | null;
  dossier_status: string | null;
  unread: number;
  last: { direction: "STAFF" | "CLIENT"; mine: boolean; preview: string | null; kind: ChatKind; at: string } | null;
};
export type ChatAttachment = {
  attachment_id: string;
  kind: "IMAGE" | "FILE" | "VOICE";
  name: string | null;
  mime_type: string | null;
  size: number | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
};
export type ChatMessage = {
  message_id: string;
  dossier_id: string | null;
  dossier_ref: string | null;
  direction: "STAFF" | "CLIENT";
  body: string;
  created_at: string;
  author: { name: string | null; email: string | null };
  mine: boolean;
  /** On my own messages: the team has read it. */
  seen: boolean | null;
  milestone: { milestone_instance_id: string; label: string | null } | null;
  location: { lat: number; lng: number; label: string | null } | null;
  attachments: ChatAttachment[];
};
export type ChatPage = { thread: string; dossier_ref: string | null; has_more: boolean; messages: ChatMessage[] };
export type ChatSend = {
  thread: string;
  body?: string;
  milestone_instance_id?: string | null;
  location?: { lat: number; lng: number; label?: string | null } | null;
  width?: number | null;
  height?: number | null;
  duration_ms?: number | null;
};

export const portalChatThreads = () => portalApi<ChatThread[]>("/client/chat/threads");
export const portalChatUnread = () => portalApi<{ unread: number }>("/client/chat/unread");
export const portalChatMessages = (thread: string, lang: string, before?: string | null) =>
  portalApi<ChatPage>(
    `/client/chat/messages?thread=${encodeURIComponent(thread)}&${langQ(lang)}${before ? `&before=${encodeURIComponent(before)}` : ""}`,
  );
/** One message — words, a pin, a file, or a mix. Multipart, so a photo reports its percentage. */
export function portalChatSend(input: ChatSend, lang: string, file?: File | null, onProgress?: (pct: number) => void) {
  const form = new FormData();
  form.append("thread", input.thread);
  if (input.body) form.append("body", input.body);
  if (input.milestone_instance_id) form.append("milestone_instance_id", input.milestone_instance_id);
  if (input.location) {
    form.append("lat", String(input.location.lat));
    form.append("lng", String(input.location.lng));
    if (input.location.label) form.append("location_label", input.location.label);
  }
  if (input.width) form.append("width", String(Math.round(input.width)));
  if (input.height) form.append("height", String(Math.round(input.height)));
  if (input.duration_ms) form.append("duration_ms", String(Math.round(input.duration_ms)));
  if (file) form.append("file", file, file.name);
  return portalUpload<ChatMessage>(`/client/chat/messages?${langQ(lang)}`, form, onProgress);
}
export const portalChatRead = (thread: string, at?: string | null) =>
  portalApi<{ thread: string }>("/client/chat/read", { method: "POST", body: at ? { thread, at } : { thread } });
export const portalChatAttachment = (id: string, preview = false) =>
  portalBlob(`/client/chat/attachments/${encodeURIComponent(id)}${preview ? "?size=preview" : ""}`);
export const portalChatAttachmentDownload = (id: string, filename: string) =>
  portalDownload(`/client/chat/attachments/${encodeURIComponent(id)}`, filename);

export const portalExportChat = () =>
  portalDownload("/client/messages/export", `conversation-${new Date().toISOString().slice(0, 10)}.pdf`);

// ── Client: places for the quote sheet's route ─────────────────────────────

/** geo_place.kind — the vocabulary the server's catalogue speaks. */
export type PlaceKind =
  | "SEAPORT"
  | "AIRPORT"
  | "TERMINAL"
  | "RAIL_TERMINAL"
  | "BORDER_POST"
  | "WAREHOUSE"
  | "INLAND"
  | "CITY"
  | "ADDRESS"
  | "OTHER";

/** A place the desk vouched for, or one of the client's own. */
export type PortalPlace = {
  geo_place_id: string;
  name: string;
  country: string | null;
  region: string | null;
  kind: PlaceKind | string | null;
  /** UN/LOCODE where the place has one — CMDLA, CNSHA. */
  unlocode: string | null;
  /** The address line, or for an airport its IATA line ("DLA · Douala…"). */
  formatted: string | null;
  latitude: number;
  longitude: number;
};

/**
 * A worldwide suggestion. NOT a place yet: nothing is stored until the quote
 * is sent, and then the server re-asks the provider and keeps ITS coordinate —
 * so what travels back is the id and the text that found it, never the pin.
 */
export type PortalPlaceSuggestion = {
  provider_place_id: string;
  name: string | null;
  formatted: string | null;
  country: string | null;
  latitude: number;
  longitude: number;
  kind: string | null;
};

export type PortalPlaceSearch = {
  /** Shared infrastructure matching what they typed: ports, airports, cities. */
  places: PortalPlace[];
  /** Places already on the client's own requests and files, newest first. */
  recent: PortalPlace[];
  /** With nothing typed: where this tenant's shipments most often go. */
  popular: PortalPlace[];
  has_exact: boolean;
  provider: {
    requested: boolean;
    /** UNAVAILABLE covers every provider failure; the sheet keeps taking text. */
    status: "NOT_REQUESTED" | "OK" | "TOO_SHORT" | "UNAVAILABLE";
    results: PortalPlaceSuggestion[];
  };
};

export const portalPlaces = (params: { q?: string; kinds?: PlaceKind[]; provider?: boolean; signal?: AbortSignal }) => {
  const qs = new URLSearchParams();
  if (params.q && params.q.trim()) qs.set("q", params.q.trim());
  (params.kinds || []).forEach((k) => qs.append("kind", k));
  if (params.provider) qs.set("provider", "true");
  const query = qs.toString();
  return portalApi<PortalPlaceSearch>(`/client/places${query ? `?${query}` : ""}`, { signal: params.signal });
};

/** What travels back for one end of the route: a place's id, or a suggestion's. */
export type PortalPlacePick = { geo_place_id: string } | { provider_place_id: string; query: string; country?: string };

// ── Client: quote requests ─────────────────────────────────────────────────

export type PortalQuoteRequest = {
  quote_request_id: string;
  public_ref: string | null;
  status: string;
  service_category: string | null;
  service_type: string | null;
  origin_location: string | null;
  destination_location: string | null;
  /** The doors either side of the main leg — null on a port-to-port request. */
  collection_location: string | null;
  delivery_location: string | null;
  /** The place behind each end, when the client picked one. */
  origin_place: PortalPlace | null;
  destination_place: PortalPlace | null;
  collection_place: PortalPlace | null;
  delivery_place: PortalPlace | null;
  incoterm: string | null;
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
  collection_location?: string;
  delivery_location?: string;
  origin_place?: PortalPlacePick;
  destination_place?: PortalPlacePick;
  collection_place?: PortalPlacePick;
  delivery_place?: PortalPlacePick;
  estimated_weight?: number;
  cargo_description?: string;
  incoterm?: string;
}) => portalApi<PortalQuoteRequest>("/client/quote-requests", { method: "POST", body: data });

/** "Describe it in your own words" — the wizard's fields, read from a description. */
export type QuoteFill = {
  fields: {
    mode: Mode | null;
    direction: "IMPORT" | "EXPORT" | "LOCAL" | null;
    origin: string | null;
    destination: string | null;
    incoterm: string | null;
    cargo: string | null;
    weight_kg: number | null;
    containers: string | null;
  };
  source: "ai" | "rules";
};
export const portalQuoteFill = (text: string) =>
  portalApi<QuoteFill>("/client/quote-requests/fill", { method: "POST", body: { text } });

// ── Client: proposals — read, download, decline, accept by e-signature ──────

export type ProposalStatus = "SENT" | "ACCEPTED" | "REJECTED";
export type ProposalSummary = {
  proposal_id: string;
  doc_number: string | null;
  title: string;
  status: ProposalStatus;
  currency: string;
  total: number;
  route: string | null;
  sent_on: string;
  valid_until: string | null;
};
export type ProposalSignature = {
  signer_name: string;
  signer_role: string | null;
  signed_at: string;
  mark: "STAMP" | "DRAWN" | string;
  assurance: string;
  verify_code: string | null;
};
export type SignCard = { preset_code: "STAMP" | "DRAWN"; label: string; blurb: string | null };
export type ProposalDetail = {
  proposal: Omit<ProposalSummary, "route" | "sent_on">;
  /** The same model the vaulted PDF is rendered from — never re-formatted here. */
  presentation: {
    language: "EN" | "FR";
    title: string;
    document_number: string;
    client_name: string;
    route: string;
    labels: { service: string; quantity: string; unit: string; total: string };
    sections: { key: string; title: string; body: string }[];
    lines: { label: string; quantity: number; unit_price_display: string; total_display: string }[];
  };
  signature: ProposalSignature | null;
  signing: { available: boolean; cards: SignCard[] };
  decline_reasons: { reason_code: string; label: string }[];
};
export type SigningStart = {
  signer: { full_name: string; email_masked: string };
  cards: SignCard[];
  otp: SigningCode | null;
};
/** The emailed code, as the signing programme describes it (never the code itself). */
export type SigningCode = {
  sent_to: string;
  expires_at: string;
  attempts_remaining: number;
  resends_remaining: number;
  cooldown_until: string | null;
  verified_at: string | null;
};

const pid = (id: string) => encodeURIComponent(id);
export const portalProposals = () => portalApi<ProposalSummary[]>("/client/proposals");
export const portalProposal = (id: string, lang: string) => portalApi<ProposalDetail>(`/client/proposals/${pid(id)}?${langQ(lang)}`);
export const portalProposalPdf = (id: string, filename: string, lang: string) =>
  portalDownload(`/client/proposals/${pid(id)}/pdf?${langQ(lang)}`, filename);
export const portalProposalDecline = (id: string, reasonCode: string, note?: string) =>
  portalApi<{ declined: boolean }>(`/client/proposals/${pid(id)}/decline`, {
    method: "POST",
    body: note ? { reason_code: reasonCode, note } : { reason_code: reasonCode },
  });
/** Only where the tenant offers no e-signature — elsewhere accepting IS signing. */
export const portalProposalAccept = (id: string) =>
  portalApi<{ accepted: boolean; signature: ProposalSignature | null }>(`/client/proposals/${pid(id)}/accept`, { method: "POST", body: {} });
export const portalProposalSignStart = (id: string, lang: string) =>
  portalApi<SigningStart>(`/client/proposals/${pid(id)}/sign?${langQ(lang)}`, { method: "POST", body: {} });
export const portalProposalSignResend = (id: string, lang: string) =>
  portalApi<{ otp: SigningStart["otp"] }>(`/client/proposals/${pid(id)}/sign/resend?${langQ(lang)}`, { method: "POST", body: {} });
export const portalProposalSignComplete = (
  id: string,
  lang: string,
  body: { code: string; preset_code: "STAMP" | "DRAWN"; full_name?: string; party_role?: string; mark_image_b64?: string },
) =>
  portalApi<{ accepted: boolean; signature: ProposalSignature | null }>(`/client/proposals/${pid(id)}/sign/complete?${langQ(lang)}`, {
    method: "POST",
    body,
  });

// ── Client: notifications — email and this device (14180) ───────────────────

export type NotifyTopic = "MESSAGES" | "REQUESTS" | "BILLING" | "PROPOSALS" | "SHIPMENTS";
export type NotifyChoice = { topic: NotifyTopic; email: boolean; push: boolean };
export type NotifySettings = {
  language: "en" | "fr" | null;
  /** Only the topics this person's access shows them, in a fixed order. */
  topics: NotifyChoice[];
  push: { configured: boolean; public_key: string | null; devices: number };
};
/** The browser's own PushSubscription, as `toJSON()` gives it. */
export type PushSubscriptionBody = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  expirationTime?: number | null;
};

export const portalNotifySettings = () => portalApi<NotifySettings>("/client/notifications");
export const portalNotifySave = (topics: NotifyChoice[], language?: "en" | "fr") =>
  portalApi<Omit<NotifySettings, "push">>("/client/notifications", {
    method: "POST",
    body: language ? { topics, language } : { topics },
  });
export const portalPushSubscribe = (subscription: PushSubscriptionBody, language?: "en" | "fr") =>
  portalApi<{ subscribed: boolean; devices: number }>("/client/push/subscribe", {
    method: "POST",
    body: language ? { subscription, language } : { subscription },
  });
export const portalPushUnsubscribe = (endpoint: string) =>
  portalApi<{ unsubscribed: boolean; devices: number }>("/client/push/unsubscribe", { method: "POST", body: { endpoint } });
export const portalPushTest = (lang: string) =>
  portalApi<{ sent: number; failed: number; devices: number; reason: string | null }>(`/client/push/test?${langQ(lang)}`, {
    method: "POST",
    body: {},
  });

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
