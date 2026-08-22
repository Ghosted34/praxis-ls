/**
 * The QES provider webhook (MOD-64) — doc/SIGNATURE_ENGINEERING_GUIDE.md
 * §7.4 step 5.
 *
 * No auth anywhere in this file, deliberately: the caller is the provider,
 * and the credential is the signature on the event, not a session. Three
 * things make that safe — the same three as the public signing page.
 *
 * 1. THE SIGNATURE IS VERIFIED BEFORE THE BODY IS TRUSTED. The check runs on
 *    the RAW body (the provider's documented scheme signs the event type and
 *    time, so the raw text is what the adapter receives and what it checks —
 *    see signwell.adapter.verifyWebhook), and a failure answers 401 with
 *    nothing from the body in the log (§7.6 criterion 4).
 *
 *    How the raw body arrives: `src/server.js` mounts `express.json()`
 *    GLOBALLY before this router, and its `verify` callback stashes the
 *    untouched bytes on `req.rawBody`. That is the only place it can happen —
 *    a route-level text parser behind the global one never runs, because
 *    body-parser sets `req._body` once it has parsed and every downstream
 *    body parser bails on that flag (the audit that found this: every
 *    genuine delivery 401'd because the route only ever saw a parsed
 *    object). The route-level `express.text` below is kept for the case the
 *    provider posts a non-JSON content type, which the global parser skips;
 *    the controller reads `req.rawBody` first, then `req.body` when it is a
 *    string, and refuses anything else.
 *
 * 2. THE LIMITER, keyed on IP. The provider's egress is a small set of
 *    addresses, and a scanner hitting this endpoint is not a provider — the
 *    key is the address, and the limit is generous enough for a real burst
 *    of completions and tight enough that enumeration is not the point of
 *    trying.
 *
 * 3. THE LIVE PIN, in the controller. A visitor must not be able to send
 *    `X-Praxis-Env: sandbox` and settle a chain in the sandbox while the
 *    provider works on the live document — or vice versa. The callback URL
 *    is a live URL (it is the one registered with the provider), and the
 *    data it settles is the live data.
 *
 * ── Why this module is NOT feature-gated ───────────────────────────────────
 * The flag gates the ACTION, not the RECEIPT: it stops a handoff from
 * starting, and the menu from offering the card. It must not stop an event
 * about an envelope that was started when the flag was on — flip the flag
 * mid-flight and a gated webhook would 403 the provider's retries for the
 * life of the retry window while the poll backstop settles the envelope in
 * silence, and the provider keeps knocking on a door that will never open.
 * The security is the signature, the limiter and the tenant-scoped lookup;
 * the flag adds nothing to any of them.
 *
 * The body must reach the check as RAW TEXT: a JSON parser middleware that
 * normalises key order or encodings would change the bytes the signature
 * covers. For the JSON case that now happens in server.js's verify callback
 * (see point 1 above); this express.text is the non-JSON leg, with a
 * generous limit (a completed document's event carries the document shape,
 * and a multi-recipient document is not small).
 */
"use strict";

const express = require("express");
const { makeLimiter } = require("../../../shared/http/rate-limit");
const controller = require("./qes_public.controller");
const validator = require("./qes_public.validator");

const router = express.Router();

const webhookLimit = makeLimiter({ name: "qes-webhook", max: 60, windowMs: 15 * 60 * 1000 });

// `:provider` is a literal discriminator, not a free-text id — but the
// loader's id guard does not touch :provider (it is on the not-guarded list),
// and the controller refuses any value that is not a registered adapter.
router.post(
  "/:provider/webhook",
  webhookLimit,
  express.text({ type: ["application/json", "text/plain"], limit: "1mb" }),
  validator.providerParam,
  controller.webhook,
);

module.exports = {
  basePath: "/public/qes",
  feature: null, // see the header: the flag gates the action, not the receipt
  router,
};
