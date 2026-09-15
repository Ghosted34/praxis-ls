/**
 * Smart Comms API — the internal corporate team chat (auditable). Channels are
 * `comms_group`s (DEPARTMENT / PROJECT / DOSSIER / DIRECT / CLIENT) with
 * messages, members, unread + pin.
 */
import { tenant, uploadFile, tenantObjectUrl, tenantBlob } from "./api-client";

export type ChannelKind =
  "DEPARTMENT" | "PROJECT" | "DOSSIER" | "DIRECT" | "CLIENT";

/** What a chat attachment points at. See migration 13794. */
export type AttachmentKind = "VAULT" | "MEDIA" | "ERP";
export type MediaKind = "IMAGE" | "AUDIO" | "VIDEO";
export type TranscriptStatus = "NONE" | "PENDING" | "DONE" | "FAILED" | "UNAVAILABLE";
export type ErpKind = "INVOICE" | "DOSSIER" | "CLIENT" | "PURCHASE_ORDER" | "SUPPLIER_INVOICE";

/**
 * A record card, resolved LIVE against the reader.
 *
 * `redacted` is the half that matters: a member who lacks view on the record's
 * module gets the reference the sender saw and nothing with a number in it.
 * Render it as a restricted card, never as a missing one — the message still
 * happened. See src/modules/smartcomm/smartcomm.erp.service.js.
 */
export type ErpCard = {
  kind: ErpKind;
  id: string;
  ref: string | null;
  title: string | null;
  subtitle: string | null;
  status: string | null;
  amount: number | null;
  currency: string | null;
  /** ISO on the wire, as everywhere. Render with dateDmy / dateFmt. */
  date: string | null;
  url: string | null;
  redacted: boolean;
};

export type CommAttachment = {
  attachment_id?: string;
  message_id?: string;
  attachment_kind: AttachmentKind;
  filename?: string | null;
  content_type?: string | null;
  size_bytes?: number | null;
  /* VAULT */
  vault_id?: string | null;
  /* MEDIA — flattened from comms_media by the thread query */
  media_id?: string | null;
  media_kind?: MediaKind | null;
  width?: number | null;
  height?: number | null;
  duration_ms?: number | null;
  waveform?: number[] | null;
  is_voice_note?: boolean | null;
  transcript?: string | null;
  transcript_status?: TranscriptStatus | null;
  original_name?: string | null;
  promoted_vault_id?: string | null;
  /* ERP */
  erp_kind?: ErpKind | null;
  erp_id?: string | null;
  erp_label?: string | null;
  erp_card?: ErpCard | null;
};

/** What `POST /channels/:id/media` hands back, and what the composer echoes
 *  into `postMessage`. */
export type UploadedAttachment = {
  attachment_kind: "VAULT" | "MEDIA";
  vault_id?: string;
  media_id?: string;
  kind?: MediaKind;
  filename?: string | null;
  content_type?: string;
  size_bytes?: number;
  width?: number | null;
  height?: number | null;
  duration_ms?: number | null;
  waveform?: number[] | null;
  is_voice_note?: boolean;
  transcript_status?: TranscriptStatus;
};

/** An ERP reference, as the composer stages it before the message is sent. */
export type ErpAttachment = {
  attachment_kind: "ERP";
  erp_kind: ErpKind;
  erp_id: string;
  erp_label?: string | null;
};

export type PostedAttachment = UploadedAttachment | ErpAttachment;

