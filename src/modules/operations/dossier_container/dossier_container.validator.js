"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

/**
 * A container number as ISO 6346 writes it — four letters then seven digits
 * (MSKU1234567). Accepted loosely (case and spacing are normalised by the
 * service) but rejected when it is plainly not one, because a mistyped number
 * is worth catching at the point of entry: it is the key everything charged per
 * box is matched on.
 *
 * Optional, always. A line that only knows "3 × 40' HC" is complete and normal
 * — the numbers arrive with the Bill of Lading, days later.
 */
const CONTAINER_NO = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase().replace(/\s+/g, ""))
  .refine((s) => /^[A-Z]{4}\d{6,7}$/.test(s), {
    message: "a container number looks like MSKU1234567 (4 letters, 7 digits)",
  });

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be a date (YYYY-MM-DD)");

const unit = z.object({
  container_no: CONTAINER_NO.nullable().optional(),
  seal_no: z.string().trim().max(40).nullable().optional(),
  tare_kg: z.number().nonnegative().nullable().optional(),
  gross_weight_kg: z.number().nonnegative().nullable().optional(),
  temperature_c: z.number().nullable().optional(),
  imdg_class: z.string().trim().max(10).nullable().optional(),
  discharged_on: DATE.nullable().optional(),
  out_of_port_on: DATE.nullable().optional(),
  returned_on: DATE.nullable().optional(),
  notes: z.string().max(400).nullable().optional(),
});

const line = z.object({
  seq: z.number().int().optional(),
  container_type_ref_id: z.string().uuid(),
  load_mode_ref_id: z.string().uuid().nullable().optional(),
  // A quantity of zero is a line that should have been deleted; the cap is a
  // typo guard, not a business limit — no single file moves 1000 boxes.
  qty: z.number().int().positive().max(1000),
  gross_weight_kg: z.number().nonnegative().nullable().optional(),
  volume_cbm: z.number().nonnegative().nullable().optional(),
  notes: z.string().max(400).nullable().optional(),
  units: z.array(unit).max(1000).optional(),
});

/** The whole collection, replaced in one call. An empty array is legitimate and
 *  means "this file has no containers" — it is how the last row is removed. */
const replace = z.object({ lines: z.array(line).max(200) });

const schemas = { replace };
const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = { replace: mw("replace"), schemas };
