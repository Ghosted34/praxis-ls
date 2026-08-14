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
  tenant<SentMail[]>(`/mail/sent${identityId ? `?identity_id=${identityId}` : ""}`);

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
  tenant<InboundMail[]>(`/mail/inbox${identityId ? `?identity_id=${identityId}` : ""}`);

/* identity SMTP/from update, and messaging secrets via the settings store */
export const updateSender = (id: string, patch: Partial<Pick<Sender, "from_name" | "reply_to" | "smtp_host" | "smtp_port" | "is_active">>) =>
  tenant<Sender>(`/mail/senders/${id}`, { method: "PATCH", body: patch });
export const putSetting = (section: string, key: string, value: unknown) =>
  tenant<{ ok?: boolean }>(`/settings/${section}/${key}`, { method: "PUT", body: { value } });

export const upsertSender = (body: { purpose: string; from_address?: string; from_name?: string; reply_to?: string; smtp_host?: string; smtp_port?: number; is_active?: boolean; sections?: string[] }) =>
  tenant<Sender>("/mail/senders", { method: "POST", body });

export const archiveSender = (id: string) =>
  tenant<{ email_identity_id: string }>(`/mail/senders/${id}/archive`, { method: "POST" });

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
  tenant<{ email_connection_id: string; is_default: boolean }[]>(`/mail/connections/${id}/default`, { method: "POST" });

export type Recipient = { type: "client" | "supplier" | "employee" | "lead"; id: string; name: string; email: string };
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

export type TestResult = { ok: boolean; error?: string; stage?: string; code?: string };

export type Autoconfig = {
  source: string; provider?: string;
  imap_host?: string; imap_port?: number; imap_secure?: boolean;
  smtp_host?: string; smtp_port?: number; smtp_secure?: boolean;
  oauth_hint?: "microsoft_graph" | "google_gmail";
};
export const autodiscover = (email: string) => tenant<Autoconfig>(`/mail/autodiscover?email=${encodeURIComponent(email)}`);

// Connections
export const listConnections = () => tenant<Connection[]>("/mail/connections");
export const connectImap = (body: {
  email_address: string; display_name?: string;
  imap_host: string; imap_port?: number; imap_secure?: boolean;
  smtp_host: string; smtp_port?: number; smtp_secure?: boolean;
  auth_user?: string; password: string;
}) => tenant<Connection & { test?: TestResult }>("/mail/connections", { method: "POST", body });
export const testConnection = (id: string) => tenant<TestResult>(`/mail/connections/${id}/test`, { method: "POST" });
export const syncConnection = (id: string) => tenant<{ fetched?: number; inserted?: number; error?: string }>(`/mail/connections/${id}/sync`, { method: "POST" });

// OAuth — start returns the provider consent URL to redirect the browser to.
export const microsoftStartUrl = () => "/api/tenant/mail/oauth/microsoft/start";
export const googleStartUrl = () => "/api/tenant/mail/oauth/google/start";
export const startMicrosoft = () => tenant<{ url: string }>("/mail/oauth/microsoft/start");
export const startGoogle = () => tenant<{ url: string }>("/mail/oauth/google/start");

// Threads / messages
export const listThread = (connectionId?: string) =>
  tenant<ThreadMsg[]>(`/mail/thread${connectionId ? `?connection_id=${connectionId}` : ""}`);
export const getMessage = (id: string) => tenant<ThreadMsg>(`/mail/thread/${id}`);
export const listMsgAttachments = (id: string) => tenant<Attachment[]>(`/mail/thread/${id}/attachments`);
export const markThreadRead = (id: string) => tenant<{ email_inbound_id: string }>(`/mail/thread/${id}/read`, { method: "POST" });
export const linkThread = (id: string, entity_ref: string) =>
  tenant<{ entity_ref: string }>(`/mail/thread/${id}/link`, { method: "POST", body: { entity_ref } });
export const clientTimeline = (clientId: string) => tenant<ThreadMsg[]>(`/mail/client/${clientId}/timeline`);

export const updateImapConnection = (id: string, body: { email_address?: string; display_name?: string; imap_host?: string; imap_port?: number; imap_secure?: boolean; smtp_host?: string; smtp_port?: number; smtp_secure?: boolean; auth_user?: string; password?: string }) =>
  tenant<Connection & { test?: TestResult }>(`/mail/connections/${id}`, { method: "PATCH", body });

// Send / reply
export const sendMail = (body: { connectionId: string; to: string | string[]; subject?: string; html?: string; text?: string; cc?: string[] }) =>
  tenant<{ externalMessageId?: string }>("/mail/send", { method: "POST", body });
export const replyMail = (inboundId: string, body: { connectionId: string; html?: string; text?: string }) =>
  tenant<{ externalMessageId?: string }>(`/mail/thread/${inboundId}/reply`, { method: "POST", body });
