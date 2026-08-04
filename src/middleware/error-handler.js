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
};

// The 4-arg signature is what marks this as Express's error handler; `_next` is
// required to be present even though it is never called.
function errorHandler(err, req, res, _next) {
  const request_id = req.request_id;

  if (err instanceof AppError) {
    const status = err.status || 500;
    if (status >= 500) logger.error({ err, request_id }, err.message);
    else logger.warn({ request_id, code: err.code, status }, err.message);
    return res.status(status).json({
      error: { code: err.code, message: err.message, ...(err.details ? { fields: err.details } : {}) },
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
    return res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: "Invalid input", fields },
      request_id,
    });
  }

  const mapped = err && err.code && PG[err.code];
  if (mapped) {
    const [status, code, message] = mapped;
    logger.warn({ request_id, pg_code: err.code, constraint: err.constraint }, "pg error");
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
  return res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "Something went wrong on our side — please try again.", reference: request_id },
    request_id,
  });
}

module.exports = { errorHandler, notFoundHandler };
