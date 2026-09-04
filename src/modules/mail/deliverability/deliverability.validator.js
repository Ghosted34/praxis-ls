"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const schema = z.object({
  domain: z.string().trim().min(3).max(255).optional(),
  smtp_host: z.string().trim().max(255).nullable().optional(),
}).strict();

const check = (req, _res, next) => {
  const p = schema.safeParse(req.body || {});
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

// `/deliverability/route` asks about ONE recipient domain, so unlike `/check`
// — where an absent domain means "sweep them all" — the domain is required.
const routeSchema = z.object({
  domain: z.string().trim().min(3).max(255),
}).strict();

const route = (req, _res, next) => {
  const p = routeSchema.safeParse(req.body || {});
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "A recipient domain is required", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = { check, route };
