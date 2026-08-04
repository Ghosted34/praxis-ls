/**
 * HTTP access log.
 *
 * Audit OBS-L1 (Critical) + OBS-L3 (Critical) + OBS-T2 (High), all closed here.
 *
 * `pino-http` has been a declared dependency since the project started and was
 * mounted NOWHERE. The audit verified it empirically: two requests through the
 * real app produced zero access-log lines. There was no record of which
 * endpoints were called, by whom, with what status, or how long they took — so
 * "was the API receiving traffic at 02:00?", "which endpoint started 500ing?"
 * and "when did latency change?" were unanswerable. Not slowly. At all.
 *
 * OBS-L3 is the multi-tenant half, and it is the one that matters most here:
 * of ~120 log call sites in the codebase, NONE carried a tenant identifier. An
 * error spike therefore could not distinguish "one tenant is broken" from
 * "everyone is broken" — the first question anyone asks in an incident. The fix
 * is unusually cheap because `config/request-context.js` already carries
 * `{ tenant, userId }` in AsyncLocalStorage for RLS. The logger simply never
 * read it. It does now, on every line.
 *
 * Deliberate choices:
 *
 *   - Mounted AFTER requestIdMiddleware so `request_id` is available to
 *     correlate with, and after tenantContext where that applies, so the tenant
 *     is resolved by the time a line is written (pino-http logs on response
 *     finish, not on request start).
 *   - Health probes are logged at `debug`. A 60-second uptime monitor otherwise
 *     writes 1,440 lines a day that no one will ever read, which is how a log
 *     everyone ignores gets made.
 *   - 4xx logs at `warn`, 5xx at `error`, everything else `info` (OBS-L5 notes
 *     the codebase currently inverts this in places).
 *   - Response time is recorded on every line (OBS-T2: "no timing recorded
 *     anywhere").
 */

"use strict";

const pinoHttp = require("pino-http");
const { logger } = require("../config/logger");
const requestContext = require("../config/request-context");

/** Paths whose success is noise, not signal. */
const QUIET = /^\/api\/health(\/|$)/;

function buildAccessLog() {
  return pinoHttp({
    logger,

    // Reuse the id minted by requestIdMiddleware so the access line and every
    // application line for the same request share one correlation key
    // (OBS-E3: the id was minted and then thrown away).
    genReqId: (req) => req.request_id,

    customLogLevel(_req, res, err) {
      if (err || res.statusCode >= 500) return "error";
      if (res.statusCode >= 400) return "warn";
      return "info";
    },

    autoLogging: {
      ignore: (req) => QUIET.test(req.url || "") && logger.level !== "debug",
    },

    customSuccessMessage(req, res) {
      return `${req.method} ${req.url} ${res.statusCode}`;
    },
    customErrorMessage(req, res, err) {
      return `${req.method} ${req.url} ${res.statusCode} ${err ? err.message : ""}`.trim();
    },

    /**
     * OBS-L3. The enrichment data was already in scope on every request and
     * unused. `crossTenant` is surfaced explicitly rather than hidden, because
     * a CEO/group request that reads across tenants is exactly the kind of
     * thing you want to be able to find in a log later.
     */
    customProps(req) {
      const ctx = requestContext.get() || {};
      return {
        tenant: ctx.tenant || (req.tenant && req.tenant.slug) || null,
        user_id: ctx.userId || (req.user && req.user.user_id) || null,
        env: req.env || null,
        cross_tenant: ctx.crossTenant === true ? true : undefined,
        request_id: req.request_id,
      };
    },

    // Trim the serialised request/response to what an operator actually reads.
    // The default pino-http serialisers emit every header, which is both noisy
    // and a redaction surface we would rather not maintain.
    serializers: {
      req(req) {
        return {
          method: req.method,
          url: req.url,
          // req.ip is only trustworthy because server.js now sets a proxy hop
          // count rather than `trust proxy: true` (SEC-H5).
          ip: req.raw ? req.raw.ip : req.ip,
          user_agent: req.headers && req.headers["user-agent"],
        };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  });
}

module.exports = { buildAccessLog, QUIET };
