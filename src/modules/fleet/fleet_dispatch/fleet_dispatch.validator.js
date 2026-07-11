"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const create = z.object({
  vehicle_id: z.string().uuid(),
  driver_employee_id: z.string().uuid().optional(),
  dossier_id: z.string().uuid().optional(),
  odometer_out: z.number().int().nonnegative().optional(),
  odometer_in: z.number().int().nonnegative().optional(),
});
const status = z.object({
  status: z.enum(["ASSIGNED", "OUT", "RETURNED", "CANCELLED"]),
  odometer: z.number().int().nonnegative().optional(),
});
const schemas = { create, update: create.partial(), status };

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = { create: mw("create"), update: mw("update"), status: mw("status"), schemas };
