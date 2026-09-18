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

// AI-facing: the raw shapes, so deliverability.ai.js can declare payload
// schemas. `history` takes its domain in the URL over HTTP; a copilot call has
// no URL, so it carries the domain in the payload like the other two.
const schemas = { check: schema, route: routeSchema, aiHistory: routeSchema };

module.exports = { check, route, schemas };
