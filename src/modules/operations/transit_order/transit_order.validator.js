"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const schemas = {
  create: z.object({ entity_id: z.string().uuid(), dossier_id: z.string().uuid().optional().nullable(), customs_regime: z.enum(["IM4", "IM7", "IM8", "EX1", "EX2"]).optional().nullable(), service_direction: z.string().optional(), declared_value: z.number().nonnegative().optional().nullable(), submitted_docs: z.array(z.any()).optional(), lines: z.array(z.object({ label: z.string().min(1), packages: z.number().nonnegative().optional(), weight: z.string().optional() })).optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
  update: z.object({ submitted_docs: z.array(z.any()) }),
};
const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data; return next();
};
module.exports = { create: mw("create"), update: mw("update"), schemas };
