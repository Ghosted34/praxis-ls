"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const d = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const schemas = {
  create: z.object({ name: z.string().min(1), channel: z.string().optional(), starts_on: d.optional().nullable(), ends_on: d.optional().nullable(), assets: z.record(z.any()).optional() }),
  transition: z.object({ to: z.enum(["ACTIVE", "PAUSED", "ENDED"]) }),
  subscribe: z.object({ email: z.string().email(), name: z.string().optional(), source: z.string().optional() }),
  unsubscribe: z.object({ email: z.string().email() }),
};
const mw = (k) => (req, _res, next) => { const p = schemas[k].safeParse(req.body); if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors)); req.body = p.data; return next(); };
module.exports = { create: mw("create"), transition: mw("transition"), subscribe: mw("subscribe"), unsubscribe: mw("unsubscribe"), schemas };
