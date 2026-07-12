"use strict";
const { z } = require("zod");
const { AppError } = require("../../utils/errors");
const attachment = z.object({ vault_id: z.string().uuid().optional().nullable(), filename: z.string().optional(), content_type: z.string().optional(), size_bytes: z.number().int().nonnegative().optional() });
const schemas = {
  channel: z.object({ name: z.string().min(1), kind: z.enum(["DEPARTMENT", "PROJECT", "DOSSIER", "DIRECT", "CLIENT"]).optional(), dossier_id: z.string().uuid().optional().nullable(), client_id: z.string().uuid().optional().nullable(), topic: z.string().optional(), member_ids: z.array(z.string().uuid()).optional() }),
  member: z.object({ user_id: z.string().uuid(), member_role: z.enum(["OWNER", "ADMIN", "MEMBER"]).optional() }),
  message: z.object({ body: z.string().optional(), media_vault_id: z.string().uuid().optional().nullable(), reply_to: z.string().uuid().optional().nullable(), attachments: z.array(attachment).optional() }),
  editMessage: z.object({ body: z.string().min(1) }),
  react: z.object({ emoji: z.string().min(1).max(16) }),
  draft: z.object({ body: z.string() }),
  quickReply: z.object({ label: z.string().min(1), body: z.string().min(1), shared: z.boolean().optional() }),
};
const mw = (k) => (req, _res, next) => { const p = schemas[k].safeParse(req.body); if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors)); req.body = p.data; return next(); };
module.exports = { channel: mw("channel"), member: mw("member"), message: mw("message"), editMessage: mw("editMessage"), react: mw("react"), draft: mw("draft"), quickReply: mw("quickReply"), schemas };
