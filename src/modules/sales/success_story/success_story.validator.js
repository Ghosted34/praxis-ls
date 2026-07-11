"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const schemas = {
  create: z.object({ title: z.string().min(1), dossier_id: z.string().uuid().optional().nullable(), summary: z.string().optional(), body: z.string().optional(), ai_generated: z.boolean().optional() }),
  update: z.object({ title: z.string().optional(), dossier_id: z.string().uuid().optional().nullable(), summary: z.string().optional(), body: z.string().optional() }),
};
const mw = (k) => (req, _res, next) => { const p = schemas[k].safeParse(req.body); if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors)); req.body = p.data; return next(); };
module.exports = { create: mw("create"), update: mw("update"), schemas };
