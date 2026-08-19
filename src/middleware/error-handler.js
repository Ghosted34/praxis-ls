/**
 * Centralised error handler + 404 handler for the API.
 *
 * One consistent shape:  { error: { code, message, fields? }, request_id }
 * Never leaks SQL text, stack traces, or internal messages to the client.
 */
"use strict";

const { ZodError } = require("zod");
const { logger } = require("../config/logger");
const { AppError } = require("../utils/errors");
const { report } = require("../shared/observability/error-reporter");

function notFoundHandler(req, res) {
  res.status(404).json({
    error: { code: "NOT_FOUND", message: `No route for ${req.method} ${req.path}` },
    request_id: req.request_id,
  });
}

const PG = {
  23505: [409, "CONFLICT", "A record with these values already exists"],
  23503: [409, "REFERENCE_INVALID", "Referenced record not found"],
  23502: [400, "MISSING_VALUE", "A required value was missing"],
  23514: [400, "INVALID_VALUE", "A value violates a domain constraint"],
  22001: [400, "VALUE_TOO_LONG", "One of the values you entered is too long"],
  22003: [400, "VALUE_OUT_OF_RANGE", "One of the values you entered is out of range"],
  "22P02": [400, "INVALID_VALUE", "One of the values is in the wrong format"],
  40001: [409, "TEMPORARY_CONFLICT", "Please retry — a brief conflict occurred"],
  "40P01": [409, "TEMPORARY_CONFLICT", "Please retry — a brief conflict occurred"],
  P0001: [409, "ACTION_BLOCKED", "That action was blocked by a business rule"],
  // 42P01 undefined_table / 42703 undefined_column — a repo query names an
  // object that does not exist in the schema. Distinct from INTERNAL_ERROR so
  // the class is greppable in error_event, and so the group signature carries
  // the pg_code instead of a fingerprinted message.
  "42P01": [500, "SCHEMA_ERROR", "A required table is missing"],
  42703: [500, "SCHEMA_ERROR", "A required column is missing"],
};

// The 4-arg signature is what marks this as Express's error handler; `_next` is
// required to be present even though it is never called.
/**
 * Spec §2.3 pt 4 — "Backend must capture … API validation failures".
 *
 * Captured at `notice`, which is what makes honouring the requirement safe. A
 * 422 is a client mistake, not a fault, and routing them at `error` would bury
 * real failures under "email is required" and get the alert channel muted. At
 * `notice` the reporter records and counts but never posts to the webhook and
 * never spends the rate limit (see NOTIFY_SEVERITIES), and escalation rules
 * default to `fatal`, so nothing pages.
 *
 * The message is SYNTHESISED rather than passed through. A ZodError's own
 * `message` is a JSON dump of every issue, which would be unreadable in the feed
 * and — worse — would fingerprint differently for every combination of bad
 * fields, so one broken form would produce hundreds of separate groups. Keying
 * on the route plus the sorted field names makes "this endpoint keeps getting
 * bad input for these fields" ONE row with a rising count, which is the only
 * shape in which this data is worth anything.
 */
function reportValidation(req, fields, code) {
  try {
    const names = Object.keys(fields || {}).sort().join(", ") || "unknown";
    const route = `${req.method} ${req.route ? req.baseUrl + req.route.path : req.path}`;
    const err = new Error(`${code}: ${names}`);
    err.name = "ValidationError";
    // A synthetic frame: the route IS the location for this class, and the real
    // stack would point at the validator middleware for every one of them.
    err.stack = `ValidationError: ${code}: ${names}\n    at ${route}`;
    report(err, {
      origin: "server",
      severity: "notice",
      route: `${req.method} ${req.originalUrl || req.path}`,
      request_id: req.request_id,
      extra: { fields: Object.keys(fields || {}) },
    });
  } catch {
    /* reporting a validation failure must never break the 422 response */
  }
}

