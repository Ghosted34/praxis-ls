/**
 * Zod validators for the Kaizen ops API (INFRASTRUCTURE_PLAN §3).
 *
 * The window parameters here (`days`, `hours`, `limit`) all end up in interval
 * arithmetic and LIMIT clauses, so they are coerced and bounded at the edge
 * rather than trusted: an unbounded `days` on the uptime series is a full-table
 * scan any authenticated operator could trigger by editing a URL, and an
 * unbounded `limit` is the same thing with a bigger response body.
 *
 * The ceilings are deliberately generous — 365 days of uptime is a legitimate
 * annual availability report — but finite.
 */
"use strict";

const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const uuid = z.string().uuid();
/** Metric keys are storage keys and SQL parameters, so they are constrained. */
const METRIC = z.string().regex(/^[a-z][a-z0-9_]{1,39}$/, "invalid metric key");
/** Same shape the provisioning validator enforces; a slug is a DB name here. */
const slug = z.string().regex(/^[a-z0-9][a-z0-9_-]{1,62}$/, "invalid tenant slug");
const isoDateTime = z.string().datetime({ offset: true });

const QUERY_SCHEMAS = {
  healthHistory: z.object({
    hours: z.coerce.number().int().positive().max(24 * 90).optional(),
  }),
  backupStatus: z.object({
    // Defaults match D4 (RPO ≤ 24h) plus the grace window a late-running nightly
    // job needs before it is called stale.
    rpo_hours: z.coerce.number().int().positive().max(24 * 30).optional(),
    grace_hours: z.coerce.number().int().min(0).max(72).optional(),
  }),
  backupRuns: z.object({
    limit: z.coerce.number().int().positive().max(500).optional(),
    kind: z.enum(["PG_DUMP", "WAL", "OBJECT_SYNC", "SNAPSHOT_SCAN"]).optional(),
    status: z.enum(["OK", "FAILED"]).optional(),
    slug: slug.optional(),
  }),
  drills: z.object({
    limit: z.coerce.number().int().positive().max(500).optional(),
  }),
  usage: z.object({
    // Monthly bucket, always the first of a month. Free-form dates would let a
    // caller ask for a period that cannot exist in the table and get an empty
    // answer that looks like "no usage" rather than "wrong question".
    period: z.string().regex(/^\d{4}-\d{2}-01$/, "period must be the first of a month, e.g. 2026-08-01").optional(),
  }),
  uptime: z.object({
    days: z.coerce.number().int().positive().max(365).optional(),
  }),
  maintenance: z.object({
    // Coerced from the string "true"/"false" a query string actually carries.
    include_past: z
      .union([z.boolean(), z.enum(["true", "false"]).transform((s) => s === "true")])
      .optional(),
  }),
};

const BODY_SCHEMAS = {
  maintenanceCreate: z
    .object({
      // Slug, not tenant_id: an operator picks a tenant by the name they see
      // everywhere else in the console, and the tenant LIST endpoint does not
      // return tenant_id to pick from. Resolved server-side.
      //
      // null / absent = a fleet-wide window. Explicitly nullable rather than
      // merely optional, so "every tenant" is something the caller states.
      tenant_slug: slug.nullish(),
      starts_at: isoDateTime,
      ends_at: isoDateTime,
      title: z.string().min(1).max(200),
      message: z.string().max(2000).nullish(),
      mode: z.enum(["ANNOUNCE", "READ_ONLY"]).default("ANNOUNCE"),
      // How many hours BEFORE starts_at the banner appears. 0 = no advance
      // notice, which is the honest option for an emergency window and better
      // than pretending there was warning. Capped at 30 days to match the DB
      // constraint: a banner shown for longer than a month is wallpaper, and
      // people stop reading it — the failure this feature exists to avoid.
      notice_hours: z.coerce.number().int().min(0).max(720).default(24),
    })
    .refine((o) => new Date(o.ends_at) > new Date(o.starts_at), {
      message: "ends_at must be after starts_at",
      path: ["ends_at"],
    }),

  entitlementSet: z.object({
    metric: METRIC,
    limit_value: z.coerce.number().min(0),
    // Defaults to SOFT. A limit that blocks by default would mean a mistyped
    // entitlement locks a paying tenant out of their own workspace; making
    // "hard" an explicit choice keeps that a decision rather than an accident.
    hard: z.boolean().default(false),
  }),

  drillRun: z.object({
    // A drill normally restores the latest dump. `at` targets an older one,
    // which is how you verify a specific artefact after a suspicious run.
    at: isoDateTime.nullish(),
  }),
};

const PARAM_SCHEMAS = {
  tenantId: z.object({ tenantId: uuid }),
  slug: z.object({ slug }),
  maintenanceId: z.object({ id: uuid }),
  planId: z.object({ planId: uuid }),
  planMetric: z.object({ planId: uuid, metric: METRIC }),
  ticketId: z.object({ ticketId: uuid }),
};

function fail(next, message, err) {
  return next(new AppError("VALIDATION_ERROR", message, 422, err.flatten().fieldErrors));
}

const validateQuery = (key) => (req, _res, next) => {
  const parsed = QUERY_SCHEMAS[key].safeParse(req.query);
  if (!parsed.success) return fail(next, "Invalid query parameters", parsed.error);
  // Express 5 makes req.query a getter, so the validated copy rides alongside
  // rather than replacing it — same approach as errors.validator.js.
  req.validatedQuery = parsed.data;
  Object.assign(req.query, parsed.data);
  return next();
};

const validateBody = (key) => (req, _res, next) => {
  const parsed = BODY_SCHEMAS[key].safeParse(req.body ?? {});
  if (!parsed.success) return fail(next, "Invalid request body", parsed.error);
  req.body = parsed.data;
  return next();
};

const validateParams = (key) => (req, _res, next) => {
  const parsed = PARAM_SCHEMAS[key].safeParse(req.params);
  if (!parsed.success) return fail(next, "Invalid path parameters", parsed.error);
  return next();
};

module.exports = { validateQuery, validateBody, validateParams, QUERY_SCHEMAS, BODY_SCHEMAS };
