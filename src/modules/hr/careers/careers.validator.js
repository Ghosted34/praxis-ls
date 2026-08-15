"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

/**
 * The one form on this product a stranger can post to.
 *
 * Every field is bounded. Not as ceremony: an unauthenticated endpoint with an
 * unbounded text field is free storage for anybody who finds it, and the
 * covering note in particular is the obvious candidate. The limits below are
 * generous for a real application and useless for anything else.
 */
const apply = z.object({
  full_name: z.string().trim().min(2).max(160),
  // Required here though optional on the admin form — a recruiter adding
  // somebody they met has other ways to reach them; a stranger who applies
  // with no way to be contacted has not applied.
  email: z.string().email().max(200),
  phone: z.string().trim().max(40).optional(),
  address: z.string().trim().max(300).optional(),
  skills: z.array(z.string().trim().min(1).max(80)).max(30)
    .transform((a) => [...new Set(a.map((s) => s.trim()).filter(Boolean))])
    .optional(),
  experience_years: z.coerce.number().min(0).max(70).optional(),
  expected_salary: z.coerce.number().nonnegative().max(1e12).optional(),
  portfolio_url: z.string().url().max(500).optional(),
  cover_note: z.string().max(5000).optional(),
  // ~11 MB of base64 for an 8 MB file. Checked again on the decoded bytes in
  // document_vault.createDocument — this is the cheap outer bound that stops a
  // 200 MB string being base64-decoded into memory before anything looks at it.
  cv_data_url: z.string().max(12_000_000).optional(),
  cv_filename: z.string().max(200).optional(),
});

const schemas = { apply };

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Please check the form", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = { apply: mw("apply"), schemas };
