"use strict";
const { z } = require("zod");
// The summary's limits come from the shared contract (§4.10) rather than being
// restated here: the caller's screen validates an edit with the same schema, and
// two copies of "1200 characters" is how a draft the client accepts gets a 422.
const { callSummary } = require("@praxis/shared");
const { AppError } = require("../../utils/errors");
/**
 * A posted attachment descriptor.
 *
 * This is what the client sends BACK after `POST /channels/:id/media` handed it
 * one — so every field here has already been decided by the server once. It is
 * still validated, and the service still re-normalises which pointer column a
 * kind may write (`attachmentRow`), because "the client is echoing our own
 * response" describes the honest path and not the only one.
 *
 * `attachment_kind` is optional and defaults to VAULT in the service: every row
 * written before migration 13794 is a vault row, and an older client that has
 * not learned the field must keep working.
 */
const attachment = z.object({
  attachment_kind: z.enum(["VAULT", "MEDIA", "ERP", "CALL"]).optional(),
  vault_id: z.string().uuid().optional().nullable(),
  media_id: z.string().uuid().optional().nullable(),
  erp_kind: z.enum(["INVOICE", "DOSSIER", "CLIENT", "PURCHASE_ORDER", "SUPPLIER_INVOICE"]).optional().nullable(),
  erp_id: z.string().uuid().optional().nullable(),
  // The fallback caption only. Bounded because it is stored verbatim and
  // rendered to every member who cannot resolve the record.
  erp_label: z.string().max(120).optional().nullable(),
  // A call summary card (PR-2). The message carries only the pointer; the card
  // (summary, key points, follow-ups, transcript link) resolves at read time.
  call_id: z.string().uuid().optional().nullable(),
  filename: z.string().max(255).optional().nullable(),
  content_type: z.string().max(128).optional().nullable(),
  size_bytes: z.number().int().nonnegative().optional().nullable(),
  // Echoed back by the composer so `attachmentSummary` can name the format in
  // the notification; nothing is stored from them.
  kind: z.enum(["IMAGE", "AUDIO", "VIDEO"]).optional().nullable(),
  is_voice_note: z.boolean().optional(),
}).passthrough();
/**
 * An attachment a PERSON may post (audit C4). A CALL card resolves a call's
 * summary for everyone in the channel, so only `sendSummary` writes one; a
 * client naming another pair's call id here would surface their summary.
 */
