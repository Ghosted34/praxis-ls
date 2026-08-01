"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

/**
 * `key` is the stable machine identifier (citext UNIQUE). It ends up in
 * `dictionary_item.service_type_key` and drives the Control Tower map's
 * transport mode, so it is constrained to SCREAMING_SNAKE and is NOT editable
 * after creation — renaming one would orphan every reference silently.
 * Display names are freely editable; that's what `name_fr` / `name_en` are for.
 */
const KEY = z
  .string()
  .min(2)
  .max(60)
  .regex(/^[A-Z][A-Z0-9_]*$/, "key must be SCREAMING_SNAKE_CASE, e.g. SEA_FREIGHT_IMPORT");

const TERRITORY = z.enum([
  "INTERNATIONAL_IMPORT",
  "INTERNATIONAL_EXPORT",
  "DOMESTIC_INLAND",
  "CROSS_BORDER",
  "OTHER",
]);

const create = z.object({
  key: KEY,
  name_fr: z.string().min(1),
  name_en: z.string().min(1).optional(),
  territory: TERRITORY.optional(),
  is_active: z.boolean().optional(),
});

// No `key` and no `is_system`: the identifier is immutable (see above), and
// is_system marks rows shipped by provisioning — a client must not be able to
// promote its own row to system status and gain the delete protection.
const update = z.object({
  name_fr: z.string().min(1).optional(),
  name_en: z.string().min(1).nullable().optional(),
  territory: TERRITORY.nullable().optional(),
  is_active: z.boolean().optional(),
});

const schemas = { create, update };
const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = { create: mw("create"), update: mw("update"), schemas, TERRITORIES: TERRITORY.options };
