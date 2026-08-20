/**
 * Mail API (read-only) — per-purpose sender identities (Billing/Documents/
 * Notifications/Support) and the outbound send log. Each section sends from its
 * own verified identity; this surfaces what went out and its delivery state.
 */
import { tenant } from "./api-client";

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
  stage?: string;
  code?: string;
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

// OAuth — start returns the provider consent URL to redirect the browser to.
export const microsoftStartUrl = () => "/api/tenant/mail/oauth/microsoft/start";
export const googleStartUrl = () => "/api/tenant/mail/oauth/google/start";
export const startMicrosoft = () =>
  tenant<{ url: string }>("/mail/oauth/microsoft/start");
export const startGoogle = () =>
  tenant<{ url: string }>("/mail/oauth/google/start");

// Threads / messages
export const listThread = (connectionId?: string) =>
  tenant<ThreadMsg[]>(
    `/mail/thread${connectionId ? `?connection_id=${connectionId}` : ""}`,
  );
export const getMessage = (id: string) =>
  tenant<ThreadMsg>(`/mail/thread/${id}`);
export const listMsgAttachments = (id: string) =>
  tenant<Attachment[]>(`/mail/thread/${id}/attachments`);
export const markThreadRead = (id: string) =>
  tenant<{ email_inbound_id: string }>(`/mail/thread/${id}/read`, {
    method: "POST",
  });
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
  },
) =>
  tenant<Connection & { test?: TestResult }>(`/mail/connections/${id}`, {
    method: "PATCH",
    body,
  });

// Send / reply
export const sendMail = (body: {
  connectionId: string;
  to: string | string[];
  subject?: string;
  html?: string;
  text?: string;
  cc?: string[];
}) =>
  tenant<{ externalMessageId?: string }>("/mail/send", {
    method: "POST",
    body,
  });
