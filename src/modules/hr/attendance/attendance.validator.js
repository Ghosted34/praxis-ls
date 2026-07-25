"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);

const create = z.object({
  employee_id: z.string().uuid().optional(),
  clock_in_at: z.string().optional(),
  clock_out_at: z.string().optional(),
  location: z.record(z.any()).optional(),
});

const clockIn = z.object({
  employee_id: z.string().uuid().optional(), // omitted = self (from the auth'd user)
  latitude: lat.optional(),
  longitude: lng.optional(),
  accuracy: z.number().nonnegative().optional(),
});

const clockOut = z.object({
  id: z.string().uuid().optional(), // omitted = the caller's open shift
  employee_id: z.string().uuid().optional(),
  latitude: lat.optional(),
  longitude: lng.optional(),
});

const workSite = z.object({
  name: z.string().min(1),
  latitude: lat,
  longitude: lng,
  radius_m: z.coerce.number().int().positive().max(50000).optional(),
  entity_id: z.string().uuid().optional().nullable(),
  is_active: z.boolean().optional(),
});

const schemas = { create, update: create.partial(), clockIn, clockOut, workSite, workSiteUpdate: workSite.partial() };

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = {
  create: mw("create"),
  update: mw("update"),
  clockIn: mw("clockIn"),
  clockOut: mw("clockOut"),
  workSite: mw("workSite"),
  workSiteUpdate: mw("workSiteUpdate"),
  schemas,
};
