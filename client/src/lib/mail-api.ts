/**
 * Mail API (read-only) — per-purpose sender identities (Billing/Documents/
 * Notifications/Support) and the outbound send log. Each section sends from its
 * own verified identity; this surfaces what went out and its delivery state.
 */
import { tenant } from "./api-client";
// The workflow/security half of the mail API. Imported for the types the core
// thread and message shapes reference; re-exported wholesale at the foot.
import type { AuthVerdict, Visibility, WorkStatus } from "./mail-api-work";

export type Sender = {
  email_identity_id: string;
  purpose: string;
  from_address: string;
  from_name: string;
  reply_to?: string | null;
  smtp_host?: string | null;
  smtp_port?: number | null;
  is_active: boolean;
  sections?: string[];
};
export type SentMail = {
  email_send_id: string;
  email_identity_id?: string | null;
  to_address: string;
  subject?: string | null;
  entity_ref?: string | null;
  status: string;
  provider_message_id?: string | null;
  error?: string | null;
  queued_at?: string | null;
  sent_at?: string | null;
  purpose?: string | null;
  from_address?: string | null;
  from_name?: string | null;
};

export const listSenders = () => tenant<Sender[]>("/mail/senders");
export const listSent = (identityId?: string) =>
  tenant<SentMail[]>(
    `/mail/sent${identityId ? `?identity_id=${identityId}` : ""}`,
  );

export type InboundMail = {
  email_inbound_id: string;
  email_identity_id?: string | null;
  from_address: string;
  to_address?: string | null;
  subject?: string | null;
  body_preview?: string | null;
  entity_ref?: string | null;
  is_read?: boolean;
  received_at?: string | null;
  purpose?: string | null;
};
export const listInbox = (identityId?: string) =>
  tenant<InboundMail[]>(
    `/mail/inbox${identityId ? `?identity_id=${identityId}` : ""}`,
  );

/* identity SMTP/from update, and messaging secrets via the settings store */
export const updateSender = (
  id: string,
  patch: Partial<
    Pick<
      Sender,
      "from_name" | "reply_to" | "smtp_host" | "smtp_port" | "is_active"
    >
  >,
) => tenant<Sender>(`/mail/senders/${id}`, { method: "PATCH", body: patch });
export const putSetting = (section: string, key: string, value: unknown) =>
  tenant<{ ok?: boolean }>(`/settings/${section}/${key}`, {
    method: "PUT",
    body: { value },
  });

export const upsertSender = (body: {
  purpose: string;
  from_address?: string;
  from_name?: string;
  reply_to?: string;
  smtp_host?: string;
  smtp_port?: number;
  is_active?: boolean;
  sections?: string[];
}) => tenant<Sender>("/mail/senders", { method: "POST", body });

export const archiveSender = (id: string) =>
  tenant<{ email_identity_id: string }>(`/mail/senders/${id}/archive`, {
    method: "POST",
  });

/* ─────────────────────────────────────────────────────────────────────────
 * Provider-agnostic email engine (Phase 1–3): connections, threads, send/reply.
 * See doc/EMAIL_ENGINE_PLAN.md.
 * ──────────────────────────────────────────────────────────────────────── */

export type Provider = "imap_smtp" | "microsoft_graph" | "google_gmail";

/**
 * How the SENDING leg signs in.
 *
 * `"same"` — one username and password for receiving and sending, which is every
 * mailbox on a single host and the default. `"separate"` — the outgoing server
 * has its own sign-in, which is what a relay (SMTP2GO, SES, SendGrid) in front
 * of a cPanel mailbox needs.
 *
 * DERIVED SERVER-SIDE from whether a separate secret exists, never stored as a
 * mode of its own, so the form can reopen in the right state without the
 * password ever leaving the server. `has_smtp_credentials` is the same fact as a
 * boolean — the presence-only treatment the mailbox password already gets.
 */
export type SmtpAuthMode = "same" | "separate";

export type Connection = {
  email_connection_id: string;
  email_address: string;
  provider: Provider;
  display_name?: string | null;
  status: "PENDING" | "CONNECTED" | "ERROR" | "DISABLED";
  last_sync_at?: string | null;
  last_error?: string | null;
  imap_host?: string | null;
  imap_port?: number | null;
  smtp_host?: string | null;
  smtp_port?: number | null;
  auth_user?: string | null;
  smtp_user?: string | null;
  smtp_auth?: SmtpAuthMode;
  has_smtp_credentials?: boolean;
  owner_user_id?: string | null;
  is_default?: boolean;
  created_at?: string | null;
};

export const setDefaultMailbox = (id: string) =>
  tenant<{ email_connection_id: string; is_default: boolean }[]>(
    `/mail/connections/${id}/default`,
    { method: "POST" },
  );

export type Recipient = {
  type: "client" | "supplier" | "employee" | "lead";
  id: string;
  name: string;
  email: string;
};
export const searchRecipients = (q: string) =>
  tenant<Recipient[]>(`/mail/recipients?q=${encodeURIComponent(q)}`);

export type ThreadMsg = {
  email_inbound_id: string;
  email_connection_id?: string | null;
  thread_key?: string | null;
  direction: "IN" | "OUT";
  from_address: string;
  to_address?: string | null;
  subject?: string | null;
  body_preview?: string | null;
  body_html?: string | null;
  body_text?: string | null;
  entity_ref?: string | null;
  is_read?: boolean;
  received_at?: string | null;
};

export type Attachment = {
  email_attachment_id: string;
  vault_id?: string | null;
  filename?: string | null;
  content_type?: string | null;
  size_bytes?: number | null;
};

export type TestResult = {
  ok: boolean;
  error?: string;
  /** Which leg refused — "imap" (receiving) or "smtp" (sending). */
  stage?: string;
  code?: string;
  /** Which sending credential was offered, so a client can mark the right field. */
  smtp_auth?: SmtpAuthMode;
};

