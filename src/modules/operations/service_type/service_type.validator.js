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

/**
 * The two characters that close an operation-file reference (`SM` in
 * `SL7Z3K9QW2M4XBSM`). Uppercased on the way in, because a lowercase code would
 * satisfy nothing in the format and only produce a confusing 422 from the
 * database CHECK.
 *
 * Optional on both paths: leaving it blank is the normal case and the service
 * derives one from the key (`SEA_FREIGHT_IMPORT` → `SM`). It is here at all so
 * a tenant whose business already uses a particular code on its paperwork can
 * say so, rather than being given whatever the algorithm picked.
 */
const OPS_REFERENCE_CODE = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{2}$/, "Two characters, A-Z or 0-9 — e.g. SM");

/**
 * What a public quote enquiry has to ask for this service (migration 12774).
 *
 * NOT derived from the key, unlike the transport mode. Guessing from a string is
 * fine for a glyph, where being wrong costs an icon; it is not fine for deciding
 * which fields a stranger must fill before the form will let them talk to
 * anybody. The tenant knows, so the tenant says.
 */
const ENQUIRY_SHAPE = z.enum(["ROUTE", "STORAGE", "NONE"]);

const create = z.object({
  key: KEY,
  name_fr: z.string().min(1),
  name_en: z.string().min(1).optional(),
  territory: TERRITORY.optional(),
  enquiry_shape: ENQUIRY_SHAPE.optional(),
  is_active: z.boolean().optional(),
  ops_reference_code: OPS_REFERENCE_CODE.optional(),
});

// No `key` and no `is_system`: the identifier is immutable (see above), and
// is_system marks rows shipped by provisioning — a client must not be able to
// promote its own row to system status and gain the delete protection.
const update = z.object({
  name_fr: z.string().min(1).optional(),
  name_en: z.string().min(1).nullable().optional(),
  territory: TERRITORY.nullable().optional(),
  // Not nullable: the column is NOT NULL with a default, so "no shape" is not a
  // state — ROUTE is.
  enquiry_shape: ENQUIRY_SHAPE.optional(),
  is_active: z.boolean().optional(),
  // Editable only while no dossier has used it — the service enforces that.
  // Not nullable: a code can be corrected, never removed, because clearing it
  // would leave the next file with nothing to close its reference with.
  ops_reference_code: OPS_REFERENCE_CODE.optional(),
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

module.exports = { create: mw("create"), update: mw("update"), dictionaryTier: mw("dictionaryTier"), schemas, TERRITORIES: TERRITORY.options, ENQUIRY_SHAPES: ENQUIRY_SHAPE.options };