export const replyMail = (
  inboundId: string,
  body: { connectionId: string; html?: string; text?: string },
) =>
  tenant<{ externalMessageId?: string }>(`/mail/thread/${inboundId}/reply`, {
    method: "POST",
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
  tenant<CatalogueEntry>("/mail/catalogue", { method: "POST", body: JSON.stringify(body) });
export const toggleCatalogueEntry = (key: string, isEnabled: boolean) =>
  tenant<CatalogueEntry>(`/mail/catalogue/${encodeURIComponent(key)}`, {
    method: "PATCH",
    body: JSON.stringify({ is_enabled: isEnabled }),
  });

/* Mailbox lifecycle */
export const createSharedMailbox = (body: Record<string, unknown>) =>
  tenant<Mailbox>("/mail/mailboxes/shared", { method: "POST", body: JSON.stringify(body) });
export const archiveMailbox = (id: string) =>
  tenant<Mailbox>(`/mail/mailboxes/${id}/archive`, { method: "POST" });
export const handoverMailbox = (id: string, body: { catalogue_key?: string | null; department?: string | null }) =>
  tenant<Mailbox>(`/mail/mailboxes/${id}/handover`, { method: "POST", body: JSON.stringify(body) });
export const setMailboxLimits = (
  id: string,
  body: { send_limit_hourly?: number | null; send_limit_daily?: number | null; sync_depth_days?: number | null },
) => tenant<Mailbox>(`/mail/mailboxes/${id}/limits`, { method: "PATCH", body: JSON.stringify(body) });
export const sendAllowance = (id: string, count = 1) =>
  tenant<SendAllowance>(`/mail/mailboxes/${id}/allowance?count=${count}`);

/* Access grants */
export const listMembers = (id: string, includeRevoked = false) =>
  tenant<MailboxMember[]>(`/mail/mailboxes/${id}/members${includeRevoked ? "?include_revoked=true" : ""}`);
export const grantMember = (id: string, userId: string, role: MemberRole) =>
  tenant<MailboxMember>(`/mail/mailboxes/${id}/members`, {
    method: "POST",
    body: JSON.stringify({ user_id: userId, member_role: role }),
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
  body: JSON.stringify(body),
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
};

export type ThreadDetail = Thread & { messages: Message[] };

export type BulkOp =
  | "read"
  | "unread"
  | "star"
  | "unstar"
  | "move"
  | "label"
  | "unlabel";
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
    { method: "POST", body: JSON.stringify({ on }) },
  );
export const setThreadStarred = (id: string, on = true) =>
  tenant<{ email_thread_id: string; messages: number; is_starred: boolean }>(
    `/mail/threads/${id}/star`,
    { method: "POST", body: JSON.stringify({ on }) },
  );
export const moveThread = (id: string, folder: MailFolder) =>
  tenant<{ email_thread_id: string; folder: MailFolder; messages: number }>(
    `/mail/threads/${id}/move`,
    { method: "POST", body: JSON.stringify({ folder }) },
  );
/** Correct the classifier. Recorded as a human decision so no later pass undoes it. */
export const setThreadStream = (id: string, stream: MailStream) =>
  tenant<Thread>(`/mail/threads/${id}/stream`, {
    method: "POST",
    body: JSON.stringify({ stream }),
  });
export const setThreadLabel = (id: string, labelId: string, on = true) =>
  tenant<{ email_thread_id: string; email_label_id: string; applied: boolean }>(
    `/mail/threads/${id}/label`,
    { method: "POST", body: JSON.stringify({ label_id: labelId, on }) },
  );
export const bulkThreads = (body: {
  ids: string[];
  op: BulkOp;
  folder?: MailFolder;
  label_id?: string;
}) =>
  tenant<BulkResult>("/mail/threads/bulk", {
    method: "POST",
    body: JSON.stringify(body),
  });

/**
 * The rail, in one call: folders with the CALLER's unread counts, plus the two
 * stream totals. One request rather than two, because the halves are drawn as
 * one thing and arriving separately makes the numbers visibly disagree for a
 * frame.
 */
export type FolderRailData = {
  folders: Folder[];
  streams: { HUMAN: number; SYSTEM: number };
};
export const listFolders = (connectionId?: string) =>
  tenant<FolderRailData>(`/mail/folders${qs({ connection_id: connectionId })}`);
export const listLabels = () => tenant<Label[]>("/mail/labels");
export const createLabel = (body: { name: string; colour?: string }) =>
  tenant<Label>("/mail/labels", { method: "POST", body: JSON.stringify(body) });
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
  tenant<Draft>("/mail/drafts", { method: "POST", body: JSON.stringify(body) });
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
  "/mail/attachments/upload", { method: "POST", body: JSON.stringify(body) },
);
export const attachFromVault = (body: {
  email_draft_id: string;
  vault_id: string;
  filename?: string;
  disposition?: "attachment" | "inline";
}) => tenant<MailAttachment>("/mail/attachments/from-vault", { method: "POST", body: JSON.stringify(body) });
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
}) => tenant<QueuedSend>("/mail/send", { method: "POST", body: JSON.stringify(body) });

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
  method: "POST", body: JSON.stringify(body),
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
  tenant("/mail/signature", { method: "PUT", body: JSON.stringify(body) });
export const previewSignature = (lang?: string) =>
  tenant<{ html: string; text: string }>(`/mail/signature/preview${lang ? `?lang=${lang}` : ""}`);
export const listSignatureTemplates = () => tenant<SignatureTemplate[]>("/mail/signature/templates");

export async function downloadSignaturePng(opts: { language?: string; scale?: 1 | 2 | 3 } = {}) {
  const q = new URLSearchParams();
  if (opts.language) q.set("lang", opts.language);
  if (opts.scale) q.set("scale", String(opts.scale));
  const { tenantDownload } = await import("./api-client");
  await tenantDownload(`/mail/signature/png?${q.toString()}`, `signature-${opts.scale || 1}x.png`);
}

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

export const listDeliverability = () => tenant<DomainHealthRow[]>("/mail/deliverability");
export const checkDeliverability = (domain?: string) =>
  tenant("/mail/deliverability/check", {
    method: "POST",
    body: JSON.stringify(domain ? { domain } : {}),
  });
export const deliverabilityHistory = (domain: string) =>
  tenant<DomainHealthRow[]>(`/mail/deliverability/${encodeURIComponent(domain)}/history`);

/* ── PR-3: binding, notes, context ──────────────────────────────────────── */

export type BindingSuggestion = {
  email_binding_suggestion_id: string;
  entity_ref: string;
  entity_label?: string | null;
  signal: string;
  matched_text?: string | null;
  confidence: number;
  status: "SUGGESTED" | "ACCEPTED" | "REJECTED" | "SUPERSEDED";
};

