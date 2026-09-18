"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const create = z.object({
  employee_id: z.string().uuid(),
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(5000),
  severity: z.enum(["INFO", "WARNING", "SERIOUS"]).optional(),
  due_at: z.string().optional().nullable(),
});
const respond = z.object({ response: z.string().min(1).max(5000) });
const update = create.partial();
// AI-facing: the record id travels IN the payload — the copilot has no route param.
const aiUpdate = update.extend({ hr_query_id: z.string().uuid() });
const schemas = { create, update, respond, aiUpdate };

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = { create: mw("create"), update: mw("update"), respond: mw("respond"), schemas };
