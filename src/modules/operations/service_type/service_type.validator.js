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

/**
 * Where the service happens. The last three landed with the seeded service
 * taxonomy (seeds/9080_seed_dictionary.sql) and are not synonyms of the first
 * four: hinterland transit is a bonded corridor to Chad/CAR rather than a plain
 * border crossing, a customs-brokerage file never leaves the port/airport zone,
 * and an end-to-end door-to-door movement is both an import and an export leg.
 * Without them a manager editing a seeded row is forced to re-label it wrongly.
 */
const TERRITORY = z.enum([
  "INTERNATIONAL_IMPORT",
  "INTERNATIONAL_EXPORT",
  "DOMESTIC_INLAND",
  "CROSS_BORDER",
  "TRANSIT_HINTERLAND",
  "PORT_AIRPORT_ZONE",
  "END_TO_END_INTERNATIONAL",
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

/**
 * The tier matrix write. `tier` is the LOWEST bundle a line belongs to, because
 * the sets nest (BASIC ⊆ ADVANCED ⊆ FULL) — there is exactly one value per
 * (service, line), which is why this is a scalar and not a set of flags.
 */
const dictionaryTier = z.object({
  tier: z.enum(["BASIC", "ADVANCED", "FULL"]),
});

const schemas = { create, update, dictionaryTier };
const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = { create: mw("create"), update: mw("update"), dictionaryTier: mw("dictionaryTier"), schemas, TERRITORIES: TERRITORY.options };