export type CommMessage = {
  message_id: string;
  group_id: string;
  sender_user_id?: string | null;
  body?: string | null;
  media_vault_id?: string | null;
  reply_to_message_id?: string | null;
  edited_at?: string | null;
  deleted_at?: string | null;
  delivery?: "SENT" | "DELIVERED" | "READ" | null;
  created_at?: string | null;
  /** Present on the thread read; absent on the bare row a post returns. */
  attachments?: CommAttachment[];
  reactions?: { emoji: string; count: number; users?: string[] }[];
  starred_by_me?: boolean;
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

export type Colleague = {
  user_id: string;
  full_name?: string | null;
  email: string;
  avatar_ref?: string | null;
};

/* ── Outbound provider config (email) — set + live test ── */
export type CommsConfig = {
  email: {
    smtp_host: string | null;
    smtp_port: number;
    smtp_user: string | null;
    from: string | null;
    reply_to: string | null;
    pass_set: boolean;
  };
};
export type TestResult = {
  ok: boolean;
  error?: string;
  status?: number;
} & Record<string, unknown>;

export const getCommsConfig = () => tenant<CommsConfig>("/smartcomm/config");
export const setEmailConfig = (body: {
  smtp_host?: string;
  smtp_port?: number;
  smtp_user?: string;
  smtp_pass?: string;
  from?: string;
  reply_to?: string;
}) => tenant<CommsConfig>("/smartcomm/config/email", { method: "PUT", body });
export const testEmail = () =>
  tenant<TestResult>("/smartcomm/config/email/test", { method: "POST" });

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
  tenant<DnsCheckResult>("/smartcomm/config/email/dns-check", {
    method: "POST",
    body: { domain },
  });
export const testSendEmail = (body: { to: string; purpose?: string }) =>
  tenant<TestResult & { to?: string; message_id?: string | null }>(
    "/smartcomm/config/email/test-send",
    { method: "POST", body },
  );

export const listChannels = () => tenant<Channel[]>("/smartcomm/channels");
export const getChannel = (id: string) =>
  tenant<Channel>(`/smartcomm/channels/${id}`);
export const createChannel = (body: {
  name: string;
  kind?: ChannelKind;
  member_ids?: string[];
  topic?: string;
}) => tenant<Channel>("/smartcomm/channels", { method: "POST", body });
export const getThread = (id: string) =>
  tenant<{ group_id: string; messages: CommMessage[] }>(
    `/smartcomm/channels/${id}/messages`,
  );
export const postMessage = (
  id: string,
  body: string,
  opts: { attachments?: PostedAttachment[]; reply_to?: string | null } = {},
) =>
  tenant<CommMessage>(`/smartcomm/channels/${id}/messages`, {
    method: "POST",
    body: {
      body,
      ...(opts.attachments && opts.attachments.length ? { attachments: opts.attachments } : {}),
      ...(opts.reply_to ? { reply_to: opts.reply_to } : {}),
    },
  });

export const editMessage = (messageId: string, body: string) =>
  tenant<CommMessage>(`/smartcomm/messages/${messageId}`, { method: "PATCH", body: { body } });
export const deleteMessage = (messageId: string) =>
  tenant<{ deleted: boolean }>(`/smartcomm/messages/${messageId}`, { method: "DELETE" });
export const react = (messageId: string, emoji: string) =>
  tenant<{ added: boolean; reactions: { emoji: string; count: number; users: string[] }[] }>(
    `/smartcomm/messages/${messageId}/react`,
    { method: "POST", body: { emoji } },
  );
export const star = (messageId: string) =>
  tenant<{ starred: boolean }>(`/smartcomm/messages/${messageId}/star`, { method: "POST" });

/* ── Attachments ──────────────────────────────────────────────────────────
 *
 * Two steps, deliberately. The bytes go up WHILE the person is still typing
 * (`uploadMedia`), and the message that carries them is posted afterwards with
 * the descriptors it got back. Uploading on send instead would mean a picture
 * appears in the bubble a second or two after the words, and the composer would
 * have nothing to show a progress bar for.
 */
export const uploadMedia = (
  channelId: string,
  file: File,
  fields: {
    is_voice_note?: boolean;
    duration_ms?: number;
    width?: number;
    height?: number;
    waveform?: number[];
  } = {},
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
) =>
  uploadFile<UploadedAttachment>(`/tenant/smartcomm/channels/${channelId}/media`, file, {
    field: "file",
    fields: {
      ...(fields.is_voice_note ? { is_voice_note: "true" } : {}),
      ...(fields.duration_ms != null ? { duration_ms: fields.duration_ms } : {}),
      ...(fields.width != null ? { width: fields.width } : {}),
      ...(fields.height != null ? { height: fields.height } : {}),
      // `fields` JSON-encodes an array for us, which is exactly the form the
      // multipart body needs — see uploadFile in api-client.
      ...(fields.waveform && fields.waveform.length ? { waveform: fields.waveform } : {}),
    },
    onProgress,
    signal,
  });

/**
 * The bytes of one attachment, as an object URL for an <img>/<audio>/<video>.
 *
 * NOT a URL under /media/<key>: that mount is unauthenticated with an
 * allow-list of public prefixes, and a private conversation's attachments are
 * the opposite of that. This read is membership-gated like every other read in
 * the module, which means it carries a Bearer token, which means it cannot be
 * an `src` attribute. The caller revokes — see `useObjectUrl`.
 */
export const mediaObjectUrl = (mediaId: string, signal?: AbortSignal) =>
  tenantObjectUrl(`/smartcomm/media/${mediaId}`, signal);

/** The same bytes, as a Blob, for a caller that has to inspect what arrived —
 *  see `features/comms/chat/clip-source.ts`. */
export const mediaBlob = (mediaId: string, signal?: AbortSignal) =>
  tenantBlob(`/smartcomm/media/${mediaId}`, signal);

/**
 * Ask the workspace's provider to transcribe one voice note.
 *
 * ON DEMAND, and that is the point: a clip is no longer sent to a vendor the
 * moment it is recorded, on the guess that someone will read it. This runs for
 * the one clip whose Transcribe button was pressed, the result is stored, and
 * the channel is told over realtime so nobody else pays for the same sentence.
 *
 * `UNAVAILABLE` comes back when the workspace configured no provider. That is
 * not an error and must not be rendered as one — it is the cue to offer the
 * reader's own browser instead (`features/comms/chat/browser-transcribe.ts`).
 */
export const transcribeMedia = (mediaId: string, language?: "en" | "fr") =>
  tenant<{ media_id: string; transcript: string | null; transcript_status: TranscriptStatus }>(
    `/smartcomm/media/${mediaId}/transcribe`,
    { method: "POST", body: language ? { language } : {} },
  );

export const promoteMedia = (mediaId: string, body: { doc_type?: string; entity_ref?: string } = {}) =>
  tenant<{ media_id: string; vault_id: string; already: boolean }>(
    `/smartcomm/media/${mediaId}/promote`,
    { method: "POST", body },
  );

/* ── ERP references ── */
export const searchErp = (q: string, kinds?: ErpKind[]) =>
  tenant<ErpCard[]>(
    `/smartcomm/erp/search?q=${encodeURIComponent(q)}${kinds && kinds.length ? `&kinds=${kinds.join(",")}` : ""}`,
  );
export const getErpCard = (kind: ErpKind, id: string) =>
  tenant<ErpCard>(`/smartcomm/erp/${kind}/${id}`);
/* ── Per-channel draft ────────────────────────────────────────────────────
 *
 * `comms_draft` has existed since migration 0430 and nothing ever wrote to it,
 * so a half-typed message died with the tab. The composer writes it debounced
 * and clears it BEFORE posting — an autosave landing after a send would restore
 * the text the person just sent.
 *
 * `…ChannelDraft`, not `getDraft`: "draft" already means an unsent EMAIL in
 * this client (`mail-api.getDraft`), and two functions with one name across two
 * modules is ambiguous to a reader before it is ambiguous to anything else. It
 * is also load-bearing — `tests/security/mail-client-api-wiring.test.js` proves
 * every mail wrapper is reached from a screen by matching the call BY NAME, so
 * a chat function called `getDraft` would quietly satisfy that gate on mail's
 * behalf and let a genuinely unwired mail endpoint off its ratchet.
 */
export const getChannelDraft = (id: string) =>
  tenant<{ group_id: string; user_id: string; body: string | null } | null>(
    `/smartcomm/channels/${id}/draft`,
  );
export const saveChannelDraft = (id: string, body: string) =>
  tenant<{ body: string }>(`/smartcomm/channels/${id}/draft`, { method: "PUT", body: { body } });
export const clearChannelDraft = (id: string) =>
  tenant<{ ok: boolean }>(`/smartcomm/channels/${id}/draft`, { method: "DELETE" });

export const markRead = (id: string) =>
  tenant<{ ok: boolean }>(`/smartcomm/channels/${id}/read`, { method: "POST" });
export const listColleagues = () =>
  tenant<Colleague[]>("/smartcomm/colleagues");

/* Personal, tenant-scoped snippets. */
export type QuickPhrase = { quick_reply_id: string; label: string; body: string };
export const listQuickPhrases = () => tenant<QuickPhrase[]>("/smartcomm/quick-replies");
export const saveQuickPhrase = (data: { label: string; body: string }, id?: string) =>
  tenant<QuickPhrase>(`/smartcomm/quick-replies${id ? `/${id}` : ""}`, { method: id ? "PATCH" : "POST", body: data });
export const deleteQuickPhrase = (id: string) => tenant(`/smartcomm/quick-replies/${id}`, { method: "DELETE" });

export type ScheduledMessage = {
  schedule_id: string; group_id: string; body: string; attachments: PostedAttachment[];
  send_at: string; timezone: string; status: "PENDING" | "SENT" | "CANCELLED" | "FAILED";
  last_error?: string | null; message_id?: string | null;
};
export const listScheduledMessages = (channelId: string) => tenant<ScheduledMessage[]>(`/smartcomm/channels/${channelId}/scheduled`);
export const scheduleMessage = (channelId: string, data: { body: string; attachments: PostedAttachment[]; reply_to?: string | null; send_at: string; timezone: string; request_id: string }) =>
  tenant<ScheduledMessage>(`/smartcomm/channels/${channelId}/scheduled`, { method: "POST", body: data });
export const rescheduleMessage = (id: string, send_at: string, timezone: string) => tenant<ScheduledMessage>(`/smartcomm/scheduled/${id}`, { method: "PATCH", body: { send_at, timezone } });
export const cancelScheduledMessage = (id: string) => tenant(`/smartcomm/scheduled/${id}`, { method: "DELETE" });
