"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const schemas = {
  create: z.object({ subject: z.string().min(1), lead_id: z.string().uuid().optional().nullable(), client_id: z.string().uuid().optional().nullable(), scheduled_at: z.string().optional().nullable(), organiser_id: z.string().uuid().optional().nullable(), transcript_vault_id: z.string().uuid().optional().nullable() }),
  note: z.object({ body: z.string().min(1), is_minutes: z.boolean().optional() }),
};
const mw = (k) => (req, _res, next) => { const p = schemas[k].safeParse(req.body); if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors)); req.body = p.data; return next(); };
module.exports = { create: mw("create"), note: mw("note"), schemas };
