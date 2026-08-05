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
const { report } = require("../shared/observability/error-reporter");
const { makeLimiter } = require("../shared/http/rate-limit");

const router = express.Router();

/** Browser crash reports. Generous enough for a genuinely broken page. */
const clientErrorLimiter = makeLimiter({ name: "client-errors", max: 30, windowMs: 60_000 });

const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : undefined);

router.post("/client-errors", clientErrorLimiter, express.json({ limit: "64kb" }), (req, res) => {
  // Answer first. Reporting is best-effort and must not hold the browser open
  // while a webhook round-trips.
  res.status(204).end();

  const b = req.body || {};
  const message = str(b.message, 500) || "unknown client error";
  const err = new Error(message);
  err.name = str(b.name, 100) || "ClientError";
  err.stack = str(b.stack, 4000) || undefined;

  report(err, {
    origin: "browser",
    severity: b.fatal === true ? "fatal" : "error",
    route: str(b.route, 300),
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
