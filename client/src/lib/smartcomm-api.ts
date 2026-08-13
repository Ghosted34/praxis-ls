/**
 * Smart Comms API — the internal corporate team chat (auditable). Channels are
 * `comms_group`s (DEPARTMENT / PROJECT / DOSSIER / DIRECT / CLIENT) with
 * messages, members, unread + pin.
 */
import { tenant } from "./api-client";

export type ChannelKind = "DEPARTMENT" | "PROJECT" | "DOSSIER" | "DIRECT" | "CLIENT";

export type CommMessage = {
  message_id: string;
  group_id: string;
  sender_user_id?: string | null;
  body?: string | null;
  media_vault_id?: string | null;
  created_at?: string | null;
};

export type Channel = {
  group_id: string;
  name: string;
  kind?: ChannelKind | null;
  dossier_id?: string | null;
  created_at?: string | null;
  is_pinned?: boolean;
  is_muted?: boolean;
  unread?: number;
  member_count?: number;
  last_message?: CommMessage | null;
  /** The other member's uploaded profile photo (/media URL) — DIRECT channels only. */
  partner_avatar_ref?: string | null;
};

export type Colleague = { user_id: string; full_name?: string | null; email: string; avatar_ref?: string | null };

/* ── Outbound provider config (email) — set + live test ── */
export type CommsConfig = {
  email: { smtp_host: string | null; smtp_port: number; smtp_user: string | null; from: string | null; reply_to: string | null; pass_set: boolean };
};
export type TestResult = { ok: boolean; error?: string; status?: number } & Record<string, unknown>;

export const getCommsConfig = () => tenant<CommsConfig>("/smartcomm/config");
export const setEmailConfig = (body: { smtp_host?: string; smtp_port?: number; smtp_user?: string; smtp_pass?: string; from?: string; reply_to?: string }) =>
  tenant<CommsConfig>("/smartcomm/config/email", { method: "PUT", body });
export const testEmail = () => tenant<TestResult>("/smartcomm/config/email/test", { method: "POST" });

/* ─────────────────────────────────────────────────────────────────────────
 * Mail-setup wizard probes (Comms → Setup guide).
 *   dnsCheckEmail — MX / SPF / DKIM verification for the From domain.
 *     ok: true = verified · false = definitively missing (suggested values
 *     attached) · null = couldn't check (wizard falls back to a self-check).
 *   testSendEmail — sends a REAL test message through the tenant's transport.
 * ──────────────────────────────────────────────────────────────────────── */

export type DnsRecordCheck = {
  ok: boolean | null;
  records?: { host: string; priority: number }[];
  record?: string | null;
  selector?: string | null;
  domain?: string;
  note?: string;
  suggest?: string[];
  hint?: string | null;
  error?: string | null;
};
export type DnsCheckResult = {
  domain: string;
  mx: DnsRecordCheck;
  spf: DnsRecordCheck;
  dkim: DnsRecordCheck;
  done: boolean;
  checked_at?: string;
};
export const dnsCheckEmail = (domain: string) =>
  tenant<DnsCheckResult>("/smartcomm/config/email/dns-check", { method: "POST", body: { domain } });
export const testSendEmail = (body: { to: string; purpose?: string }) =>
  tenant<TestResult & { to?: string; message_id?: string | null }>("/smartcomm/config/email/test-send", { method: "POST", body });

export const listChannels = () => tenant<Channel[]>("/smartcomm/channels");
export const getChannel = (id: string) => tenant<Channel>(`/smartcomm/channels/${id}`);
export const createChannel = (body: { name: string; kind?: ChannelKind; member_ids?: string[]; topic?: string }) =>
  tenant<Channel>("/smartcomm/channels", { method: "POST", body });
export const getThread = (id: string) => tenant<{ group_id: string; messages: CommMessage[] }>(`/smartcomm/channels/${id}/messages`);
export const postMessage = (id: string, body: string) =>
  tenant<CommMessage>(`/smartcomm/channels/${id}/messages`, { method: "POST", body: { body } });
export const markRead = (id: string) => tenant<{ ok: boolean }>(`/smartcomm/channels/${id}/read`, { method: "POST" });
export const listColleagues = () => tenant<Colleague[]>("/smartcomm/colleagues");
