/**
 * `POST /api/client-errors` — the browser's way to report a crash.
 *
 * Audit OBS-E2 (Critical): frontend errors were completely invisible. The
 * client had an ErrorBoundary with an `onError` hook that went nowhere, and
 * nothing at all listened for `window.onerror` or unhandled promise
 * rejections. A user hitting a white screen produced no record anywhere — the
 * only signal was them telling somebody.
 *
 * DELIBERATE CHOICES
 *
 *   Unauthenticated. Most of the errors worth catching happen on the login
 *   screen, during boot, or after a session expires — exactly when there is no
 *   token. Requiring auth would blind the endpoint to the crashes that matter
 *   most. It is rate limited instead.
 *
 *   Rate limited hard. An open POST endpoint that fans out to an alert channel
 *   is an abuse vector: 30/min/IP here, and the reporter itself caps outbound
 *   notifications at 20/min globally with dedupe on top. Two independent
 *   ceilings, because either alone can be worked around.
 *
 *   Payload is clamped and never trusted. Strings are truncated, unknown keys
 *   dropped. The body reaches an alert channel a human reads, so it is treated
 *   as hostile input.
 *
 *   Always answers 204. A reporting endpoint that returns an error teaches the
 *   client to retry, and a retry storm on the path that handles crashes is the
 *   last thing anyone needs.
 */

"use strict";

const express = require("express");
const { config } = require("../config/env");
const { report } = require("../shared/observability/error-reporter");
const { makeLimiter } = require("../shared/http/rate-limit");

const router = express.Router();

/** Browser crash reports. Generous enough for a genuinely broken page. */
const clientErrorLimiter = makeLimiter({ name: "client-errors", max: 30, windowMs: 60_000 });

const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : undefined);

/**
 * Errors thrown by the USER'S BROWSER EXTENSIONS, which are not our software.
 *
 * A page that loads a wallet extension gets its content scripts injected into
 * the same window, sharing one `window.onerror`. So this endpoint faithfully
 * received things like
 *
 *   TypeError: Cannot redefine property: ethereum
 *     at chrome-extension://bfnaelmomeimhlpmgjnjophhpkkoljpa/evmAsk.js:15
 *
 * — two crypto wallets fighting over `window.ethereum`, filed against Praxis.
 * It is unactionable by construction: the code is not ours, we cannot fix it,
 * and the user population is unbounded. Left in, the feed fills with whatever
 * its readers happen to have installed, and the signal-to-noise problem that
 * gets a monitoring tool abandoned starts on day one.
 *
 * Dropped SILENTLY and counted nowhere. A rejected report is not an error
 * either, and this endpoint answers 204 regardless — see the response above.
 *
 * Deliberately narrow: it matches the extension URL SCHEMES only. Anything that
 * merely mentions an extension in passing, or a same-origin script that an
 * extension happened to trigger, still reports — those can be real.
 */
const EXTENSION_SCHEME = /\b(chrome|moz|safari|safari-web|ms-browser)-extension:\/\//i;

function fromBrowserExtension(b) {
  return EXTENSION_SCHEME.test(String(b.stack || "")) || EXTENSION_SCHEME.test(String(b.filename || ""));
}

const hostOnly = (v) => String(v || "").toLowerCase().split(":")[0].trim();

/**
 * Which tenant does this crash belong to?
 *
 * This endpoint is mounted at server.js:175, BEFORE the tenant routes, so
 * `req.tenant` is never populated — which meant every browser error from every
 * tenant was stored with `tenant_id = NULL` and rendered as **Platform-wide**.
 * Spec §4.1's scope filter was therefore useless for the entire browser half of
 * the feed: `/master/suppliers`, plainly a tenant screen, filed under the
 * platform.
 *
 * SYNCHRONOUS, AND NO DATABASE. This first used `registry.resolveByHost`, which
 * is the "proper" lookup — it consults `platform.subdomain` and so handles
 * custom domains. It was the wrong call, and the test suite said so before
 * production could: reports started arriving a test LATE, because every crash
 * report was now waiting on a platform-DB round trip.
 *
 * That is a bad dependency to add HERE of all places. This is the error path.
 * It has to keep working when the platform database is slow, saturated or
 * unreachable — which is exactly the incident during which browser errors
 * matter most. Making capture wait on a query means the one thing that could
 * tell you the database is in trouble is itself blocked on the database.
 *
 * The subdomain label IS the slug for every standard host
 * (`smartls.praxisls.com` → `smartls`), so deriving it is a string operation.
 * A custom domain derives the wrong label — and that is safe, because the
 * store's UPSERT resolves the slug with
 * `(SELECT tenant_id FROM platform.tenant WHERE slug = $1)`, so an unknown slug
 * yields NULL and the error lands platform-wide. The failure mode is "loses
 * attribution", never "loses the error" or "attributes to the wrong tenant".
 *
 * THE SPOOFING TRADE, STATED RATHER THAN GLOSSED.
 *
 *   The endpoint is unauthenticated BY DESIGN — a page that has just crashed
 *   has no token to present — so Host is attacker-controlled. Someone could
 *   POST with a forged Host and file noise into another tenant's error scope.
 *   The blast radius is mislabelled ROWS: no data is read, no capability
 *   changes, and the limiter already caps it at 30/min.
 *
 *   The `Origin` cross-check closes it for anything that is actually a browser.
 *   Browsers always send Origin on a cross-site POST, and Chromium sends it on
 *   same-site POST too, so a real page reporting a real crash passes. When
 *   Origin is present and disagrees with Host, we DECLINE to attribute rather
 *   than trust the header — the error is still captured, just platform-wide,
 *   which is where an unattributable error belongs.
 *
 * Never throws: attribution is a nicety and losing it must not lose the error.
 */
function tenantSlugFor(req) {
  try {
    const host = hostOnly(req.headers.host);
    if (!host) return null;

    const origin = req.headers.origin;
    if (origin && hostOnly(new URL(origin).hostname) !== host) return null;

    const base = String(config.APP_BASE_DOMAIN || "").toLowerCase();
    if (!base || host === base || !host.endsWith("." + base)) return null;

    const label = host.slice(0, -(base.length + 1));
    // Only a single leftmost label is a tenant host. `a.b.praxisls.com` is not
    // one, and guessing at it would attribute to a slug nobody owns.
    if (!label || label.includes(".")) return null;
    return label;
  } catch {
    return null;
  }
}

router.post("/client-errors", clientErrorLimiter, express.json({ limit: "64kb" }), (req, res) => {
  // Answer first. Reporting is best-effort and must not hold the browser open
  // while a webhook round-trips.
  res.status(204).end();

  const b = req.body || {};
  if (fromBrowserExtension(b)) return;

  const message = str(b.message, 500) || "unknown client error";
  const err = new Error(message);
  err.name = str(b.name, 100) || "ClientError";
  err.stack = str(b.stack, 4000) || undefined;

  report(err, {
    origin: "browser",
    severity: b.fatal === true ? "fatal" : "error",
    route: str(b.route, 300),
    tenant: tenantSlugFor(req),
    request_id: req.request_id,
    extra: {
      kind: str(b.kind, 40),                 // render | window | unhandledrejection
      component_stack: str(b.componentStack, 2000),
      user_agent: str(req.headers["user-agent"], 300),
      url: str(b.url, 500),
      app_release: str(b.release, 100),
    },
  });
});

module.exports = { router };
