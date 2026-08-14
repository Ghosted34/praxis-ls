"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const { query, strictQuery, filters } = require("../../../shared/http/validate");

/** The `kind` vocabulary, as migration 0674 widened it. One list, three uses:
 *  the search filter, manual creation, and the operator's override when
 *  confirming a provider suggestion. */
const KINDS = [
  "SEAPORT",
  "AIRPORT",
  "CITY",
  "INLAND",
  "TERMINAL",
  "RAIL_TERMINAL",
  "BORDER_POST",
  "WAREHOUSE",
  "ADDRESS",
  "OTHER",
];

const country = z
  .string()
  .trim()
  .length(2)
  .regex(/^[A-Za-z]{2}$/, "expected a two-letter ISO country code")
  .transform((v) => v.toUpperCase());

const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);

/**
 * Manual creation of a place. `source` is forced to MANUAL by the service — a
 * hand-entered coordinate must never be recorded as if a provider returned it,
 * because `resolveMany` treats MANUAL rows as corrections that a later geocode
 * must not overwrite.
 */
const create = z.object({
  name: z.string().trim().min(1).max(160),
  latitude,
  longitude,
  country: country.optional(),
  region: z.string().trim().max(120).optional(),
  kind: z.enum(KINDS).optional(),
  // Free text the operator writes to describe the place — a gate number, a
  // landmark. Stored as the formatted address because that is what it is.
  formatted: z.string().trim().max(500).optional(),
  unlocode: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}[A-Za-z0-9]{3}$/, "expected a five-character UN/LOCODE")
    .transform((v) => v.toUpperCase())
    .optional(),
  is_reference_point: z.boolean().optional(),
});

/**
 * Confirming a provider suggestion.
 *
 * NOTE WHAT IS NOT HERE: no latitude, no longitude, no formatted address, no
 * country of record. The service re-queries the provider and takes the
 * coordinate from ITS answer (see confirmSuggestion), so a body that could carry
 * a coordinate would only be a way to forge one. The client sends what it takes
 * to identify the suggestion, plus the two decisions that are genuinely the
 * operator's: what kind of place this is, and whether it is the exact place or a
 * reference point near it.
 */
const confirm = z.object({
  query: z.string().trim().min(3).max(200),
  provider_place_id: z.string().trim().min(1).max(300),
  country: country.optional(),
  kind: z.enum(KINDS).optional(),
  is_reference_point: z.boolean().optional(),
});

/**
 * The search query. `.strict()` via strictQuery, so `?kinds=SEAPORT` — a plural
 * somebody will inevitably try — is a 422 naming the key rather than an
 * unfiltered result set that looks like it worked.
 */
const searchQuery = strictQuery({
  country: country.optional(),
  // Repeatable: `?kind=SEAPORT&kind=AIRPORT`. Express gives a string for one
  // occurrence and an array for several, so both shapes are accepted and
  // normalised to an array.
  kind: z
    .union([z.enum(KINDS), z.array(z.enum(KINDS)).max(KINDS.length)])
    .transform((v) => (Array.isArray(v) ? v : [v]))
    .optional(),
  // Opt IN to the provider. Off by default so typing never spends quota and the
  // decision to search the world is always something a person asked for.
  provider: filters.bool,
});

const schemas = { create, confirm, searchQuery };
const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = {
  create: mw("create"),
  confirm: mw("confirm"),
  search: query(searchQuery),
  schemas,
  KINDS,
};