const notCall = (a) => a.attachment_kind !== "CALL";
const NOT_CALL = { message: "Call summaries are shared from the call, not attached", path: ["attachment_kind"] };
const postedAttachment = attachment.refine(notCall, NOT_CALL);
const scheduledAttachment = attachment.strip().refine(notCall, NOT_CALL);
const schemas = {
  // SEC H3 guard. Four write routes reached their handler with an unvalidated
  // body. The three toggles read `req.body.x === true`, so an absent or
  // misspelled key silently means FALSE — POST /channels/:id/pin with
  // {"pined": true} quietly UNPINS. .strict() plus a required boolean turns
  // that into a 422.
  flag: z.object({ archived: z.boolean().optional(), pinned: z.boolean().optional(), muted: z.boolean().optional() })
    .strict()
    .refine((o) => Object.keys(o).length === 1, "send exactly one of archived, pinned, muted"),
  // The "Test" button on the shared SMTP login checks the generic transport, so
  // it sends no body. purpose is optional here (the service defaults it to
  // NOTIFICATIONS in verifyTransport) — requiring it 422'd every connectivity
  // test with "purpose: Required".
  emailTest: z.object({ purpose: z.string().trim().min(1).max(64).optional() }).strict(),
  // Mail-setup wizard. The domain is the From address's domain; the send target
  // is any address the admin wants the test message delivered to.
  emailDnsCheck: z.object({ domain: z.string().trim().min(4).max(253).regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i, "not a domain name") }).strict(),
  emailTestSend: z.object({ to: z.string().trim().email().max(254), purpose: z.string().trim().min(1).max(64).optional() }).strict(),
  channel: z.object({ name: z.string().min(1), kind: z.enum(["DEPARTMENT", "PROJECT", "DOSSIER", "DIRECT", "CLIENT"]).optional(), dossier_id: z.string().uuid().optional().nullable(), client_id: z.string().uuid().optional().nullable(), topic: z.string().optional(), member_ids: z.array(z.string().uuid()).optional() }),
  member: z.object({ user_id: z.string().uuid(), member_role: z.enum(["OWNER", "ADMIN", "MEMBER"]).optional() }),
  message: z.object({ body: z.string().optional(), media_vault_id: z.string().uuid().optional().nullable(), reply_to: z.string().uuid().optional().nullable(), attachments: z.array(postedAttachment).optional() }),
  scheduled: z.object({ request_id: z.string().uuid(), body: z.string().max(10000).default(""), attachments: z.array(scheduledAttachment).max(20).default([]), reply_to: z.string().uuid().nullable().optional(), send_at: z.string().datetime({ offset: true }), timezone: z.string().min(1).max(100) }).strict(),
  reschedule: z.object({ send_at: z.string().datetime({ offset: true }), timezone: z.string().min(1).max(100) }).strict(),
  // An edit changes the words only; attachments are never edited (C4).
  editMessage: z.object({ body: z.string().min(1) }).strict(),
  react: z.object({ emoji: z.string().min(1).max(16) }),
  draft: z.object({ body: z.string() }),
  /**
   * The metadata riding alongside a media upload.
   *
   * Every value is a STRING here and coerced, because this body arrives as
   * multipart form fields — a form field cannot carry a number or a boolean,
   * and a schema that demanded one would reject every real upload while
   * passing every test that posted JSON.
   *
   * `waveform` is the same story one level down: a form field carries it as a
   * JSON STRING, and a JSON body carries it as an array. Both are accepted and
   * normalised to an array here, so the controller reads one shape. Capped at
   * 64 peaks — the player draws a fixed number of bars, and an unbounded array
   * is a row that slows every later thread read.
   *
   * A waveform that will not parse is dropped rather than refused: peaks are
   * decoration, and refusing the upload would lose the recording over a bar
   * chart.
   */
  mediaUpload: z.object({
    is_voice_note: z.union([z.boolean(), z.enum(["true", "false"])]).optional(),
    duration_ms: z.coerce.number().int().nonnegative().max(3_600_000).optional().nullable(),
    width: z.coerce.number().int().positive().max(100_000).optional().nullable(),
    height: z.coerce.number().int().positive().max(100_000).optional().nullable(),
    waveform: z.preprocess((v) => {
      if (typeof v !== "string") return v;
      try { return JSON.parse(v); } catch { return undefined; }
    }, z.array(z.coerce.number()).max(64).optional().nullable()),
  }).passthrough(),
  /** "Save to vault" — both fields optional; the service defaults the doc type
   *  and files it against the channel. */
  promote: z.object({
    doc_type: z.string().min(1).max(64).optional(),
    entity_ref: z.string().min(1).max(128).optional(),
  }).strict(),
  /**
   * "Transcribe this one" — the language hint, and nothing else.
   *
   * An enum rather than a free string: it is forwarded to the tenant's
   * transcription vendor, and `.strict()` with two values is the difference
   * between a hint and an open field going out of the building. Optional
   * because a reader who has not chosen leaves the provider to detect it,
   * which is the honest default when nobody said.
   */
  transcribe: z.object({ language: z.enum(["en", "fr"]).optional() }).strict(),
  /**
   * "Preview this link while I am still typing" — one URL, and the shape check
   * is deliberately NOT a security claim.
   *
   * A zod `url()` would accept `javascript:alert(1)//`, which the fetch guard
   * rejects later for its own reasons; the length bound here is the only thing
   * this schema is actually for (a 10 MB "URL" would otherwise be read into a
   * string and hashed before anything said no). Protocol, host, port, address
   * class and redirect chain are all decided in `shared/net/link-target.js`, in
   * ONE place, because the same rules must also apply to a URL that arrives in a
   * message body and was never through this route at all. A per-endpoint URL
   * check is how you get an unfurler that is safe on one path and not on the
   * other.
   */
  linkPreview: z.object({ url: z.string().trim().min(8).max(2048) }).strict(),
  quickReply: z.object({ label: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(10000) }).strict(),
  // API F-15: PATCH /quick-replies/:id reused the CREATE guard, which requires
  // both label and body — so a caller editing only the label had to resend the
  // body, and the route as mounted (`create`) was the RBAC gate, not a
  // validator, so the patch body was never checked at all.
  quickReplyPatch: z.object({ label: z.string().trim().min(1).max(120).optional(), body: z.string().trim().min(1).max(10000).optional() }).strict(),
  whatsappConfig: z.object({ phone_id: z.string().min(1).optional(), api_version: z.string().min(1).optional(), token: z.string().min(1).max(4000).optional() }),
  emailConfig: z.object({ smtp_host: z.string().min(1).optional(), smtp_port: z.coerce.number().int().positive().optional(), smtp_user: z.string().optional(), smtp_pass: z.string().min(1).max(4000).optional(), from: z.string().optional(), reply_to: z.string().optional() }),
  /**
   * 1:1 call transitions (PR-1). The dial names a channel — the DIRECT
   * conversation the icon sits on — never a person, so the callee is resolved
   * server-side and there is no user id to spoof.
   */
  callCreate: z.object({ group_id: z.string().uuid() }).strict(),
  // Clients built before PR-3 send a `reason`; it is accepted and ignored
  // (audit B9: the server decides how a call ended).
  callHangup: z.object({ reason: z.string().max(32).optional() }).strict(),
  // PR-6 (audit G5): `record: false` answers without recording. Absent means
  // record as the tenant has it; a client from before PR-6 sends no body.
  callAccept: z.object({ record: z.boolean().optional() }).strict(),
  // PR-6 (audit G3): whose call records to erase.
  callEraseUser: z.object({ user_id: z.string().uuid() }).strict(),
  // A test ring goes to one of the caller's OWN subscriptions, named by its
  // push endpoint (the service looks it up under the caller's user id).
  callTestRing: z.object({ endpoint: z.string().url().max(2048) }).strict(),
  // Comms → Setup → Test calls (PR-7, O5).
  diagStart: z.object({ app_version: z.string().max(60).optional() }).strict(),
  diagSignal: z.object({ nonce: z.string().min(8).max(64) }).strict(),
  diagRing: z.object({ endpoint: z.string().url().max(2048) }).strict(),
  diagStep: z.object({
    status: z.enum(["pass", "warn", "fail", "skipped"]),
    ms: z.number().min(0).max(600000).nullable().optional(),
    code: z.string().max(40).regex(/^[A-Z0-9_]+$/).nullable().optional(),
    cause: z.string().max(500).nullable().optional(),
    fix: z.string().max(500).nullable().optional(),
    // Measurements only (levels, timings, RTT/jitter/loss, device labels
    // are not sent): bounded so a report cannot carry a payload.
    detail: z.record(z.string().max(40), z.union([z.string().max(200), z.number(), z.boolean(), z.null()]))
      .refine((d) => Object.keys(d).length <= 20, { message: "at most 20 details" })
      .optional(),
  }).strict(),
  diagPart: z.object({ part_index: z.coerce.number().int().min(1).max(3) }).strip(),

  /**
   * The record half (PR-2, guide §6.2).
   *
   * `recording` is the multipart body that rides with one recorded PART. The
   * numbers arrive as strings through multipart (see `mediaUpload` above for
   * the same lesson), so they are coerced; `side` is checked against the
   * caller's own side in the SERVICE, because `.strict()` here cannot know who
   * is uploading — a validator that guessed would be the second place the rule
   * lives.
   *
   * A `live_segments` field from a client built before PR-1 is passed
   * through unread; the browser capture is retired.
   *
   * `language` is the uploading side's app language. Only the CALLER's is used
   * — it is the language the summary is drafted in (§4.10) — and it is an enum
   * because an unchecked string would become the language of a business record.
   */
  callRecording: z.object({
    side: z.enum(["caller", "callee"]),
    part_index: z.coerce.number().int().min(1).max(60),
    part_count: z.coerce.number().int().min(1).max(60),
    // A part is cut at 120 s; 125 s allows for a throttled background timer
    // and matches the repo's bound (audit B11).
    duration_ms: z.coerce.number().int().min(0).max(125_000).optional(),
    language: z.enum(["en", "fr"]).optional(),
  }).passthrough(),
  /** A side has finished recording: how many parts it made (audit A2). Zero
   *  is a real answer (a device whose recorder could not start). */
  callRecordingComplete: z.object({
    side: z.enum(["caller", "callee"]),
    parts: z.number().int().min(0).max(60),
  }).strict(),
  /**
   * The caller's SEND, carrying their own edit of the draft.
   *
   * Shape only at this layer (the counts and lengths), with the SEMANTIC rules
   * — the verbatim/language contract of §4.10 — applied in the service through
   * the shared `@praxis/shared` schema, so the API and the caller's editor
   * cannot disagree about what a legal draft is.
   */
  callSummarySend: z.object({
    summary_text: z.string().trim().min(1).max(callSummary.LIMITS.summaryMax).optional(),
    key_points: z.array(z.object({
      text: z.string().trim().min(1).max(callSummary.LIMITS.textMax),
      raised_by: z.enum(["caller", "callee"]),
    })).max(callSummary.LIMITS.pointsMax).optional(),
    follow_ups: z.array(z.object({
      text: z.string().trim().min(1).max(callSummary.LIMITS.textMax),
      owner: z.enum(["caller", "callee"]),
      due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    })).max(callSummary.LIMITS.followUpsMax).optional(),
  }).strict(),
  /** The EN/FR toggle (§4.10). One value, and it is the whole request. */
  callSummaryRegenerate: z.object({ language: z.enum(["en", "fr"]) }).strict(),
};
const mw = (k) => (req, _res, next) => { const p = schemas[k].safeParse(req.body); if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors)); req.body = p.data; return next(); };
module.exports = { transcribe: mw("transcribe"), callRecording: mw("callRecording"), callRecordingComplete: mw("callRecordingComplete"), callSummarySend: mw("callSummarySend"), callSummaryRegenerate: mw("callSummaryRegenerate"), linkPreview: mw("linkPreview"), scheduled: mw("scheduled"), reschedule: mw("reschedule"), mediaUpload: mw("mediaUpload"), promote: mw("promote"), channel: mw("channel"), member: mw("member"), message: mw("message"), editMessage: mw("editMessage"), react: mw("react"), draft: mw("draft"), quickReply: mw("quickReply"), flag: mw("flag"), emailTest: mw("emailTest"), emailDnsCheck: mw("emailDnsCheck"), emailTestSend: mw("emailTestSend"), quickReplyPatch: mw("quickReplyPatch"), whatsappConfig: mw("whatsappConfig"), emailConfig: mw("emailConfig"), callCreate: mw("callCreate"), callHangup: mw("callHangup"), callAccept: mw("callAccept"), callEraseUser: mw("callEraseUser"), callTestRing: mw("callTestRing"), diagStart: mw("diagStart"), diagSignal: mw("diagSignal"), diagRing: mw("diagRing"), diagStep: mw("diagStep"), diagPart: mw("diagPart"), schemas };
