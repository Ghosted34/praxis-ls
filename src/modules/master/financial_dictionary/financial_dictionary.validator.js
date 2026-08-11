"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const rule = z.object({
  applies_context: z.enum(["sale", "purchase", "disbursement"]),
  debit_account: z.string().nullish(),
  credit_account: z.string().nullish(),
  tax_code_id: z.string().uuid().nullish(),
  is_disbursement: z.boolean().optional(),
});

const tier = z.object({
  service_type_id: z.string().uuid(),
  service_key: z.string().nullish(),
  tier: z.enum(["BASIC", "ADVANCED", "FULL"]).default("BASIC"),
  sort_order: z.number().int().optional(),
});

// `code` is minted server-side from the direction — never accepted from the client.
const create = z.object({
  label_fr: z.string().min(1),
  label_en: z.string().nullish(),
  description: z.string().nullish(),
  category: z.enum(["disbursement", "service", "overhead", "asset", "other"]),
  direction: z.enum(["REVENUE", "EXPENSE", "DISBURSEMENT", "ASSET"]),
  subcategory: z.string().nullish(),
  unit_of_measure: z.string().nullish(),
  applicability_mode: z.enum(["SERVICE_SCOPED", "ANY_OPERATIONS", "NON_OPERATIONAL"]).optional(),
  is_disbursement: z.boolean().optional(),
  is_billable: z.boolean().optional(),
  default_price: z.number().nonnegative().nullish(),
  currency: z.string().length(3).optional(),
  shipping_line: z.string().nullish(),
  provider_kind: z.enum(["SHIPPING_LINE", "CUSTOMS_AUTHORITY", "PORT_TERMINAL", "OTHER"]).nullish(),
  proof_source: z.string().nullish(),
  requires_justification: z.boolean().optional(),
  receipt_requirement: z.enum(["ALWAYS_REQUIRED", "CONDITIONALLY_REQUIRED", "NOT_REQUIRED"]).optional(),
  disbursement_vat_transparent: z.boolean().optional(),
  // FORMULA = priced by the Extra Charges Simulation module (Demurrage,
  // Storage), not by a flat rate card. Defaults to FLAT server-side.
  pricing_mode: z.enum(["FLAT", "FORMULA"]).optional(),
  is_active: z.boolean().optional(),
  posting_rules: z.array(rule).min(1),
  service_tiers: z.array(tier).optional(),
});

const refCreate = z.object({
  kind: z.enum(["SUBCATEGORY", "UNIT", "PROOF_SOURCE", "PROVIDER_KIND"]),
  code: z.string().min(1).max(64),
  name_fr: z.string().min(1),
  name_en: z.string().nullish(),
  extra: z.record(z.any()).optional(),
  sort_order: z.number().int().optional(),
});
const refUpdate = z.object({
  name_fr: z.string().min(1).optional(),
  name_en: z.string().nullish(),
  sort_order: z.number().int().optional(),
  is_active: z.boolean().optional(),
});

/* ── PR2: spend window, rate supersede, bulk import ─────────────────────────── */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

// The spend window is a QUERY, so it is validated as one — and both bounds are
// optional because `normalisePeriod` owns the default (the trailing 12 months).
// A validator that required them would push that default into every caller.
// The finder's query string. `q` is required and bounded — an unbounded term
// would let a caller push an arbitrarily long string into three trigram
// comparisons per row.
const searchQuery = z.object({
  q: z.string().min(1).max(80),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  direction: z.enum(["REVENUE", "EXPENSE", "DISBURSEMENT", "ASSET"]).optional(),
  service_type_id: z.string().uuid().optional(),
  include_inactive: z.enum(["true", "false"]).optional(),
});

const spendQuery = z.object({
  from: day.optional(),
  to: day.optional(),
  include_documents: z.enum(["true", "false"]).optional(),
});

// Supersede, not edit: `effective_from` is the pivot the open row is expired
// against, so it is required — the whole operation is meaningless without it.
// `effective_to` stays optional (an open-ended new rate is the normal case).
const rateSupersede = z.object({
  rate: z.number().nonnegative(),
  currency: z.string().length(3).optional(),
  effective_from: day,
  effective_to: day.nullish(),
  // NULL = the item's plain default rate (no carrier/authority scope).
  rate_provider_id: z.string().uuid().nullish(),
  // NULL = no equipment dimension (an authority fee per BL, an air rate
  // priced by weight rather than by box).
  container_type_ref_id: z.string().uuid().nullish(),
  note: z.string().nullish(),
});

// Uploads ride the same base64 data-URL convention as the document vault, so
// there is one upload shape in the product and no multipart middleware to add.
const importUpload = z.object({
  file: z.string().min(1),
  filename: z.string().optional(),
});

// A staging row on its way back for commit. `raw` is the ORIGINAL cell values,
// deliberately — commit re-validates from raw rather than trusting the client's
// normalised `data`, so a tampered or stale payload cannot bypass the rules.
const importRow = z.object({
  row: z.number().int().optional(),
  raw: z.record(z.any()),
  data: z.record(z.any()).optional(),
  reasons: z.array(z.string()).optional(),
});
const importCommit = z.object({ rows: z.array(importRow).min(1).max(2000) });
const importErrors = z.object({
  rows: z.array(z.object({ row: z.number().int().optional(), reasons: z.array(z.string()).default([]), raw: z.record(z.any()) })).min(1).max(2000),
});

const schemas = {
  create, update: create.partial(), refCreate, refUpdate,
  searchQuery, spendQuery, rateSupersede, importUpload, importCommit, importErrors,
};

/** Query-string validator — same shape as `mw`, but reads req.query. */
const qmw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.query);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid query", 422, p.error.flatten().fieldErrors));
  req.query = { ...req.query, ...p.data };
  return next();
};
const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};
module.exports = {
  create: mw("create"), update: mw("update"), refCreate: mw("refCreate"), refUpdate: mw("refUpdate"),
  searchQuery: qmw("searchQuery"),
  spendQuery: qmw("spendQuery"),
  rateSupersede: mw("rateSupersede"),
  importUpload: mw("importUpload"),
  importCommit: mw("importCommit"),
  importErrors: mw("importErrors"),
  schemas,
};
