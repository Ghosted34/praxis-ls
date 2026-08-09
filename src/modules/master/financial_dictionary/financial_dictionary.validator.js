"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const rule = z.object({
  applies_context: z.enum(["sale", "purchase", "disbursement"]),
  debit_account: z.string().nullish(),
  credit_account: z.string().nullish(),
  tax_code_id: z.string().uuid().nullish(),
  is_debours: z.boolean().optional(),
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
  category: z.enum(["debours", "service", "overhead", "asset", "other"]),
  direction: z.enum(["REVENUE", "EXPENSE", "DEBOURS", "ASSET"]),
  subcategory: z.string().nullish(),
  unit_of_measure: z.string().nullish(),
  applicability_mode: z.enum(["SERVICE_SCOPED", "ANY_OPERATIONS", "NON_OPERATIONAL"]).optional(),
  is_debours: z.boolean().optional(),
  is_billable: z.boolean().optional(),
  default_price: z.number().nonnegative().nullish(),
  currency: z.string().length(3).optional(),
  shipping_line: z.string().nullish(),
  provider_kind: z.enum(["SHIPPING_LINE", "CUSTOMS_AUTHORITY", "PORT_TERMINAL", "OTHER"]).nullish(),
  proof_source: z.string().nullish(),
  requires_justification: z.boolean().optional(),
  receipt_requirement: z.enum(["ALWAYS_REQUIRED", "CONDITIONALLY_REQUIRED", "NOT_REQUIRED"]).optional(),
  debours_vat_transparent: z.boolean().optional(),
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

const schemas = { create, update: create.partial(), refCreate, refUpdate };
const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};
module.exports = { create: mw("create"), update: mw("update"), refCreate: mw("refCreate"), refUpdate: mw("refUpdate"), schemas };
