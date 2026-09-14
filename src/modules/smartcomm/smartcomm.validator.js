"use strict";
const { z } = require("zod");
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
  attachment_kind: z.enum(["VAULT", "MEDIA", "ERP"]).optional(),
  vault_id: z.string().uuid().optional().nullable(),
  media_id: z.string().uuid().optional().nullable(),
  erp_kind: z.enum(["INVOICE", "DOSSIER", "CLIENT", "PURCHASE_ORDER", "SUPPLIER_INVOICE"]).optional().nullable(),
  erp_id: z.string().uuid().optional().nullable(),
  // The fallback caption only. Bounded because it is stored verbatim and
  // rendered to every member who cannot resolve the record.
  erp_label: z.string().max(120).optional().nullable(),
  filename: z.string().max(255).optional().nullable(),
  content_type: z.string().max(128).optional().nullable(),
  size_bytes: z.number().int().nonnegative().optional().nullable(),
  // Echoed back by the composer so `attachmentSummary` can name the format in
  // the notification; nothing is stored from them.
  kind: z.enum(["IMAGE", "AUDIO", "VIDEO"]).optional().nullable(),
  is_voice_note: z.boolean().optional(),
}).passthrough();
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
  message: z.object({ body: z.string().optional(), media_vault_id: z.string().uuid().optional().nullable(), reply_to: z.string().uuid().optional().nullable(), attachments: z.array(attachment).optional() }),
  scheduled: z.object({ request_id: z.string().uuid(), body: z.string().max(10000).default(""), attachments: z.array(attachment.strip()).max(20).default([]), reply_to: z.string().uuid().nullable().optional(), send_at: z.string().datetime({ offset: true }), timezone: z.string().min(1).max(100) }).strict(),
  reschedule: z.object({ send_at: z.string().datetime({ offset: true }), timezone: z.string().min(1).max(100) }).strict(),
  editMessage: z.object({ body: z.string().min(1) }),
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
  quickReply: z.object({ label: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(10000) }).strict(),
  // API F-15: PATCH /quick-replies/:id reused the CREATE guard, which requires
  // both label and body — so a caller editing only the label had to resend the
  // body, and the route as mounted (`create`) was the RBAC gate, not a
  // validator, so the patch body was never checked at all.
  quickReplyPatch: z.object({ label: z.string().trim().min(1).max(120).optional(), body: z.string().trim().min(1).max(10000).optional() }).strict(),
  whatsappConfig: z.object({ phone_id: z.string().min(1).optional(), api_version: z.string().min(1).optional(), token: z.string().min(1).max(4000).optional() }),
  emailConfig: z.object({ smtp_host: z.string().min(1).optional(), smtp_port: z.coerce.number().int().positive().optional(), smtp_user: z.string().optional(), smtp_pass: z.string().min(1).max(4000).optional(), from: z.string().optional(), reply_to: z.string().optional() }),
};
const mw = (k) => (req, _res, next) => { const p = schemas[k].safeParse(req.body); if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors)); req.body = p.data; return next(); };
module.exports = { scheduled: mw("scheduled"), reschedule: mw("reschedule"), mediaUpload: mw("mediaUpload"), promote: mw("promote"), channel: mw("channel"), member: mw("member"), message: mw("message"), editMessage: mw("editMessage"), react: mw("react"), draft: mw("draft"), quickReply: mw("quickReply"), flag: mw("flag"), emailTest: mw("emailTest"), emailDnsCheck: mw("emailDnsCheck"), emailTestSend: mw("emailTestSend"), quickReplyPatch: mw("quickReplyPatch"), whatsappConfig: mw("whatsappConfig"), emailConfig: mw("emailConfig"), schemas };
