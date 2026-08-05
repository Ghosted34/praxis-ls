/**
 * The validation kit. One error shape, three places to validate.
 *
 * Audit API F-2 (High), F-15 (High), F-16 (High).
 *
 * ONE ERROR SHAPE (F-2)
 *
 * "Your input was invalid" had four different contracts:
 *
 *   90 module validators   422  VALIDATION_ERROR  + fields
 *   workflow, scope        400  VALIDATION_ERROR  + fields
 *   ALL auth endpoints     422  VALIDATION_FAILED + details
 *   raw ZodError fallback  400  VALIDATION_ERROR  + fields
 *
 * The auth row was the worst possible placement: /auth/login, /auth/refresh,
 * /auth/forgot-password and /auth/2fa/* are the first endpoints any integrator
 * touches, so they learn `VALIDATION_FAILED` + `details` and then discover the
 * other ~700 routes use `VALIDATION_ERROR` + `fields`.
 *
 * That divergence was already costing real behaviour, not just tidiness:
 * `client/src/lib/api-client.ts` built its typed error from `err.details`, which
 * the server emitted in exactly one file — so for ~700 routes field-level
 * validation messages never reached the UI at all.
 *
 * Canonical shape, everywhere:
 *
 *   422 { error: { code: "VALIDATION_ERROR", message, fields }, request_id }
 *
 * 422 rather than 400 because it is what 90 of the 92 validators already
 * emitted; moving the majority would break more callers than moving the
 * minority. `details` is still emitted alongside `fields` by the error handler
 * as a deprecated alias, so existing auth integrations keep working.
 *
 * PARAMS AND QUERY (F-16)
 *
 * Only 3 of 92 validators parsed `req.query` and ZERO parsed `req.params`.
 * Everything else trusted the string and let Postgres decide, with two
 * consequences:
 *
 *   1. Unknown filters are silently ignored. `?statuss=ACTIVE` returns the
 *      UNFILTERED list with a 200 — a consumer with a typo gets wrong data and
 *      no signal. `strictQuery` is the answer to that one.
 *   2. A malformed id produces a database-shaped error: `22P02` mapped to
 *      `400 INVALID_VALUE`, with no `fields` and nothing saying the problem was
 *      in the path. `idParamGuard` turns that into a 422 that names the
 *      parameter.
 */

"use strict";

const { z } = require("zod");
const { AppError } = require("../../utils/errors");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIGITS_RE = /^\d{1,19}$/;

/** Turn a ZodError into the canonical `fields` map. */
function fieldsOf(error) {
  return error.issues.reduce((acc, i) => {
    const key = i.path.join(".") || "_";
    (acc[key] = acc[key] || []).push(i.message);
    return acc;
  }, {});
}

/** The one way to raise a validation failure. */
function invalid(message, fields) {
  return new AppError("VALIDATION_ERROR", message, 422, fields);
}

/**
 * Validate one part of the request against a zod schema and REPLACE it with the
 * parsed result.
 *
 * Replacing matters: `z.object()` strips unknown keys, so the handler sees only
 * declared fields. That is the existing convention for bodies, and it is why
 * `keep_signed_in` had to be declared in the auth schema — an undeclared flag
 * silently vanishes.
 *
 * `req.query` is a getter on Express 5, so it is redefined rather than assigned;
 * a plain assignment throws.
 */
function part(where, schema, label) {
  return (req, _res, next) => {
    const parsed = schema.safeParse(req[where]);
    if (!parsed.success) return next(invalid(`Invalid ${label}`, fieldsOf(parsed.error)));
    try {
      req[where] = parsed.data;
    } catch {
      Object.defineProperty(req, where, { value: parsed.data, writable: true, configurable: true });
    }
    return next();
  };
}

const body = (schema) => part("body", schema, "body");
const query = (schema) => part("query", schema, "query parameters");
const params = (schema) => part("params", schema, "path parameters");

/**
 * F-16, consequence 2. Reject a path id that cannot possibly address a row,
 * before it reaches Postgres.
 *
 * Registered by the module loader via `router.param("id", …)` on every mounted
 * router, so all 363 `/:id` routes are covered without editing 363 files.
 *
 * ACCEPTS UUIDs AND DIGITS, not just UUIDs. Most primary keys here are uuid but
 * not all: event_log, immutable_ledger, ai_usage_ledger and event_dispatch are
 * `bigint`, and a uuid-only guard would 422 legitimate requests against them.
 *
 * A module whose id is genuinely free text (chart_of_accounts by `code`,
 * currency by `code`, feature_state by `feature_key`) opts out by exporting
 * `idParam: "text"` from its routes file. Opt-out rather than opt-in because
 * the safe default should be the strict one — an author who forgets gets
 * protection, not a hole.
 */
function idParamGuard(req, _res, next, value, name) {
  if (UUID_RE.test(value) || DIGITS_RE.test(value)) return next();
  return next(
    invalid("Invalid path parameters", { [name]: ["must be a UUID or a numeric id"] }),
  );
}

/**
 * Standard list controls, shared so pagination means the same thing everywhere
 * (F-26, F-27).
 *
 * `limit` is capped rather than rejected above the cap: a client asking for
 * 10,000 rows gets the maximum it is allowed instead of an error, which keeps
 * naive integrations working while still bounding the query.
 */
const LIST_QUERY = {
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  q: z.string().trim().min(1).max(200).optional(),
};

/**
 * Build a query schema that ACCEPTS the listed filters and REJECTS everything
 * else.
 *
 * F-16 consequence 1 is the most dangerous finding in the API audit precisely
 * because it is silent. `.strict()` converts it into a 422 that names the
 * offending key.
 *
 * This is a breaking change for a caller currently sending a key that does
 * nothing. That is the point: such a caller is already getting results it did
 * not ask for, and would rather be told.
 */
function strictQuery(filters = {}) {
  return z.object({ ...LIST_QUERY, ...filters }).strict();
}

/** Common filter shapes, so 60 repos spell `status` the same way. */
const filters = {
  uuid: z.string().uuid().optional(),
  text: z.string().trim().max(200).optional(),
  bool: z
    .enum(["true", "false", "1", "0"])
    .transform((v) => v === "true" || v === "1")
    .optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD").optional(),
  enum: (values) => z.enum(values).optional(),
};

/** Retained: CRUD modules with no domain rules mount this instead of a schema. */
const noop = (req, _res, next) => next();

module.exports = {
  body,
  query,
  params,
  strictQuery,
  filters,
  LIST_QUERY,
  idParamGuard,
  invalid,
  fieldsOf,
  UUID_RE,
  passthrough: { create: noop, update: noop },
  noop,
};
