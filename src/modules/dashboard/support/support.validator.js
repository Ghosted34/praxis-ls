/**
 * Zod validators for the tenant-side Support & Feedback API (PRD §11.2).
 *
 * Kinds (0105) — nine, matching the platform.support_ticket CHECK exactly.
 * This list and that constraint are the two copies that MUST agree; a kind
 * accepted here but refused by the DB is a 500 with a constraint name, and a
 * kind the DB accepts but this list refuses is a dead dropdown option.
 */
"use strict";

const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const KINDS = ["SUPPORT", "BUG", "FEATURE", "BILLING", "SECURITY", "DATA", "COMMS", "URGENT", "REQUEST"];

const attachmentIds = z
  .array(z.string().uuid())
  .max(5)
  .optional()
  .default([]);

const schemas = {
  create: z.object({
    kind: z.enum(KINDS).default("SUPPORT"),
    title: z.string().trim().min(3).max(200),
    body: z.string().trim().max(5000).optional().default(""),
    // Free-form UI breadcrumb (hub/area/page/action/screenshot ref).
    context: z.record(z.any()).optional().default({}),
    // Pre-uploaded screenshot ids (POST /support/attachments) — linked, not
    // moved: the upload already happened on its own request.
    attachment_ids: attachmentIds,
  }),
  reply: z.object({
    body: z.string().trim().min(1).max(5000),
    attachment_ids: attachmentIds,
    // Deliberately NO internal flag: a tenant cannot mark a message
    // "internal". The flag does not exist on this side of the wire.
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

module.exports = { validate, schemas, KINDS };
