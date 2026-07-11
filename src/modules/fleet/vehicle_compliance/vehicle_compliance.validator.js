"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const create = z.object({
  vehicle_id: z.string().uuid(),
  kind: z.enum(["insurance", "visite_technique"]),
  expires_on: z.string().optional(), // ISO date — alert engine fires before lapse
  document_vault_id: z.string().uuid().optional(),
});
const schemas = { create, update: create.partial() };

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = { create: mw("create"), update: mw("update"), schemas };
