"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const create = z.object({
  role_title: z.string().min(1),
  incumbent_id: z.string().uuid().optional(),
  successor_id: z.string().uuid().optional(),
  readiness: z.string().optional(),
  notes: z.string().optional(),
});
const schemas = { create, update: create.partial() };

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = { create: mw("create"), update: mw("update"), schemas };