export type Autoconfig = {
  source: string;
  provider?: string;
  imap_host?: string;
  imap_port?: number;
  imap_secure?: boolean;
  smtp_host?: string;
  smtp_port?: number;
  smtp_secure?: boolean;
  oauth_hint?: "microsoft_graph" | "google_gmail";
};
export const autodiscover = (email: string) =>
  tenant<Autoconfig>(`/mail/autodiscover?email=${encodeURIComponent(email)}`);

// Connections
export const listConnections = () => tenant<Connection[]>("/mail/connections");
export const connectImap = (body: {
  email_address: string;
  display_name?: string;
  imap_host: string;
  imap_port?: number;
  imap_secure?: boolean;
  smtp_host: string;
  smtp_port?: number;
  smtp_secure?: boolean;
  auth_user?: string;
  password: string;
  /** Omit for "same as IMAP"; "separate" requires both fields below. */
  smtp_auth?: SmtpAuthMode;
  smtp_user?: string | null;
  smtp_password?: string;
}) =>
  tenant<Connection & { test?: TestResult }>("/mail/connections", {
    method: "POST",
    body,
  });
export const testConnection = (id: string) =>
  tenant<TestResult>(`/mail/connections/${id}/test`, { method: "POST" });
export const syncConnection = (id: string) =>
  tenant<{ fetched?: number; inserted?: number; error?: string }>(
    `/mail/connections/${id}/sync`,
    { method: "POST" },
  );

/**
 * Stop the sync and forget the credential.
 *
 * A POST, not a DELETE, because nothing is deleted: the mailbox is archived and
 * the stored password or token bundle is removed, and every message stays
 * exactly where it was. `archiveMailbox` below is the weaker half of this — it
 * stops the sync and leaves the credential on disk — and stays for the admin
 * "Retire" action, which is about the mailbox's place in the company rather
 * than about a password.
 */
export const disconnectMailbox = (id: string) =>
  tenant<Connection & { disconnected: boolean }>(
    `/mail/connections/${id}/disconnect`,
    { method: "POST" },
  );

// OAuth — start returns the provider consent URL to redirect the browser to.
export const microsoftStartUrl = () => "/api/tenant/mail/oauth/microsoft/start";
export const googleStartUrl = () => "/api/tenant/mail/oauth/google/start";
export const startMicrosoft = () =>
  tenant<{ url: string }>("/mail/oauth/microsoft/start");
export const startGoogle = () =>
  tenant<{ url: string }>("/mail/oauth/google/start");

// Messages
export const listMsgAttachments = (id: string) =>
  tenant<Attachment[]>(`/mail/thread/${id}/attachments`);

/**
 * Open an inbound attachment (audit H-2).
 *
 * §5.4's download endpoint did not exist — no route, no handler, no client
 * call — so the reading pane could say a message HAD an attachment and offered
 * no way to open it. The server side is visibility-scoped: an attachment on a
 * conversation the caller cannot see answers 404, identical to one that does
 * not exist.
 *
 * `tenantDownload` rather than `tenant`, because the response is bytes and not
 * an envelope; it carries the session the same way and saves under the
 * filename the sender used.
 */
export async function downloadAttachment(attachmentId: string, filename?: string | null) {
  const { tenantDownload } = await import("./api-client");
  await tenantDownload(
    `/mail/attachments/${attachmentId}/download`,
    filename || "attachment",
  );
}
export const linkThread = (id: string, entity_ref: string) =>
  tenant<{ entity_ref: string }>(`/mail/thread/${id}/link`, {
    method: "POST",
    body: { entity_ref },
  });
export const clientTimeline = (clientId: string) =>
  tenant<ThreadMsg[]>(`/mail/client/${clientId}/timeline`);

export const updateImapConnection = (
  id: string,
  body: {
    email_address?: string;
    display_name?: string;
    imap_host?: string;
    imap_port?: number;
    imap_secure?: boolean;
    smtp_host?: string;
    smtp_port?: number;
    smtp_secure?: boolean;
    auth_user?: string;
    password?: string;
    /**
     * Absent leaves the mailbox's current sending sign-in ALONE — which is what
     * a patch that only moves the SMTP host must do. `"same"` deletes the stored
     * SMTP secret; `"separate"` with a blank `smtp_password` keeps it, the same
     * convention `password` above has.
     */
    smtp_auth?: SmtpAuthMode;
    smtp_user?: string | null;
    smtp_password?: string;
  },
) =>
  tenant<Connection & { test?: TestResult }>(`/mail/connections/${id}`, {
    method: "PATCH",
    body,
  });

/* ── PR-0 foundation: mailboxes as organisational objects ──────────────────
 *
 * The types above describe mail as TRANSPORT — who sent what, and whether it
 * arrived. Everything below describes mail as ORGANISATION: whose mailbox this
 * is, which team address it fulfils, who may work it, and which part of the
 * product sends from it. Two different questions, kept visibly apart, because
 * conflating them is how "connection" came to mean four things.
 */

export type MailboxKind = "PERSONAL" | "SHARED" | "DELEGATED";
export type MemberRole = "VIEWER" | "AGENT" | "MANAGER";
export type HealthLevel = "OK" | "WARN" | "DOWN" | "PENDING" | "OFF" | "ARCHIVED";

export type MailboxHealth = {
  level: HealthLevel;
  reason: string;
  failures?: number;
  stale_hours?: number;
};

export type MailCapabilities = {
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_administer: boolean;
  is_ceo: boolean;
};

