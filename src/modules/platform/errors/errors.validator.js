/**
 * Zod validators for the Error Command Center API.
 *
 * QUERY validation is not optional decoration here. The list endpoint takes ten
 * filter parameters straight off the wire, and `sort` selects an ORDER BY
 * fragment — an enum that is merely "documented" rather than enforced is one
 * refactor away from being interpolated. Validating at the edge means
 * errors.service can trust its input, and a bad `level` is a 422 with a useful
 * message instead of a silently empty feed.
 */
"use strict";

const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const LEVEL = z.enum(["fatal", "error", "warning", "notice", "info"]);
/** Comma-separated multi-select from the §3.4 filter bar: "fatal,error". */
const levelList = z
  .string()
  .regex(/^[a-z,]+$/i)
  .refine(
    (s) => s.split(",").every((v) => LEVEL.safeParse(v.trim().toLowerCase()).success),
    "unknown level",
  );

const uuid = z.string().uuid();
const isoDate = z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/));

const QUERY_SCHEMAS = {
  errorList: z.object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
    level: levelList.optional(),
    status: z.enum(["active", "resolved", "all"]).optional(),
    scope: z.enum(["all", "platform"]).optional(),
    tenant: z.string().max(64).optional(),
    module: z.string().max(100).optional(),
    signature: z.string().max(500).optional(),
    search: z.string().max(200).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    sort: z.enum(["recent", "count", "severity"]).optional(),
    format: z.enum(["csv", "json"]).optional(),
  }),
  errorRecent: z.object({
    since: isoDate.optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
    scope: z.enum(["all", "platform"]).optional(),
    tenant: z.string().max(64).optional(),
  }),
  errorTrends: z.object({
    hours: z.coerce.number().int().positive().max(720).optional(),
    level: levelList.optional(),
    scope: z.enum(["all", "platform"]).optional(),
    tenant: z.string().max(64).optional(),
    module: z.string().max(100).optional(),
    status: z.enum(["active", "resolved", "all"]).optional(),
  }),
  escalationLog: z.object({
    rule_id: uuid.optional(),
    limit: z.coerce.number().int().positive().max(200).optional(),
  }),
};

const BODY_SCHEMAS = {
  explain: z.object({ force: z.boolean().optional() }).default({}),
  ruleCreate: z.object({
    tenant: z.string().max(64).nullish(),
    name: z.string().min(2).max(100),
    level_filter: z.array(LEVEL).min(1).default(["fatal"]),
    threshold_count: z.number().int().positive().max(100000).default(5),
    threshold_window_minutes: z.number().int().positive().max(10080).default(15),
    action_email: z.boolean().default(true),
    action_inhouse: z.boolean().default(true),
    // A webhook URL is fetched by the server on a schedule, so an unvalidated
    // one is a standing SSRF primitive. http(s) only, and no credentials in the
    // URL (a "https://user:pass@internal/" form both leaks and bypasses filters).
    // Order matters: `.refine()` returns a ZodEffects, which has no `.max()`.
    // Every string constraint has to be applied BEFORE the first refine.
    action_webhook_url: z
      .string()
      .url()
      .max(500)
      .refine((u) => /^https?:\/\//i.test(u), "must be http(s)")
      .refine((u) => !/^https?:\/\/[^/@]*@/i.test(u), "credentials in URL are not allowed")
      .nullish(),
    email_recipients: z.array(z.string().email()).max(50).default([]),
    escalation_delay_minutes: z.number().int().min(0).max(1440).default(0),
    repeat_interval_minutes: z.number().int().min(0).max(10080).default(60),
    active: z.boolean().default(true),
  }),
  ruleUpdate: z
    .object({
      name: z.string().min(2).max(100).optional(),
      level_filter: z.array(LEVEL).min(1).optional(),
      threshold_count: z.number().int().positive().max(100000).optional(),
      threshold_window_minutes: z.number().int().positive().max(10080).optional(),
      action_email: z.boolean().optional(),
      action_inhouse: z.boolean().optional(),
      action_webhook_url: z.string().url().max(500).nullish(),
      email_recipients: z.array(z.string().email()).max(50).optional(),
      escalation_delay_minutes: z.number().int().min(0).max(1440).optional(),
      repeat_interval_minutes: z.number().int().min(0).max(10080).optional(),
      active: z.boolean().optional(),
    })
    .refine((o) => Object.keys(o).length > 0, "no fields to update"),
  rulePreview: z.object({
    level_filter: z.array(LEVEL).min(1).default(["fatal"]),
    threshold_count: z.number().int().positive().default(5),
    threshold_window_minutes: z.number().int().positive().default(15),
  }),
};

const PARAM_SCHEMAS = {
  errorId: z.object({ id: uuid }),
};

function fail(next, message, err) {
  return next(new AppError("VALIDATION_ERROR", message, 422, err.flatten().fieldErrors));
}

const validateQuery = (key) => (req, _res, next) => {
  const parsed = QUERY_SCHEMAS[key].safeParse(req.query);
  if (!parsed.success) return fail(next, "Invalid query parameters", parsed.error);
  // Coerced/defaulted values replace the raw strings so the service never has to
  // re-parse. Assigning to req.query directly is not safe on Express 5 (getter),
  // so the validated copy is carried alongside.
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
