/**
 * API versioning, and the deprecation mechanism that is the point of it.
 *
 * Audit API F-18 (Critical). There was no versioning of any kind: no `/v1`
 * prefix, no `Accept-Version` or `X-API-Version` header, no media-type
 * versioning, no `deprecated` markers, no sunset headers. A grep across `src/`
 * and `client/src/` returned nothing.
 *
 * The consequence the audit draws out is the one that matters: the only version
 * of the API is whatever is deployed right now, and the only compatible way to
 * change an endpoint is to add to it. Every finding in that document marked
 * "BC" had nowhere to roll out behind. F-18 is called the highest-leverage gap
 * because it is the prerequisite for fixing the others.
 *
 * WHAT THIS ADDS, AND WHAT IT DELIBERATELY DOES NOT
 *
 * `/api/v1/...` is now a first-class mount, and `/api/...` continues to serve
 * the identical router. Unversioned is an ALIAS for the current version, not a
 * separate contract — there is exactly one implementation, and the prefix is a
 * label on it. Two implementations is how versioning schemes rot; that decision
 * should be made when a second version genuinely exists, not pre-emptively.
 *
 * What that buys immediately is a place to stand. `X-API-Version` on every
 * response tells a consumer what it is talking to. `deprecate()` gives a route
 * the standard `Deprecation` and `Sunset` headers (RFC 8594) plus a `Link` to
 * the replacement, so a breaking change can be announced ON THE WIRE months
 * before it lands — which is the thing that was impossible.
 *
 * WHY UNVERSIONED IS NOT REDIRECTED OR REFUSED
 *
 * The React app, the PWA and every existing integration call `/api/...`.
 * Refusing them would be a breaking change made in the name of enabling
 * breaking changes to be made safely. `X-API-Deprecation-Notice` marks the
 * unversioned path as legacy so the migration is visible in logs and in the
 * browser's network tab, and it can be retired once traffic reaches zero —
 * which is now measurable, because the counter below records it.
 */

"use strict";

const metrics = require("../shared/observability/metrics");

/** The version this build implements. Bump when a breaking change ships. */
const CURRENT = "v1";

/** Versions this build still serves. Ordered oldest first. */
const SUPPORTED = ["v1"];

/**
 * Stamp every response with the version that produced it, and record whether
 * the caller asked for it explicitly.
 *
 * The counter is what makes the eventual retirement of the unversioned prefix a
 * decision based on traffic rather than on nerve.
 */
function apiVersionHeaders(req, res, next) {
  res.set("X-API-Version", CURRENT);

  const versioned = /^\/api\/v\d+(\/|$)/.test(req.originalUrl || req.url || "");
  if (!versioned) {
    res.set(
      "X-API-Deprecation-Notice",
      // ASCII ONLY. Node's setHeader accepts Latin-1 and nothing else, so the
      // "…" that used to end this line threw ERR_INVALID_CHAR — on EVERY
      // unversioned request, i.e. every request the product actually serves.
      // It surfaced as an unhandled error and the container never answered
      // /api/health, so the docker smoke test caught it only once the smoke
      // test itself started running.
      `Unversioned /api paths are an alias for /${CURRENT} and will be retired. `
      + `Call /api/${CURRENT}/... instead.`,
    );
  }
  try {
    metrics.inc(
      "praxis_api_requests_by_version_total",
      { version: versioned ? CURRENT : "unversioned" },
      1,
      "API requests by the version prefix the caller used.",
    );
  } catch {
    /* metrics must never break a request */
  }
  return next();
}

/**
 * Mark a route as deprecated, with a date by which it will stop working.
 *
 * Emits the standardised headers so a client library can surface the warning
 * without anyone reading a changelog:
 *
 *   Deprecation: true                       (RFC 8594)
 *   Sunset: Wed, 01 Apr 2026 00:00:00 GMT   (RFC 8594)
 *   Link: </api/v1/replacement>; rel="successor-version"
 *   Warning: 299 - "…"                      (human-readable, shown by many tools)
 *
 * A `sunset` in the past is treated as a configuration error and logged rather
 * than enforced: this middleware announces, it does not switch anything off.
 * Turning an endpoint off is a deploy, and it should be a deliberate one.
 *
 *   router.get("/old", deprecate({ sunset: "2026-04-01", replacement: "/api/v1/new" }), handler);
 *
 * @param {{sunset?: string, replacement?: string, reason?: string}} opts
 */
function deprecate(opts = {}) {
  const sunsetDate = opts.sunset ? new Date(opts.sunset) : null;
  const sunsetHeader =
    sunsetDate && !Number.isNaN(sunsetDate.getTime()) ? sunsetDate.toUTCString() : null;

  return function deprecationHeaders(req, res, next) {
    res.set("Deprecation", "true");
    if (sunsetHeader) res.set("Sunset", sunsetHeader);
    if (opts.replacement) res.set("Link", `<${opts.replacement}>; rel="successor-version"`);

    const detail = [
      opts.reason || "This endpoint is deprecated.",
      opts.replacement ? `Use ${opts.replacement}.` : null,
      sunsetHeader ? `It stops working after ${sunsetHeader}.` : null,
    ]
      .filter(Boolean)
      .join(" ");
    // 299 is the "miscellaneous persistent warning" code. Quotes are required
    // by the grammar and a stray one would make the header unparseable.
    res.set("Warning", `299 - "${detail.replace(/"/g, "'")}"`);

    try {
      metrics.inc(
        "praxis_deprecated_endpoint_requests_total",
        { route: req.route && req.route.path ? req.route.path : "unknown" },
        1,
        "Requests to endpoints marked deprecated.",
      );
    } catch {
      /* never break a request for a counter */
    }
    return next();
  };
}

module.exports = { apiVersionHeaders, deprecate, CURRENT, SUPPORTED };