export type Mailbox = {
  email_connection_id: string;
  email_address: string;
  display_name?: string | null;
  provider: Provider;
  kind: MailboxKind;
  visibility?: string | null;
  status: string;
  catalogue_key?: string | null;
  catalogue_label?: string | null;
  department?: string | null;
  entity_id?: string | null;
  owner_user_id?: string | null;
  owner_name?: string | null;
  is_default?: boolean;
  member_count?: number;
  last_sync_at?: string | null;
  last_success_at?: string | null;
  last_error?: string | null;
  consecutive_failures?: number;
  archived_at?: string | null;
  send_limit_hourly?: number | null;
  send_limit_daily?: number | null;
  sync_depth_days?: number | null;
  history_imported_at?: string | null;
  access_role?: MemberRole | "OWNER" | null;
  health: MailboxHealth;
  effective_limits?: {
    send_limit_hourly: number;
    send_limit_daily: number;
    sync_depth_days: number;
  };
};

export type CatalogueEntry = {
  catalogue_key: string;
  label_en: string;
  label_fr: string;
  description_en?: string | null;
  description_fr?: string | null;
  suggested_local_part: string;
  department?: string | null;
  feeds: string[];
  sort_order: number;
  is_system: boolean;
  is_enabled: boolean;
  /** True once a live mailbox fulfils this slot. */
  configured: boolean;
  email_connection_id?: string | null;
  email_address?: string | null;
  connection_status?: string | null;
};

export type MailboxMember = {
  email_connection_member_id: string;
  user_id: string;
  member_role: MemberRole;
  full_name?: string | null;
  email?: string | null;
  job_title?: string | null;
  department?: string | null;
  granted_at?: string | null;
  revoked_at?: string | null;
};

export type SendPointBinding = {
  mail_send_point_binding_id: string;
  entity_id?: string | null;
  entity_name?: string | null;
  email_identity_id?: string | null;
  identity_from?: string | null;
  identity_name?: string | null;
  email_connection_id?: string | null;
  connection_address?: string | null;
  connection_status?: string | null;
};

export type SendPoint = {
  send_point_key: string;
  module_key?: string | null;
  group_key: string;
  label_en: string;
  label_fr: string;
  description_en?: string | null;
  description_fr?: string | null;
  legacy_purpose?: string | null;
  default_catalogue_key?: string | null;
  /** False means nothing in the product sends through this yet — say so. */
  is_wired: boolean;
  sort_order: number;
  bindings: SendPointBinding[];
  resolved: {
    source:
      | "ENTITY_BINDING"
      | "TENANT_BINDING"
      | "LEGACY_SECTION"
      | "LEGACY_PURPOSE"
      | "FALLBACK";
    /** A sentence the screen shows verbatim. */
    why: string;
    from_address?: string | null;
    from_name?: string | null;
  };
};

export type SendAllowance = {
  allowed: boolean;
  reason?: string | null;
  limit?: number;
  used?: number | { hourly: number; daily: number };
  retryAt?: string | null;
  remaining_hour?: number;
  remaining_day?: number;
  limits?: { send_limit_hourly: number; send_limit_daily: number; sync_depth_days: number };
};

export type AccessAuditRow = {
  email_access_audit_id: string;
  email_connection_id?: string | null;
  action: string;
  subject_user_id?: string | null;
  subject_name?: string | null;
  actor_user_id?: string | null;
  actor_name?: string | null;
  detail?: Record<string, unknown>;
  created_at: string;
};

export type CpanelPreset = {
  email: string;
  domain: string;
  source: string;
  imap_host: string;
  imap_port: number;
  imap_secure: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  auth_user: string;
  note: string;
};

/* Capabilities + inventory */
export const mailCapabilities = () => tenant<MailCapabilities>("/mail/me");
export const myMailboxes = () => tenant<Mailbox[]>("/mail/mailboxes/mine");

/**
 * The mailbox a screen should open on when the person has not chosen one.
 *
 * The inbox is mailbox-scoped — folders, folder counts and the two stream
 * totals all belong to one connection — so "nothing selected" is not a neutral
 * state, it is an empty rail. The rail must therefore always be pointed at a
 * mailbox, and this is the one to point it at:
 *
 *   1. the mailbox the person marked as their default,
 *   2. their PERSONAL address — the one that is theirs rather than a shared
 *      mailbox they hold a grant on,
 *   3. one that is actually connected, over one that is broken or still
 *      pending,
 *   4. the first the server returned, which already orders personal first.
 *
 * The same order as `defaultConnectionFor` on the server, so the mailbox the
 * client opens on and the mailbox an unqualified API call answers for are the
 * same mailbox.
 */
export function primaryMailbox(mailboxes: Mailbox[]): Mailbox | null {
  if (!mailboxes.length) return null;
  return (
    mailboxes.find((m) => m.is_default) ??
    mailboxes.find((m) => m.kind === "PERSONAL") ??
    mailboxes.find((m) => m.status === "CONNECTED") ??
    mailboxes[0]
  );
}
export const allMailboxes = (q: { kind?: MailboxKind; include_archived?: boolean } = {}) => {
  const p = new URLSearchParams();
  if (q.kind) p.set("kind", q.kind);
  if (q.include_archived) p.set("include_archived", "true");
  const qs = p.toString();
  return tenant<Mailbox[]>(`/mail/mailboxes${qs ? `?${qs}` : ""}`);
};

/* Catalogue */
export const listCatalogue = (includeDisabled = false) =>
  tenant<CatalogueEntry[]>(`/mail/catalogue${includeDisabled ? "?include_disabled=true" : ""}`);
export const addCatalogueEntry = (body: Record<string, unknown>) =>
  tenant<CatalogueEntry>("/mail/catalogue", { method: "POST", body: body });
