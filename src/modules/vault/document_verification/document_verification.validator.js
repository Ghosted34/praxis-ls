"use strict";

const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

/**
 * The portal takes ONE input: the code printed on the document.
 *
 * What is gone from here matters more than what is left. This validator used
 * to accept `{ doc_id?, entity_ref?, hash }` with `hash: z.string().min(4)`,
 * and the service matched it with `stored.startsWith(hash)`. Four hex
 * characters is sixteen bits, on a public endpoint with no limiter — and
 * because the CALLER supplied the document to check, a "verified" answer said
 * nothing about the paper in their hand. There is no target parameter now: the
 * code identifies the signature, and only the printed document carries it.
 *
 * The shape check is deliberately loose (length and alphabet, in
 * services/signatures/tokens.js) and the service turns every failure into the
 * same 404 the never-existed case returns. A 422 here would tell a caller their
 * guess was WELL-FORMED but wrong, which is an oracle: the code space is 2^60,
 * and an oracle plus time is a working attack (§3.7).
 */
const params = z.object({
  // 12 characters plus up to three grouping separators, plus slack for a
  // visitor who typed spaces. Bounded so a megabyte of junk cannot reach the
  // normaliser.
  code: z.string().min(1).max(64),
});

const query = z.object({
  // How they arrived. Advisory telemetry, not a control — the service maps it
  // through a Map and defaults to QR, so an unknown value cannot reach the
  // CHECK-constrained column.
  via: z.enum(["QR", "CODE"]).optional(),
  lang: z.enum(["fr", "en"]).optional(),
});

const validate = (req, _res, next) => {
  const p = params.safeParse(req.params);
  if (!p.success) return next(new AppError("NOT_FOUND", "No verification matches that code.", 404));
  const q = query.safeParse(req.query);
  if (!q.success) return next(new AppError("VALIDATION_ERROR", "Invalid query", 422, q.error.flatten().fieldErrors));
  req.validatedParams = p.data;
  req.validatedQuery = q.data;
  return next();
};

module.exports = { validate, schemas: { params, query } };
