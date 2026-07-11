"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const create = z.object({
  vehicle_id: z.string().uuid(),
  odometer: z.number().int().nonnegative().optional(),
  litres: z.number().nonnegative().optional(),
  cost: z.number().nonnegative().optional(),
  dossier_id: z.string().uuid().optional(), // fuel posts to 6053 tagged to dossier (deferred)
});
const schemas = { create, update: create.partial() };

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = { create: mw("create"), update: mw("update"), schemas };