function errorHandler(err, req, res, _next) {
  const request_id = req.request_id;

  if (err instanceof AppError) {
    const status = err.status || 500;
    if (status >= 500) {
      logger.error({ err, request_id }, err.message);
      report(err, { origin: "server", route: `${req.method} ${req.originalUrl || req.path}`, request_id });
    }
    else {
      logger.warn({ request_id, code: err.code, status }, err.message);
      // Only VALIDATION_ERROR is a "bad input" failure worth grouping into the
      // error centre. A 422 whose code is a business rule — APPROVAL_PENDING,
      // NO_ITEMS, NO_RATE_MATCH, and the dozens of other `NO_*` state checks —
      // is a normal client state, not invalid input. Routing those through
      // reportValidation synthesised `ValidationError: <code>: unknown` (their
      // `details` is null, so the field list collapsed to "unknown"), which read
      // as a fault and polluted the feed. The 90 module validators all throw
      // AppError("VALIDATION_ERROR", …, 422), so keying on the code (rather than
      // the status) captures exactly the right class.
      if (err.code === "VALIDATION_ERROR") {
        reportValidation(req, err.details, err.code);
      }
    }
    return res.status(status).json({
      error: {
        code: err.code,
        message: err.message,
        // API F-2. `fields` is canonical. `details` is a DEPRECATED ALIAS kept
        // because the auth endpoints emitted `details` and only `details`, and
        // client/src/lib/api-client.ts read it — so removing it outright would
        // break every existing auth integration on the day of the deploy.
        // Both keys carry the same object. Remove `details` once no consumer
        // reads it; the client no longer does.
        ...(err.details ? { fields: err.details, details: err.details } : {}),
      },
      request_id,
    });
  }

  if (err instanceof ZodError) {
    const fields = err.issues.reduce((acc, i) => {
      const path = i.path.join(".") || "_";
      (acc[path] = acc[path] || []).push(i.message);
      return acc;
    }, {});
    logger.warn({ request_id, fields }, "validation error");
    reportValidation(req, fields, "VALIDATION_ERROR");
    // API F-2: 422, matching the 90 module validators that already used it.
    // This fallback was the only path still answering 400 for the same class of
    // error, so a caller's handling depended on WHICH layer caught the problem.
    return res.status(422).json({
      error: { code: "VALIDATION_ERROR", message: "Invalid input", fields, details: fields },
      request_id,
    });
  }

  const mapped = err && err.code && PG[err.code];
  if (mapped) {
    const [status, code, message] = mapped;
    // 4xx mapped codes are client mistakes and log at warn; the two 5xx entries
    // (42P01/42703 SCHEMA_ERROR) are real faults and must reach the reporter,
    // otherwise a repo pointing at a nonexistent table returns 500 with no row
    // in error_event — exactly the "reports nothing failed" pattern this
    // programme is meant to end.
    if (status >= 500) {
      logger.error({ err, request_id, pg_code: err.code, constraint: err.constraint }, "pg schema error");
      report(err, { origin: "server", route: `${req.method} ${req.originalUrl || req.path}`, request_id });
    } else {
      logger.warn({ request_id, pg_code: err.code, constraint: err.constraint }, "pg error");
    }
    return res.status(status).json({ error: { code, message }, request_id });
  }

  // API F-1 (2026-08-04). `err.status` was read ONLY inside the AppError branch
  // above, so seven service files that throw a plain Error with a `.status`
  // property fell straight through to the 500 below. Eighteen deliberate client
  // errors — "ticket not found", "CSAT on an unresolved ticket", "unknown
  // tenant slug", "needs at least one posting rule" — reached the consumer as
  //     500 { code: "INTERNAL_ERROR" }
  // which is wrong three ways: the caller cannot tell "you asked for something
  // that doesn't exist" from "we are broken"; a client that correctly retries
  // 5xx retries forever; and every one of them logged at logger.error, so the
  // alerting added this week would page on a 404.
  //
  // That last consequence is why this is fixed BEFORE alerting is switched on
  // rather than after. A brand-new alert channel whose first week is full of
  // "ticket not found" gets muted, and then it is decoration.
  //
  // The right long-term fix is converting those 18 sites to AppError; this
  // makes the handler correct for all of them at once, including any that get
  // written tomorrow by someone following the existing local convention.
  //
  // Deliberately conservative: only 4xx is honoured. A plain Error carrying
  // `status: 503` still becomes a generic 500, because an arbitrary throw
  // should not get to choose a server-error code or leak its message.
  const thrownStatus = Number(err && err.status);
  if (Number.isInteger(thrownStatus) && thrownStatus >= 400 && thrownStatus < 500) {
    const code = (err && err.code) || "REQUEST_REJECTED";
    logger.warn(
      { request_id, status: thrownStatus, code, err_name: err.name },
      err.message || "client error",
    );
    return res.status(thrownStatus).json({
      // `expose` is the Express/http-errors convention. Absent it, a 4xx from a
      // plain Error still gets its message shown, because these are handwritten
      // user-facing strings ("No depreciation scheduled for 2026-03"), not
      // internals — that is the whole reason the author set a 4xx status.
      error: {
        code,
        message: err.expose === false ? "Request rejected" : err.message || "Request rejected",
        ...(err.details ? { fields: err.details } : {}),
      },
      request_id,
    });
  }

  logger.error({ err, request_id }, "unhandled error");
  // OBS-E1: a 500 used to end here — one line in a log that is not shipped and
  // is wiped on every deploy. Now it also reaches the error sink, with tenant,
  // user and request_id attached. Fire-and-forget: reporting must never turn a
  // handled 500 into an unhandled one.
  report(err, { origin: "server", route: `${req.method} ${req.originalUrl || req.path}`, request_id });
  return res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "Something went wrong on our side — please try again.", reference: request_id },
    request_id,
  });
}

module.exports = { errorHandler, notFoundHandler };
