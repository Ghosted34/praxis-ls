"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const raise = z.object({
  dossier_id: z.string().uuid(),
  milestone_instance_id: z.string().uuid().optional(),
  subject: z.string().min(1).max(200),
  body: z.string().max(4000).optional(),
  raised_by: z.string().max(160).optional(),
});
const reply = z.object({
  body: z.string().min(1).max(4000),
  // Staff-only: a client reply is flagged by the portal route, never the body.
  internal: z.boolean().optional(),
  evidence_vault_id: z.string().uuid().optional(),
});
const resolve = z.object({}).passthrough();

const schemas = { raise, reply, resolve };
const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data; return next();
};
module.exports = { raise: mw("raise"), reply: mw("reply"), resolve: mw("resolve"), schemas };