export const toggleCatalogueEntry = (key: string, isEnabled: boolean) =>
  tenant<CatalogueEntry>(`/mail/catalogue/${encodeURIComponent(key)}`, {
    method: "PATCH",
    body: { is_enabled: isEnabled },
  });

/* Mailbox lifecycle */
export const createSharedMailbox = (body: Record<string, unknown>) =>
  tenant<Mailbox>("/mail/mailboxes/shared", { method: "POST", body: body });
export const archiveMailbox = (id: string) =>
  tenant<Mailbox>(`/mail/mailboxes/${id}/archive`, { method: "POST" });
export const handoverMailbox = (id: string, body: { catalogue_key?: string | null; department?: string | null }) =>
  tenant<Mailbox>(`/mail/mailboxes/${id}/handover`, { method: "POST", body: body });
export const setMailboxLimits = (
  id: string,
  body: { send_limit_hourly?: number | null; send_limit_daily?: number | null; sync_depth_days?: number | null },
) => tenant<Mailbox>(`/mail/mailboxes/${id}/limits`, { method: "PATCH", body: body });
export const sendAllowance = (id: string, count = 1) =>
  tenant<SendAllowance>(`/mail/mailboxes/${id}/allowance?count=${count}`);

/* Access grants */
export const listMembers = (id: string, includeRevoked = false) =>
  tenant<MailboxMember[]>(`/mail/mailboxes/${id}/members${includeRevoked ? "?include_revoked=true" : ""}`);
export const grantMember = (id: string, userId: string, role: MemberRole) =>
  tenant<MailboxMember>(`/mail/mailboxes/${id}/members`, {
    method: "POST",
    body: { user_id: userId, member_role: role },
  });
export const revokeMember = (id: string, userId: string) =>
  tenant<{ revoked: boolean }>(`/mail/mailboxes/${id}/members/${userId}`, { method: "DELETE" });
export const accessLog = (connectionId?: string) =>
  tenant<AccessAuditRow[]>(`/mail/access-log${connectionId ? `?connection_id=${connectionId}` : ""}`);

/* Send-point routing */
export const listSendPoints = (entityId?: string) =>
  tenant<SendPoint[]>(`/mail/send-points${entityId ? `?entity_id=${entityId}` : ""}`);
export const bindSendPoint = (
  key: string,
  body: { entity_id?: string | null; email_identity_id?: string | null; email_connection_id?: string | null },
) => tenant<SendPointBinding>(`/mail/send-points/${encodeURIComponent(key)}`, {
  method: "PUT",
  body: body,
});
export const unbindSendPoint = (key: string, entityId?: string) =>
  tenant<{ removed: boolean }>(
    `/mail/send-points/${encodeURIComponent(key)}${entityId ? `?entity_id=${entityId}` : ""}`,
    { method: "DELETE" },
  );

/* cPanel preset — the first tenant runs cPanel, so this is the fast path. */
export const cpanelPreset = (email: string) =>
  tenant<CpanelPreset>(`/mail/cpanel-preset?email=${encodeURIComponent(email)}`);

/* ── PR-1A: conversations ──────────────────────────────────────────────────
 *
 * The types above call a stored message a `ThreadMsg` and treat `thread_key` as
 * a loose grouping hint. Everything below is the real model: a CONVERSATION is a
 * row, a message belongs to one, and read state and stars belong to a PERSON
 * rather than to the mailbox. Two people working billing@ see different unread
 * counts from the same messages — that is the whole point, and it is why every
 * call here is scoped by the caller's session rather than taking a user id.
 *
 * The pre-PR-1A `listThread` / `getMessage` helpers stay until PR-1B replaces
 * their call sites; they read the same rows through the flat view.
 */

export type MailFolder =
  | "INBOX"
  | "SENT"
  | "DRAFTS"
  | "SPAM"
  | "ARCHIVE"
  | "TRASH";
export type MailStream = "HUMAN" | "SYSTEM";

export type Folder = {
  email_folder_id: string;
  email_connection_id: string;
  canonical: MailFolder | null;
  provider_path: string;
  display_name?: string | null;
  is_syncable: boolean;
  /** {uidvalidity, last_uid} for IMAP. Per folder — never shared. */
  sync_cursor?: Record<string, unknown> | null;
  last_sync_at?: string | null;
  last_error?: string | null;
  total: number;
  /** The CALLER's unread count, not the mailbox's. */
  unread_count: number;
};

export type Label = {
  email_label_id: string;
  owner_user_id: string;
  name: string;
  colour?: string | null;
  thread_count: number;
};

export type Thread = {
  email_thread_id: string;
  email_connection_id: string;
  thread_key: string;
  subject?: string | null;
  participants: string[];
  message_count: number;
  has_attachment: boolean;
  stream: MailStream;
  /** A sentence explaining the classification. Shown verbatim. */
  stream_reason?: string | null;
  is_vip: boolean;
  entity_ref?: string | null;
  first_message_at?: string | null;
  last_message_at?: string | null;
  mailbox_address?: string | null;
  mailbox_kind?: MailboxKind | null;
  unread_count: number;
  is_starred: boolean;
  preview?: string | null;
  last_from?: string | null;

  /* ── PR-5 · How the thread is being WORKED ────────────────────────────────
   *
   * Optional on the type because they arrive only once the shared-inbox
   * features are on, and a mailbox with `mail.shared_inbox` off is a mailbox
   * where none of this exists. Rendering has to tolerate their absence rather
   * than treat it as "unassigned, open, no SLA" — those are claims. */
  assigned_to?: string | null;
  assigned_to_name?: string | null;
  work_status?: WorkStatus | null;
  visibility?: Visibility | null;
  sla_due_at?: string | null;
  sla_breached?: boolean | null;
  locked_by?: string | null;
  locked_by_name?: string | null;
  lock_expires_at?: string | null;
  /** Set once the thread has been turned into a record (§7.7). */
  converted_entity_ref?: string | null;
};