export const listSuggestions = (threadId: string) =>
  tenant<BindingSuggestion[]>(`/mail/threads/${threadId}/suggestions`);
export const acceptSuggestion = (threadId: string, sid: string) =>
  tenant(`/mail/threads/${threadId}/suggestions/${sid}/accept`, { method: "POST" });
export const rejectSuggestion = (threadId: string, sid: string) =>
  tenant(`/mail/threads/${threadId}/suggestions/${sid}/reject`, { method: "POST" });
export const bindThread = (threadId: string, entity_ref: string) =>
  tenant(`/mail/threads/${threadId}/bind`, { method: "POST", body: JSON.stringify({ entity_ref }) });
export const unbindThread = (threadId: string) =>
  tenant(`/mail/threads/${threadId}/bind`, { method: "DELETE" });

export type MailContext = {
  kind: string;
  header: Record<string, unknown>;
  overview: Record<string, unknown>;
  tabs_available: string[];
};
export const mailContext = (entityRef: string) =>
  tenant<MailContext>(`/mail/context?entity_ref=${encodeURIComponent(entityRef)}`);
export const mailContextTab = (entityRef: string, tab: string) =>
  tenant(`/mail/context/${encodeURIComponent(tab)}?entity_ref=${encodeURIComponent(entityRef)}`);

export type ThreadNote = {
  email_thread_note_id: string;
  author_user_id: string;
  author_name?: string | null;
  body: string;
  created_at: string;
  deleted_at?: string | null;
};
export const listNotes = (threadId: string) =>
  tenant<ThreadNote[]>(`/mail/threads/${threadId}/notes`);
export const addNote = (threadId: string, body: { body: string; mentions?: string[] }) =>
  tenant(`/mail/threads/${threadId}/notes`, { method: "POST", body: JSON.stringify(body) });

/* ── PR-4: AI assist ────────────────────────────────────────────────────── */

export const assistCompose = (body: Record<string, unknown>) =>
  tenant("/mail/assist/compose", { method: "POST", body: JSON.stringify(body) });
export const assistDraft = (body: { thread_id: string }) =>
  tenant("/mail/assist/draft", { method: "POST", body: JSON.stringify(body) });
export const assistSummary = (threadId: string) =>
  tenant(`/mail/assist/summary?thread_id=${encodeURIComponent(threadId)}`);
export const assistGuardrails = (body: Record<string, unknown>) =>
  tenant("/mail/assist/guardrails", { method: "POST", body: JSON.stringify(body) });

/* ── PR-5: workflow / security ──────────────────────────────────────────── */

export const claimThread = (threadId: string) =>
  tenant(`/mail/threads/${threadId}/claim`, { method: "POST" });
export const assignThread = (threadId: string, userId: string) =>
  tenant(`/mail/threads/${threadId}/assign`, { method: "POST", body: JSON.stringify({ user_id: userId }) });
export const setWorkStatus = (threadId: string, status: "OPEN" | "PENDING" | "RESOLVED") =>
  tenant(`/mail/threads/${threadId}/status`, { method: "POST", body: JSON.stringify({ status }) });
export const snoozeThread = (threadId: string, dueAt: string, note?: string) =>
  tenant(`/mail/threads/${threadId}/snooze`, { method: "POST", body: JSON.stringify({ due_at: dueAt, note }) });
export const createFollowup = (threadId: string, body: Record<string, unknown>) =>
  tenant(`/mail/threads/${threadId}/followup`, { method: "POST", body: JSON.stringify(body) });
export const createSecureLink = (body: Record<string, unknown>) =>
  tenant("/mail/secure-links", { method: "POST", body: JSON.stringify(body) });
export const revokeSecureLink = (id: string) =>
  tenant(`/mail/secure-links/${id}/revoke`, { method: "POST" });
export const setVisibility = (threadId: string, visibility: "PRIVATE" | "TEAM" | "COMPANY") =>
  tenant(`/mail/threads/${threadId}/visibility`, { method: "PATCH", body: JSON.stringify({ visibility }) });
export const breakglass = (threadId: string, reason: string) =>
  tenant(`/mail/threads/${threadId}/breakglass`, { method: "POST", body: JSON.stringify({ reason }) });
export const verifyArchive = () => tenant("/mail/archive/verify");

