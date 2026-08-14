"use strict";
const { z } = require("zod");
const { AppError } = require("../../utils/errors");
const attachment = z.object({ vault_id: z.string().uuid().optional().nullable(), filename: z.string().optional(), content_type: z.string().optional(), size_bytes: z.number().int().nonnegative().optional() });
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
  editMessage: z.object({ body: z.string().min(1) }),
  react: z.object({ emoji: z.string().min(1).max(16) }),
  draft: z.object({ body: z.string() }),
  quickReply: z.object({ label: z.string().min(1), body: z.string().min(1), shared: z.boolean().optional() }),
  // API F-15: PATCH /quick-replies/:id reused the CREATE guard, which requires
  // both label and body — so a caller editing only the label had to resend the
  // body, and the route as mounted (`create`) was the RBAC gate, not a
  // validator, so the patch body was never checked at all.
  quickReplyPatch: z.object({ label: z.string().min(1).optional(), body: z.string().min(1).optional(), shared: z.boolean().optional() }).strict(),
  whatsappConfig: z.object({ phone_id: z.string().min(1).optional(), api_version: z.string().min(1).optional(), token: z.string().min(1).max(4000).optional() }),
  emailConfig: z.object({ smtp_host: z.string().min(1).optional(), smtp_port: z.coerce.number().int().positive().optional(), smtp_user: z.string().optional(), smtp_pass: z.string().min(1).max(4000).optional(), from: z.string().optional(), reply_to: z.string().optional() }),
};
const mw = (k) => (req, _res, next) => { const p = schemas[k].safeParse(req.body); if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors)); req.body = p.data; return next(); };
module.exports = { channel: mw("channel"), member: mw("member"), message: mw("message"), editMessage: mw("editMessage"), react: mw("react"), draft: mw("draft"), quickReply: mw("quickReply"), flag: mw("flag"), emailTest: mw("emailTest"), emailDnsCheck: mw("emailDnsCheck"), emailTestSend: mw("emailTestSend"), quickReplyPatch: mw("quickReplyPatch"), whatsappConfig: mw("whatsappConfig"), emailConfig: mw("emailConfig"), schemas };
