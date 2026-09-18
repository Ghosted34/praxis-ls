"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const create = z.object({
  vehicle_id: z.string().uuid().optional(),
  driver_employee_id: z.string().uuid().optional(),
  occurred_at: z.string().optional(),
  description: z.string().optional(),
  severity: z.enum(["MINOR", "MAJOR", "TOTAL"]).optional(),
});
const status = z.object({ status: z.enum(["OPEN", "UNDER_REVIEW", "CLOSED"]) });
const update = create.partial();
// AI-facing: the record id travels IN the payload — the copilot has no route param.
const aiUpdate = update.extend({ fleet_incident_id: z.string().uuid() });
const aiStatus = status.extend({ fleet_incident_id: z.string().uuid() });
const schemas = { create, update, status, aiUpdate, aiStatus };

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = { create: mw("create"), update: mw("update"), status: mw("status"), schemas };
