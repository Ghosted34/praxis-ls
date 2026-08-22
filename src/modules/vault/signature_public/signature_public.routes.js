/**
 * The public signing page (MOD-64) — doc/SIGNATURE_ENGINEERING_GUIDE.md §6.6.
 *
 * No auth anywhere in this file, deliberately: the counterparty is a stranger
 * with no account, on a phone, holding a link. Three things make that safe.
 *
 * 1. THE TOKEN IS THE CREDENTIAL, AND IT IS PEPPERED. 32 random bytes,
 *    HMAC-SHA256 under a server-side pepper, plaintext emailed once and never
 *    stored (§3.7). Unlike the verify code, a leaked sign token IS a forged
 *    signature — which is exactly why the two credentials are stored
 *    differently rather than uniformly.
 *
 * 2. THE LIMITER, KEYED ON THE TOKEN AND NOT THE IP. §6.4 is specific about
 *    this: a counterparty behind a corporate NAT must not be rate-limited by a
 *    colleague signing a different document from the same office. IP-keying
 *    would make a busy client's second signatory look like an attacker.
 *
 * 3. THE LIVE PIN, in the controller. A visitor must not pick the environment.
 *
 * The limits themselves are deliberately asymmetric. `signature-otp` is 10 per
 * 15 minutes because sending a code is the expensive, abusable action — it
 * puts mail in somebody's inbox. Reading the page and submitting the form are
 * cheap and idempotent-ish, so they sit on a looser limiter that exists to
 * stop enumeration rather than to police a signer who reloaded twice.
 */
"use strict";

const express = require("express");
const { makeLimiter } = require("../../../shared/http/rate-limit");
const controller = require("./signature_public.controller");
const validator = require("./signature_public.validator");

const router = express.Router();

/**
 * Keyed on the signing token.
 *
 * `express-rate-limit` keys on IP by default, and `req.params` is not
 * populated when the limiter runs at the router level — so the key is read off
 * the path directly. Falls back to the IP when there is no token in the path,
 * which is the shape a scanner probing `/public/sign` produces.
 */
const byToken = (req) => {
  const [, token] = String(req.path || "").split("/");
  return token ? `t:${token}` : `ip:${req.ip}`;
};

const otpLimit = makeLimiter({
  name: "signature-otp", max: 10, windowMs: 15 * 60 * 1000, keyGenerator: byToken,
});
const pageLimit = makeLimiter({
  name: "signature-sign", max: 60, windowMs: 15 * 60 * 1000, keyGenerator: byToken,
});

router.get("/:token", pageLimit, validator.params, controller.resolve);
router.get("/:token/document", pageLimit, validator.params, controller.document);

router.post("/:token/otp", otpLimit, validator.params, validator.otpBody, controller.sendOtp);
router.post("/:token/verify", otpLimit, validator.params, validator.verifyBody, controller.verifyOtp);
router.post("/:token/complete", pageLimit, validator.params, validator.completeBody, controller.complete);
router.post("/:token/decline", pageLimit, validator.params, validator.declineBody, controller.decline);

module.exports = {
  basePath: "/public/sign",
  feature: "signatures.external",
  // `text`, not the default uuid: the token is base64url, deliberately not an
  // internal identifier. Same declaration proposal_public makes.
  idParam: "text",
  router,
};
