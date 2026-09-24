/**
 * Smart Comms API — the internal corporate team chat (auditable). Channels are
 * `comms_group`s (DEPARTMENT / PROJECT / DOSSIER / DIRECT / CLIENT) with
 * messages, members, unread + pin.
 */
import { tenant, uploadFile, tenantObjectUrl, tenantBlob } from "./api-client";

export type ChannelKind =
  "DEPARTMENT" | "PROJECT" | "DOSSIER" | "DIRECT" | "CLIENT";

/** What a chat attachment points at. See migration 13794. */
export type AttachmentKind = "VAULT" | "MEDIA" | "ERP" | "CALL";
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
  /* CALL — the summary card a caller posts. The card is resolved at read time
     (like an ERP reference), so a regenerated draft shows its current words. */
  call_id?: string | null;
  call_card?: CallCard | null;
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

/**
 * A link's preview card, resolved from the tenant's own cache.
 *
 * `image_src` is NEVER a third-party URL — it is our `/smartcomm/links/image`
 * route keyed on the link's hash, and it must be fetched with a token (so it
 * arrives as a blob through `linkImageObjectUrl`, like every other gated file in
 * this module). A `<img src="https://them.example/open.gif">` inside a chat bubble
 * hands the reader's IP, cookies and user agent to the site they only read a link
 * to, which is a tracking pixel in a work product.
 *
 * `state` is the difference between three quiet things and one loud one:
 * `OK` renders a card, `EMPTY`/`UNREACHABLE`/`PENDING` render the link alone, and
 * `REFUSED` renders the link alone forever. None of them is an error to show the
 * user: the message arrived, the URL is right there, and a card is a courtesy from
 * a third-party website rather than a promise this product made.
 */
export type LinkPreviewState = "PENDING" | "OK" | "EMPTY" | "UNREACHABLE" | "REFUSED";
export type LinkMediaKind = "YOUTUBE" | "VIMEO" | "LOOM" | "MAPS";
export type LinkPreview = {
  url: string;
  state: LinkPreviewState;
  title: string | null;
  description: string | null;
  site_name: string | null;
  image_src: string | null;
  icon_src: string | null;
  /** The cache key of THIS link — the only thing a client may hand the image
   *  route. null when the card has no pictures at all, which is the cue for the
   *  bubble not to try. */
  link_hash?: string | null;
  media: { kind: LinkMediaKind; id: string; open_url: string; duration?: number | null; author?: string | null } | null;
  fetched_at: string | null;
  stale: boolean;
};

/** The thread read's link block: one card per distinct URL, referenced by id. */
export type ThreadLinks = Record<string, LinkPreview>;

export type CommMessage = {
  message_id: string;
  group_id: string;
  sender_user_id?: string | null;
  body?: string | null;
  /**
   * Channel-list preview flags, present on `Channel.last_message` only.
   *
   * The list row used to read `body` alone, which is NULL for every media-only
   * message — so a voice note left the preview saying "No messages yet". These
   * say what the message carries instead, and the row renders accordingly. The
   * thread read does not send them: there the attachments themselves arrive.
   */
  attachment_count?: number | null;
  has_voice_note?: boolean | null;
  has_erp?: boolean | null;
  first_media_kind?: MediaKind | null;
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
  /**
   * The URLs in this bubble, in reading order, on the thread read only.
   *
   * Ids rather than cards, because `ThreadLinks` holds the card once. A link
   * quoted nine times in one channel is nine pointers to one preview — the same
   * shape the ERP attachments use, where the reference is stored and the card is
   * resolved per read against the reader.
   */
  link_urls?: string[];
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
  /** The other member's user id — DIRECT channels only. The dial target key. */
  partner_user_id?: string | null;
  /** The other member's uploaded profile photo (/media URL) — DIRECT channels only. */
  partner_avatar_ref?: string | null;
  /** The other member's last presence beat — DIRECT channels only. Render
   *  day-first under the name when they are offline (see presence.ts). */
  partner_last_seen_at?: string | null;
};