export type Message = {
  email_message_id: string;
  email_thread_id: string;
  email_connection_id: string;
  external_message_id?: string | null;
  message_id_header?: string | null;
  direction: "IN" | "OUT";
  folder: MailFolder;
  provider_folder?: string | null;
  from_address: string;
  from_name?: string | null;
  to_address: string[];
  cc_address: string[];
  subject?: string | null;
  body_preview?: string | null;
  body_html?: string | null;
  body_text?: string | null;
  in_reply_to?: string | null;
  references_header?: string[] | null;
  size_bytes?: number | null;
  has_attachment: boolean;
  /** PR-0 origin tag: PRAXIS, or the device that actually sent it. */
  sent_via?: string | null;
  origin_user_id?: string | null;
  origin_send_point?: string | null;
  received_at?: string | null;
  is_read: boolean;
  is_starred: boolean;

  /* ── PR-5 §9.7 · Anti-spoof ───────────────────────────────────────────────
   *
   * Stamped on INBOUND messages at ingest. Absent means the verdict has not
   * been computed — not that the sender is fine — so the banner renders
   * nothing rather than a green tick. */
  auth_verdict?: AuthVerdict | null;
  auth_detail?: Record<string, unknown> | null;
};

export type ThreadDetail = Thread & { messages: Message[] };

export type BulkOp =
  | "read"
  | "unread"
  | "star"
  | "unstar"
  | "move"
  | "label"
  | "unlabel"
  /**
   * Permanent, retention-aware deletion.
   *
   * `mail.validator.threadBulk` has accepted `"delete"` and `threads.bulk` has
   * routed it to `remove()` since H-1; this type left it out, so no screen
   * could ask for it. A message sealed into the compliance archive is retained
   * and REPORTED rather than silently skipped — see `deleteThreads` below.
   */
  | "delete";
export type BulkResult = {
  op: BulkOp;
  succeeded: number;
  failed: { email_thread_id: string; error: string }[];
};

export type ThreadQuery = {
  /** The search box, verbatim: `from:maersk has:attachment demurrage`. */
  q?: string;
  connection_id?: string;
  folder?: MailFolder;
  stream?: MailStream;
  label?: string;
  entity_ref?: string;
  unread?: boolean;
  starred?: boolean;
  vip?: boolean;
  has_attachment?: boolean;
  /** Cursor: the `last_message_at` of the oldest row you already have. */
  before?: string;
  limit?: number;
};

/**
 * Coerce an address list into an array, whatever the server sent.
 *
 * The server is supposed to send arrays and now does — `citext[]` is cast to
 * `text[]` at every read, and a CI gate keeps it that way. This is the second
 * line, and it exists because of what the first failure cost: a single column
 * arriving as the Postgres literal `"{a@b.cm,c@d.cm}"` instead of an array made
 * `.filter` throw inside a row renderer, and the error boundary took the ENTIRE
 * Mailbox screen — folder rail, list, reading pane, all of it — for one bad
 * field on one conversation.
 *
 * A workspace should not be that brittle. Parsing the literal here means the
 * worst case degrades to one row looking odd, which someone can report, instead
 * of a screen nobody can open.
 */
