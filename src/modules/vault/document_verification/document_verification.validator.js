"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

// scan/verify take the QR payload as query params: a target (doc_id or
// entity_ref) plus the hash to check.
const query = z
  .object({
    doc_id: z.string().uuid().optional(),
    entity_ref: z.string().max(200).optional(),
    hash: z.string().min(4).max(128),
  })
  .refine((v) => v.doc_id || v.entity_ref, { message: "doc_id or entity_ref is required" });

const mw = (req, _res, next) => {
  const p = query.safeParse(req.query);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid query", 422, p.error.flatten().fieldErrors));
  req.validatedQuery = p.data;
  return next();
};

module.exports = { query: mw, schemas: { query } };
