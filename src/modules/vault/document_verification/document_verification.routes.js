/**
 * The public verification portal (MOD-66) — doc/SIGNATURE_ENGINEERING_GUIDE.md
 * §5.2, §5.4.
 *
 * ── `/v`, and why the path length is a design constraint ───────────────────
 * This path is printed on paper, inside a QR that has 22 mm to live in and has
 * to survive a photocopier, a fax and a phone camera in a badly-lit warehouse.
 * §3.7 measured it: `https://{host}/v/{12-char code}` is 40 characters and
 * needs a 33-module symbol — 0.67 mm per module. The same code under the old
 * `/public/verify/` prefix is 52 characters, which costs a whole QR version
 * and drops to 0.59 mm; the original long-token design sat at 0.49 mm, right on
 * the threshold a phone needs, before anything touched it.
 *
 * So `/v` is not a stylistic short path. Lengthening it degrades a printed
 * artefact that cannot be re-issued. (The same measurement showed a dedicated
 * `verify.` HOST buys nothing further — 38 and 40 characters land in the same
 * QR version — so no domain needs provisioning.)
 *
 * ── Three things make this safe to leave open ──────────────────────────────
 * 1. THE LIMITER. `verify_code` is 12 Crockford characters = 2^60, which is
 *    adequate ONLY with rate limiting — and since the code is stored in
 *    plaintext (§3.7, Round 2), this limiter is the SOLE defence against
 *    enumeration. It is load-bearing, not decoration. 60 per IP per 15 minutes:
 *    generous for the one or two lookups a real visitor makes, and 2^60 codes
 *    at that rate is not a search anyone finishes.
 * 2. THE LIVE PIN. In the controller — a visitor must not pick the environment.
 * 3. ONE ANSWER FOR UNKNOWN. In the service — malformed and never-existed are
 *    indistinguishable, so the endpoint is not an oracle.
 *
 * There is deliberately no `authMiddleware` anywhere in this file. The whole
 * point is that a stranger holding a document can check it without an account,
 * without asking us, and without the tenant knowing who they are.
 */
"use strict";

const express = require("express");
const { makeLimiter } = require("../../../shared/http/rate-limit");
const controller = require("./document_verification.controller");
const validator = require("./document_verification.validator");

const router = express.Router();

const limit = makeLimiter({ name: "signature-verify", max: 60, windowMs: 15 * 60 * 1000 });

// GET /v/:code — the QR target, and what /verify's manual-entry form submits to.
// A single route serves both: `?via=CODE` tells the scan log the visitor typed
// it rather than scanned it, which is the difference between a document checked
// at a border post and one read down a phone line.
router.get("/:code", limit, validator.validate, controller.resolve);

module.exports = {
  basePath: "/v",
  feature: "signatures.portal",
  // `text`, not the default uuid: `:code` is a 12-character Crockford string.
  // Declaring it stops the loader's id-param convention from asserting a uuid
  // shape on a credential that is deliberately not one (same as
  // proposal_public, whose `:token` is a signed string).
  idParam: "text",
  router,
};
