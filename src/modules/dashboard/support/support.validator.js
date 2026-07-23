/**
 * Zod validators for the tenant-side Support & Feedback API (PRD §11.2).
 */
"use strict";

const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const schemas = {
  create: z.object({
    kind: z.enum(["SUPPORT", "BUG", "FEATURE"]).default("SUPPORT"),
    title: z.string().trim().min(3).max(200),
    body: z.string().trim().max(5000).optional().default(""),
    // Free-form UI breadcrumb (hub/area/page/action/screenshot ref).
    context: z.record(z.any()).optional().default({}),
  }),
  csat: z.object({
    csat: z.number().int().min(1).max(5),
  }),
};

const validate = (schemaKey) => (req, _res, next) => {
  const parsed = schemas[schemaKey].safeParse(req.body);
  if (!parsed.success) {
    return next(
      new AppError("VALIDATION_ERROR", "Invalid request body", 422, parsed.error.flatten().fieldErrors),
    );
  }
  req.body = parsed.data;
  return next();
};

module.exports = { validate, schemas };