export type Colleague = {
  user_id: string;
  full_name?: string | null;
  email: string;
  avatar_ref?: string | null;
  /** Last app-open / return-from-background / navigation beat (server-upserted).
   *  ISO on the wire; render day-first with the lastSeenText helper. The LIVE
   *  presence dot is the socket, not this timestamp. */
  last_seen_at?: string | null;
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
/**
 * The thread, plus the previews its links have earned.
 *
 * `links` is optional and keyed by canonical URL rather than embedded per message,
 * so a client that predates the field ignores it and a thread with the same link
 * quoted nine times carries the card once. Absent means "this server has no
 * preview cache", which renders as plain links — the same thing a `REFUSED` or a
 * dead third party renders as, and the reason the bubble needs no version check.
 */
export const getThread = (id: string) =>
  tenant<{
    group_id: string;
    messages: CommMessage[];
    links?: ThreadLinks;
    /** The reader's own call-summary drafts in this conversation, newest
     *  first: pinned above the composer until sent or discarded. */
    pending_call_summaries?: PendingCallSummary[];
  }>(`/smartcomm/channels/${id}/messages`);
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

/**
 * One link's preview, fetched NOW, for the composer.
 *
 * The exception to every other preview path in this file: this one waits on the
 * third party, because a person is standing there looking at it with the URL
 * still in their input box. Post-send, the card is always read from the cache and
 * never waited on.
 */
export const previewLink = (url: string) =>
  tenant<{
    url: string;
    state: LinkPreviewState;
    title?: string | null;
    description?: string | null;
    card?: LinkPreview;
    reason?: string | null;
  }>("/smartcomm/links/preview", { method: "POST", body: { url } });

/**
 * A preview image, as an object URL.
 *
 * `linkHash` is the sha256 of the CANONICAL link, which is also the card's own
 * key in the thread response — so the client never handles the remote image URL
 * at all, and cannot be talked into fetching one the cache does not have.
 */
export const linkImageObjectUrl = (linkHash: string, part: "image" | "icon" = "image", signal?: AbortSignal) =>
  tenantObjectUrl(
    `/smartcomm/links/image?link=${encodeURIComponent(linkHash)}${part === "icon" ? "&part=icon" : ""}`,
    signal,
  );

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

/* ── 1:1 voice calls (Smart Comms PR-1) ──────────────────────────────────────
 * The server owns the call row (RINGING → IN_CALL → terminal) and both timers;
 * these calls only create, move, and read it. Media is P2P and never touches
 * the API — `ice` below is the ONLY server→client network input the engine
 * gets (STUN/TURN, time-limited TURN credential).
 */
export type CallStatus =
  | "RINGING" | "IN_CALL"
  | "ENDED" | "NO_ANSWER" | "CANCELLED" | "DECLINED" | "BUSY" | "FAILED";
export type CallEndReason =
  | "hangup" | "declined" | "cancelled" | "no_answer" | "busy" | "max_duration" | "ice_failed"
  | "disconnected";

export type IceServer = {
  urls: string | string[];
  username?: string;
  credential?: string;
};
export type IceConfig = { iceServers: IceServer[]; turnConfigured: boolean };

export type Call = {
  call_id: string;
  group_id: string;
  caller_id: string;
  callee_id: string;
  status: CallStatus;
  started_at: string;
  connected_at?: string | null;
  ended_at?: string | null;
  duration_seconds?: number | null;
  end_reason?: CallEndReason | null;
  channel_name?: string | null;
  caller_name?: string | null;
  callee_name?: string | null;
  /** The tenant's recording kill switch, as the call row reports it (PR-2).
   *  False means: no recorder arms, no consent banner shows, because nothing is
   *  being recorded. Absent on the ring payload an older server sends. */
  recording_enabled?: boolean;
  /** The tenant's RNNoise default (PR-3, §4.4). False means this tenant has
   *  switched the yard filter off for everyone; the per-user preference can
   *  still override it either way. Absent on a ring payload from an older
   *  server, which is why the client treats "absent" as "on". */
  noise_suppression?: boolean;
  /** Where the record pipeline is for this call (the row's own column). */
  transcription_state?: CallTranscriptState | null;
  /** The summary's status, when the call has one (list and detail reads). */
  draft_status?: CallSummaryDraft["draft_status"] | null;
};

/** Dial on a DIRECT channel. The partner is resolved server-side; `ice` is
 *  the dialer's config for the engine to start collecting candidates. */
export const dialCall = (groupId: string) =>
  tenant<Call & { ice: IceConfig }>(`/smartcomm/calls`, { method: "POST", body: { group_id: groupId } });
/** Accept carries the acceptor's own ICE config — the callee's engine starts
 *  at answer time and needs TURN creds in the same response. */
export const acceptCall = (id: string) =>
  tenant<Call & { ice: IceConfig }>(`/smartcomm/calls/${id}/accept`, { method: "POST" });
export const declineCall = (id: string) =>
  tenant<Call>(`/smartcomm/calls/${id}/decline`, { method: "POST" });
/** The hang-up route, shared with the keep-alive `fetch` a closing page sends
 *  (call-session.ts), so the two can never point at different URLs (audit A10). */
export const callHangupPath = (id: string) => `/smartcomm/calls/${id}/hangup`;
export const callHangupUrl = (id: string) => `/api/tenant${callHangupPath(id)}`;
export const hangupCall = (id: string) =>
  tenant<Call>(callHangupPath(id), { method: "POST" });
/** The engine exhausted ICE and media never connected. */
export const reportCallFailure = (id: string) =>
  tenant<Call>(`/smartcomm/calls/${id}/fail`, { method: "POST" });
/** One row of the Calls list: the call, plus what its badges need. */
export type CallListRow = Call & {
  channel_name?: string | null;
  notified_at?: string | null;
  summary_update_available?: boolean | null;
};
export const listCalls = () => tenant<CallListRow[]>(`/smartcomm/calls`);
export const getCall = (id: string) => tenant<Call>(`/smartcomm/calls/${id}`);

/* ── The call record half (Smart Comms PR-2) ─────────────────────────────────
 * Recorded audio goes up in PARTS as they are cut (every 120 s, each a
 * complete file), each side then says how many it made, and everything after
 * that is a read: the transcript, the caller's draft, and the caller's send.
 * `recording_enabled` on the call row is the tenant's kill switch — when it is
 * false there is no recorder, no consent banner, and these routes 403.
 */
export type CallRecordSide = "caller" | "callee";
/** NO_RECORDING: nothing was recorded (recording off, no audio uploaded, or
 *  the call never connected). Terminal; shown as "Not recorded". */
export type CallTranscriptState =
  | "PENDING" | "PROCESSING" | "CERTIFIED" | "TRANSCRIPTION_FAILED" | "NO_RECORDING";
/** Where a transcript's words came from. groq and gemini both transcribe the
 *  stored audio; browser-live is the retired in-call capture (old calls only). */
export type CallTranscriptProvider = "groq" | "gemini" | "browser-live";
export type CallProvenance = CallTranscriptProvider | "transcript-only";

export type CallSummaryKeyPoint = { text: string; raised_by: CallRecordSide };
export type CallSummaryFollowUp = { text: string; owner: CallRecordSide; due: string | null };

export type CallSummaryDraft = {
  summary_id: string;
  summary_text: string;
  key_points: CallSummaryKeyPoint[];
  follow_ups: CallSummaryFollowUp[];
  language: "en" | "fr";
  provenance: CallProvenance;
  draft_status: "PENDING_REVIEW" | "SENT" | "DISCARDED";
  sent_message_id: string | null;
  update_available: boolean;
  update_message_id: string | null;
  regenerate_count: number;
};

/** A stretch of one side's recording with no transcript: a part that failed
 *  on both providers, is still pending, or never arrived. Seconds from the
 *  start of that side's recording. */
export type CallTranscriptGap = { side: CallRecordSide; from_s: number; to_s: number; parts: number[] };

/** A caller's draft waiting in a conversation (the pinned card). */
export type PendingCallSummary = {
  call_id: string;
  drafted_at: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  provenance: CallProvenance;
  transcription_state: CallTranscriptState | null;
};

export type CallSummaryView = {
  call_id: string;
  group_id: string;
  gaps: CallTranscriptGap[];
  transcription_state: CallTranscriptState;
  transcription_error: string | null;
  recording_enabled: boolean;
  is_caller: boolean;
  summary: CallSummaryDraft | null;
};

export type CallTranscriptSide = {
  side: CallRecordSide;
  label: string;
  name: string | null;
  provider: CallTranscriptProvider | null;
  certified: boolean;
  text: string | null;
  parts: {
    part_index: number;
    text: string;
    language: "en" | "fr";
    provider: CallTranscriptProvider;
    certified: boolean;
  }[];
};

export type CallTranscriptView = {
  call_id: string;
  state: CallTranscriptState;
  error: string | null;
  certified: boolean;
  provenance: CallTranscriptProvider;
  text: string;
  sides: CallTranscriptSide[];
  parts: {
    side: CallRecordSide;
    part_index: number;
    language: "en" | "fr";
    provider: CallTranscriptProvider;
    certified: boolean;
  }[];
  /** Every recorded part and where it stands. */
  recording?: {
    side: CallRecordSide;
    part_index: number;
    status: "PENDING" | "OK" | "FAILED";
    duration_seconds: number;
    provider: CallTranscriptProvider | null;
    purged: boolean;
  }[];
  gaps?: CallTranscriptGap[];
};

/** The card a chat reader sees for a posted call summary. Resolved on every
 *  thread read, so it shows the record as it stands rather than as it stood
 *  when the caller pressed send. */
export type CallCard = {
  call_id: string;
  summary_text: string;
  key_points: CallSummaryKeyPoint[];
  follow_ups: CallSummaryFollowUp[];
  language: "en" | "fr";
  provenance: CallProvenance;
  draft_status: "PENDING_REVIEW" | "SENT" | "DISCARDED";
  update_available: boolean;
  duration_seconds: number | null;
  ended_at: string | null;
  call_status: string;
  transcription_state: CallTranscriptState | null;
  transcription_error: string | null;
  caller_name: string | null;
  callee_name: string | null;
};

/** One recorded part of this side's audio. */
export const uploadCallPart = (
  callId: string,
  file: File,
  fields: {
    side: CallRecordSide;
    part_index: number;
    part_count: number;
    duration_ms?: number;
    language?: "en" | "fr";
  },
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
) =>
  uploadFile<unknown>(`/tenant/smartcomm/calls/${callId}/recording`, file, {
    field: "file",
    fields: { ...fields },
    onProgress,
    signal,
  });

/** This side has finished recording and made `parts` parts (0 is allowed). */
export const completeCallRecording = (callId: string, body: { side: CallRecordSide; parts: number }) =>
  tenant<{ call_id: string; side: CallRecordSide; parts: number; received: number }>(
    `/smartcomm/calls/${callId}/recording/complete`,
    { method: "POST", body },
  );
/** An admin runs a failed part through Groq, then Gemini, once more. */
export const rerunCallPart = (callId: string, side: CallRecordSide, part: number) =>
  tenant<{ call_id: string; side: CallRecordSide; part_index: number; status: string }>(
    `/smartcomm/calls/${callId}/recording/${side}/${part}/rerun`,
    { method: "POST" },
  );

export const getCallTranscript = (callId: string) =>
  tenant<CallTranscriptView>(`/smartcomm/calls/${callId}/transcript`);
export const getCallSummary = (callId: string) =>
  tenant<CallSummaryView>(`/smartcomm/calls/${callId}/summary`);
export const sendCallSummary = (
  callId: string,
  data: { summary_text?: string; key_points?: CallSummaryKeyPoint[]; follow_ups?: CallSummaryFollowUp[] },
) =>
  tenant<{ call_id: string; is_update: boolean; message_id: string }>(
    `/smartcomm/calls/${callId}/summary/send`,
    { method: "POST", body: data },
  );
export const discardCallSummary = (callId: string) =>
  tenant<{ call_id: string; draft_status: string }>(
    `/smartcomm/calls/${callId}/summary/discard`,
    { method: "POST" },
  );
/** The EN/FR toggle (§4.10). One language, and it is the whole request. */
export const regenerateCallSummary = (callId: string, language: "en" | "fr") =>
  tenant<{
    call_id: string;
    language: "en" | "fr";
    provenance: CallProvenance;
    summary: {
      summary_text: string;
      key_points: CallSummaryKeyPoint[];
      follow_ups: CallSummaryFollowUp[];
      draft_status: CallSummaryDraft["draft_status"];
    };
  }>(`/smartcomm/calls/${callId}/summary/regenerate`, { method: "POST", body: { language } });
/** Refreshed TURN credential mid-call (the one minted at dial expires with
 *  the call, plus margin). */
export const getCallTurn = (id: string) => tenant<IceConfig>(`/smartcomm/calls/${id}/turn`);

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
