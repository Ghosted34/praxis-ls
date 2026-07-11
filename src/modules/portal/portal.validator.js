"use strict";
const { z } = require("zod");
const { AppError } = require("../../utils/errors");
const schemas = {
  grant: z.object({ portal: z.enum(["CLIENT", "INVESTOR", "AUDITOR"]), subject_email: z.string().email(), client_id: z.string().uuid().optional().nullable(), expires_at: z.string().optional().nullable() }),
};
const mw = (k) => (req, _res, next) => { const p = schemas[k].safeParse(req.body); if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors)); req.body = p.data; return next(); };
module.exports = { grant: mw("grant"), schemas };
