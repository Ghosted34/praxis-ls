"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const create = z.object({
  label: z.string().min(1), // forklift, reach-stacker
  asset_id: z.string().uuid().optional(),
  status: z.enum(["AVAILABLE", "IN_USE", "MAINTENANCE", "OUT_OF_SERVICE"]).optional(),
  assigned_to: z.string().uuid().optional(),
  location_id: z.string().uuid().optional(),
});
const status = z.object({
  status: z.enum(["AVAILABLE", "IN_USE", "MAINTENANCE", "OUT_OF_SERVICE"]),
  assigned_to: z.string().uuid().nullable().optional(),
});
const schemas = { create, update: create.partial(), status };

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = { create: mw("create"), update: mw("update"), status: mw("status"), schemas };