const toAddressList = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v !== "string" || v === "") return [];
  // A Postgres array literal: {a@b.cm,"quoted, value"}
  if (v.startsWith("{") && v.endsWith("}")) {
    return (v.slice(1, -1).match(/"(?:[^"\\]|\\.)*"|[^,]+/g) || [])
      .map((x) => x.trim().replace(/^"|"$/g, "").replace(/\\"/g, '"'))
      .filter(Boolean);
  }
  return [v];
};

/** Normalise the array-shaped fields on a conversation as it comes off the wire. */
const normaliseThread = (t: Thread): Thread => ({
  ...t,
  participants: toAddressList(t.participants),
});

const normaliseMessage = (m: Message): Message => ({
  ...m,
  to_address: toAddressList(m.to_address),
  cc_address: toAddressList(m.cc_address),
});

const qs = (o: Record<string, unknown>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) {
    if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
};

export const listThreads = (q: ThreadQuery = {}) =>
  tenant<Thread[]>(`/mail/threads${qs(q)}`).then((rows) => (rows || []).map(normaliseThread));
export const getThread = (id: string) =>
  tenant<ThreadDetail>(`/mail/threads/${id}`).then((t) => ({
    ...normaliseThread(t),
    messages: (t.messages || []).map(normaliseMessage),
  }));

export const setThreadRead = (id: string, on = true) =>
  tenant<{ email_thread_id: string; messages: number; is_read: boolean }>(
    `/mail/threads/${id}/read`,
    { method: "POST", body: { on } },
  );
export const setThreadStarred = (id: string, on = true) =>
  tenant<{ email_thread_id: string; messages: number; is_starred: boolean }>(
    `/mail/threads/${id}/star`,
    { method: "POST", body: { on } },
  );
export const moveThread = (id: string, folder: MailFolder) =>
  tenant<{ email_thread_id: string; folder: MailFolder; messages: number }>(
    `/mail/threads/${id}/move`,
    { method: "POST", body: { folder } },
  );
/** Correct the classifier. Recorded as a human decision so no later pass undoes it. */
export const setThreadStream = (id: string, stream: MailStream) =>
  tenant<Thread>(`/mail/threads/${id}/stream`, {
    method: "POST",
    body: { stream },
  });
export const setThreadLabel = (id: string, labelId: string, on = true) =>
  tenant<{ email_thread_id: string; email_label_id: string; applied: boolean }>(
    `/mail/threads/${id}/label`,
    { method: "POST", body: { label_id: labelId, on } },
  );
export const bulkThreads = (body: {
  ids: string[];
  op: BulkOp;
  folder?: MailFolder;
  label_id?: string;
}) =>
  tenant<BulkResult>("/mail/threads/bulk", {
    method: "POST",
    body: body,
  });

/* ── Deletion (H-1) ────────────────────────────────────────────────────────
 *
 * Both endpoints were built — retention-aware, ledgered, and told to the mail
 * server so a deleted message does not come back on the next sync — and neither
 * had a wrapper here. Which is also why `mail-client-api-wiring.test.js` never
 * flagged them: that gate walks the wrappers in this file and asks who calls
 * them, so an endpoint with no wrapper at all is invisible to it. The whole
 * feature was unreachable and nothing said so.
 *
 * `retained_archived` is the field that must never be dropped on the floor. A
 * message sealed into `email_archive` is under retention and stays; reporting
 * "deleted" over a partial result would tell somebody their correspondence is
 * gone when it is not, which is the opposite of what a retention control is
 * for.
 */
export type ThreadDeletion = {
  email_thread_id: string;
  deleted: number;
  retained_archived: number;
  thread_removed: boolean;
};
export const deleteThread = (id: string) =>
  tenant<ThreadDeletion>(`/mail/threads/${id}`, { method: "DELETE" });

export type FolderEmptied = {
  folder: MailFolder;
  threads: number;
  deleted: number;
  retained_archived: number;
  failed: { email_thread_id: string; error: string }[];
};
/** TRASH and SPAM only — the server refuses anything else by name. */
export const emptyFolder = (folder: "TRASH" | "SPAM") =>
  tenant<FolderEmptied>("/mail/folders/empty", { method: "POST", body: { folder } });

/**
 * The rail, in one call: folders with the CALLER's unread counts, plus the two
 * stream totals. One request rather than two, because the halves are drawn as
 * one thing and arriving separately makes the numbers visibly disagree for a
 * frame.
 */
export type FolderRailData = {
  folders: Folder[];
  streams: { HUMAN: number; SYSTEM: number };
  /**
   * Which mailbox the rail is describing. Echoed back because a call that names
   * no mailbox is answered for the caller's default one rather than with
   * nothing, and the caller has to be able to show which that was.
   */
  connection_id?: string | null;
};
export const listFolders = (connectionId?: string) =>
  tenant<FolderRailData>(`/mail/folders${qs({ connection_id: connectionId })}`);
export const listLabels = () => tenant<Label[]>("/mail/labels");
export const createLabel = (body: { name: string; colour?: string }) =>
  tenant<Label>("/mail/labels", { method: "POST", body: body });
export const deleteLabel = (id: string) =>
  tenant<{ email_label_id: string } | null>(`/mail/labels/${id}`, {
    method: "DELETE",
  });

/* ── PR-1B: composing ──────────────────────────────────────────────────────
 *
 * Sending is a QUEUE, and the API says so. `sendMessage` returns a queue id and
 * a release time rather than a sent message, because at that moment nothing has
 * been sent — that gap is what makes undo possible, and a client that pretends
 * otherwise will show a confirmation for a message it can still recall.
 */

/** TipTap's document shape. Structural only — the server's serializer is the authority. */
export type EditorDoc = {
  type?: string;
  content?: unknown[];
  [k: string]: unknown;
};

export type Draft = {
  email_draft_id: string;
  user_id: string;
  email_connection_id?: string | null;
  email_thread_id?: string | null;
  reply_to_message_id?: string | null;
  kind: "NEW" | "REPLY" | "REPLY_ALL" | "FORWARD";
  to_address: string[];
  cc_address: string[];
  bcc_address: string[];
  subject?: string | null;
  body_json?: EditorDoc | null;
  /** What WOULD be sent, produced by the server. Never fed back into the editor. */
  body_html?: string | null;
  body_text?: string | null;
  send_point_key?: string | null;
  updated_at?: string | null;
  /** Oversized message, image with no description — worth showing while there is still time. */
  warnings?: string[];
};

export type MailAttachment = {
  email_attachment_id: string;
  email_draft_id?: string | null;
  email_message_id?: string | null;
  vault_id?: string | null;
  filename?: string | null;
  content_type?: string | null;
  size_bytes?: number | null;
  direction: "IN" | "OUT";
  disposition: "attachment" | "inline";
  content_id?: string | null;
};

export type AttachmentTray = {
  attachments: MailAttachment[];
  total_bytes: number;
  limit_bytes: number;
  /** Past 10 MB the composer offers a secure link instead — PR-5 wires it. */
  offer_secure_link: boolean;
};

export type QueuedSend = {
  email_send_queue_id: string;
  release_at: string;
  undo_seconds: number;
  status: "HELD" | "QUEUED" | "SENDING" | "SENT" | "FAILED" | "CANCELLED";
  warnings?: string[];
};

export type OutboxEntry = {
  email_send_queue_id: string;
  status: QueuedSend["status"];
  release_at: string;
  attempts: number;
  last_error?: string | null;
  error_code?: string | null;
  payload: { to?: string[]; subject?: string | null };
  created_at: string;
};

export type CommandDescriptor = {
  key: string;
  label: string;
  description: string;
  params: string[];
  module_key: string | null;
  /** /document names a file to attach; everything else inserts data. */
  attaches: boolean;
  available: boolean;
  /** Why not, in the user's words. A greyed command with no reason is worse than none. */
  unavailable_reason: string | null;
};

export type CommandResult = {
  key: string;
  node: EditorDoc;
  attach: { vault_id: string | null } | null;
};

/* Drafts */
export const listDrafts = (threadId?: string) =>
  tenant<Draft[]>(`/mail/drafts${qs({ thread_id: threadId })}`);
export const getDraft = (id: string) => tenant<Draft>(`/mail/drafts/${id}`);
export const saveDraft = (body: Partial<Draft> & { email_draft_id?: string }) =>
  tenant<Draft>("/mail/drafts", { method: "POST", body: body });
export const discardDraft = (id: string) =>
  tenant<{ discarded: boolean }>(`/mail/drafts/${id}`, { method: "DELETE" });

/* Attachments */
export const draftAttachments = (draftId: string) =>
  tenant<AttachmentTray>(`/mail/drafts/${draftId}/attachments`);
export const uploadAttachment = (body: {
  email_draft_id: string;
  filename: string;
  data_url: string;
  disposition?: "attachment" | "inline";
  content_id?: string;
}) => tenant<MailAttachment & { total_bytes: number; offer_secure_link: boolean }>(
  "/mail/attachments/upload", { method: "POST", body: body },
);
export const attachFromVault = (body: {
  email_draft_id: string;
  vault_id: string;
  filename?: string;
  disposition?: "attachment" | "inline";
}) => tenant<MailAttachment>("/mail/attachments/from-vault", { method: "POST", body: body });
export const removeAttachment = (draftId: string, attachmentId: string) =>
  tenant<{ removed: boolean }>(`/mail/drafts/${draftId}/attachments/${attachmentId}`, { method: "DELETE" });

/* Sending */
export const sendMessage = (body: {
  connectionId: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string | null;
  body_json?: EditorDoc | null;
  email_draft_id?: string | null;
  email_thread_id?: string | null;
  reply_to_message_id?: string | null;
  in_reply_to?: string | null;
  references?: string[];
  quoted_html?: string | null;
  quoted_text?: string | null;
  undo_seconds?: number;
  idempotency_key?: string;
}) => tenant<QueuedSend>("/mail/send", { method: "POST", body: body });

export const cancelSend = (queueId: string) =>
  tenant<{ status: "CANCELLED" }>(`/mail/send/${queueId}/cancel`, { method: "POST" });
export const listOutbox = () => tenant<OutboxEntry[]>("/mail/outbox");

/* Slash commands */
export const listCommands = (lang?: string) =>
  tenant<CommandDescriptor[]>(`/mail/commands${qs({ lang })}`);
export const runCommand = (key: string, body: {
  params?: Record<string, string | number>;
  lang?: string;
  entity_ref?: string | null;
  email_thread_id?: string | null;
}) => tenant<CommandResult>(`/mail/commands/${encodeURIComponent(key)}`, {
  method: "POST", body: body,
});

/* ── PR-2: signatures & deliverability ──────────────────────────────────── */

export type SignatureTemplate = {
  signature_template_id: string;
  key: string;
  name: string;
  description?: string | null;
  layout: Record<string, unknown>;
  copy_en: Record<string, unknown>;
  copy_fr: Record<string, unknown>;
  scope_kind: "TENANT" | "DEPARTMENT" | "ENTITY";
  scope_value?: string | null;
  is_default: boolean;
  is_system: boolean;
  is_active: boolean;
};

export type SignatureProfile = {
  person: {
    user_id?: string;
    user_full_name?: string | null;
    employee_full_name?: string | null;
    job_title?: string | null;
    department?: string | null;
  } | null;
  profile: {
    phone_desk?: string | null;
    phone_mobile?: string | null;
    whatsapp?: string | null;
    pronouns?: string | null;
    credentials?: string | null;
    booking_url?: string | null;
    language?: "en" | "fr" | null;
    is_enabled?: boolean;
    signature_template_id?: string | null;
  } | null;
  preview: { html?: string; text?: string; language?: string } | null;
};

export const getSignatureProfile = () => tenant<SignatureProfile>("/mail/signature");
export const saveSignatureProfile = (body: Record<string, unknown>) =>
  tenant("/mail/signature", { method: "PUT", body: body });
export const previewSignature = (lang?: string) =>
  tenant<{ html: string; text: string }>(`/mail/signature/preview${lang ? `?lang=${lang}` : ""}`);
export const listSignatureTemplates = () => tenant<SignatureTemplate[]>("/mail/signature/templates");

/** MOD-70 `edit`. The server refuses to deactivate a seeded template. */
export const updateSignatureTemplate = (
  id: string,
  patch: Partial<Pick<SignatureTemplate, "name" | "is_default" | "is_active">>,
) =>
  tenant<SignatureTemplate>(`/mail/signature/templates/${id}`, {
    method: "PATCH",
    body: patch,
  });

export type SignatureMotto = {
  signature_template_id: string;
  name: string;
  /** Empty string means "no motto", which is a value, not a missing record. */
  en: string;
  fr: string;
};

/**
 * The motto/slogan on one template, per language.
 *
 * A pair of its own rather than a slice of the template PATCH, because the
 * motto lives inside the `copy_en` / `copy_fr` blobs and writing it through
 * those means read-modify-write — get it wrong and the confidentiality notice
 * in the same object is erased. The server does the merge; this sends strings.
 */
export const getSignatureMotto = (templateId: string) =>
  tenant<SignatureMotto>(`/mail/signature/templates/${templateId}/motto`);

export const saveSignatureMotto = (
  templateId: string,
  body: { en?: string; fr?: string },
) =>
  tenant<SignatureMotto>(`/mail/signature/templates/${templateId}/motto`, {
    method: "POST",
    body,
  });

export async function downloadSignaturePng(opts: { language?: string; scale?: 1 | 2 | 3 } = {}) {
  const q = new URLSearchParams();
  if (opts.language) q.set("lang", opts.language);
  if (opts.scale) q.set("scale", String(opts.scale));
  const { tenantDownload } = await import("./api-client");
  await tenantDownload(`/mail/signature/png?${q.toString()}`, `signature-${opts.scale || 1}x.png`);
}

/** One blank field on the signature, and where to go and fill it. */
export type SignatureGap = {
  key: string;
  label: string;
  /** "you", "HR", "an administrator" — who can fill it. */
  owner: string;
  hint: string;
  scope: "self" | "hr" | "entity" | "brand" | "template";
  /**
   * Null for either of two reasons, and they mean different things: the caller
   * has no grant on the surface that owns the field, OR the server could not
   * build a link that lands on the control (see `precise`). A link is never
   * degraded to "somewhere near it".
   */
  href: string | null;
  actionable: boolean;
  /** The path in words — "Master data → Corporate entities → …". Always set. */
  where: string | null;
  /** True when `href` lands on the field itself. False means there is no href. */
  precise: boolean;
};

export type SignatureCard = {
  kind: string;
  gaps?: SignatureGap[];
  /** The full HTML document the PNG renderer screenshots. Null for the
   *  non-card layouts, which have no separate card document. */
  document: string | null;
  html?: string;
  width: number;
  height: number;
  language?: string;
};

/** The card exactly as it will be rendered to PNG. See signature.service.cardPreview. */
export const getSignatureCard = (lang?: string) =>
  tenant<SignatureCard>(`/mail/signature/card${lang ? `?lang=${lang}` : ""}`);

/** The caller's own staff record. `/employees/mine` — no grant, no id. */
export type MyEmployee = {
  linked: boolean;
  employee: null | {
    employee_id: string;
    full_name: string | null;
    job_title: string | null;
    department: string | null;
    email: string | null;
    phone_desk: string | null;
    phone_mobile: string | null;
    entity_id: string | null;
    is_active: boolean | null;
  };
};

export const getMyEmployee = () => tenant<MyEmployee>("/employees/mine");

/** Only the caller's own phones are writable here; the server allow-lists. */
export const updateMyEmployee = (patch: {
  phone_desk?: string | null;
  phone_mobile?: string | null;
}) => tenant<MyEmployee>("/employees/mine", { method: "PATCH", body: patch });

export type SignatureStaff = {
  user_id: string;
  full_name: string;
  job_title: string | null;
  department: string | null;
  email: string | null;
  has_profile: boolean;
};

export const listSignatureStaff = (q?: string) =>
  tenant<SignatureStaff[]>(`/mail/signature/staff${q ? `?q=${encodeURIComponent(q)}` : ""}`);

/** One ZIP of PNGs for the selected staff. MOD-70 `edit`. */
export async function downloadSignatureBatch(body: {
  user_ids: string[];
  language?: string;
  scale?: 1 | 2 | 3;
}) {
  const stamp = new Date().toISOString().slice(0, 10);
  const { tenantDownloadPost } = await import("./api-client");
  await tenantDownloadPost("/mail/signature/batch", body, `signatures-${stamp}.zip`);
}

export type SignatureDiagnosticStep = {
  step: string;
  ok: boolean;
  why?: string;
  [detail: string]: unknown;
};

export type SignatureDiagnostics = {
  ok: boolean;
  /** The step to fix. The ones after it are usually consequences. */
  first_failure: string | null;
  renderer_version: number;
  steps: SignatureDiagnosticStep[];
};

/**
 * Run the card-delivery chain and report the first broken link. MOD-70 `view`.
 *
 * `write: true` also stores one throwaway object, which is the only way to
 * prove the storage leg rather than infer it.
 */
export const diagnoseSignature = (write = false) =>
  tenant<SignatureDiagnostics>(`/mail/signature/diagnose${write ? "?write=true" : ""}`);

export type DomainHealthRow = {
  domain_health_check_id: string;
  domain: string;
  record: "MX" | "SPF" | "DKIM" | "DMARC" | "PTR" | "RBL";
  selector?: string | null;
  verdict: "PASS" | "FAIL" | "UNKNOWN";
  value?: string | null;
  suggestion?: string | null;
  checked_at: string;
};

/**
 * "Will mail we send actually REACH this domain?"
 *
 * The opposite question to the rest of this panel. Every other check is about a
 * domain we send AS; this is about one we send TO, and it catches a relay that
 * hosts the recipient's domain and would file the message into a mailbox on
 * itself rather than routing it — accepted, never delivered, never bounced.
 */
export type DeliveryRouteVerdict = {
  state: "OK" | "LOCAL_TRAP" | "UNKNOWN";
  ok: boolean | null;
  reason: string;
  domain: string | null;
  smtp_host: string | null;
  relay_ips?: string[];
  recipient_ips?: string[];
  mx_hosts?: string[];
  sender_source?: string;
};

export const checkDeliveryRoute = (domain: string) =>
  tenant<DeliveryRouteVerdict>("/mail/deliverability/route", {
    method: "POST",
    body: { domain },
  });

export const listDeliverability = () => tenant<DomainHealthRow[]>("/mail/deliverability");
export const checkDeliverability = (domain?: string) =>
  tenant("/mail/deliverability/check", {
    method: "POST",
    body: domain ? { domain } : {},
  });
export const deliverabilityHistory = (domain: string) =>
  tenant<DomainHealthRow[]>(`/mail/deliverability/${encodeURIComponent(domain)}/history`);


/* ── PR-3, PR-4, PR-5 ──────────────────────────────────────────────────────
 *
 * Binding, the dossier drawer, action cards, notes, conversion, document
 * intake, the AI layer, triage, SLA, secure links, visibility, anti-spoof and
 * the archive all live in `mail-api-work.ts`.
 *
 * Split because this file passed a thousand lines and that section — the newest
 * and least exercised third of the mail API — was the part nobody could see the
 * shape of. Re-exported here so every existing `import * as api from
 * "@/lib/mail-api"` keeps working; new code may import either.
 */
export * from "./mail-api-work";
