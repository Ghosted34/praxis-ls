"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const create = z.object({
  title: z.string().min(1),
  scheduled_on: z.string().optional(),
  facilitator: z.string().optional(),
  status: z.enum(["SCHEDULED", "DONE", "CANCELLED"]).optional(),
});
const status = z.object({ status: z.enum(["SCHEDULED", "DONE", "CANCELLED"]) });
const attendee = z.object({
  employee_id: z.string().uuid().optional(),
  attended: z.boolean().optional(),
  certificate_vault_id: z.string().uuid().optional(),
});
const schemas = { create, update: create.partial(), status, attendee, attendeeUpdate: attendee.partial() };

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = {
  create: mw("create"),
  update: mw("update"),
  status: mw("status"),
  attendee: mw("attendee"),
  attendeeUpdate: mw("attendeeUpdate"),
  schemas,
};
