"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const create = z.object({
  vehicle_id: z.string().uuid().optional(),
  wms_equipment_id: z.string().uuid().optional(),
  kind: z.enum(["PREVENTIVE", "CORRECTIVE"]),
  description: z.string().optional(),
  cost: z.number().nonnegative().optional(),
  dossier_id: z.string().uuid().optional(),
  opened_on: z.string().optional(),
});
const status = z.object({ status: z.enum(["OPEN", "IN_PROGRESS", "DONE", "CANCELLED"]) });
const schemas = { create, update: create.partial(), status };

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = { create: mw("create"), update: mw("update"), status: mw("status"), schemas };
