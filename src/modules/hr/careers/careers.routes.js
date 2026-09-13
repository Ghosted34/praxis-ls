/**
 * Public careers routes — THE ONLY UNAUTHENTICATED TENANT MODULE.
 *
 * There is deliberately no `authMiddleware` and no `requirePermission` in this
 * file, and that absence is the module's defining property rather than an
 * oversight. If you are editing this file, the questions to ask are:
 *
 *   * Does this endpoint return anything a stranger should not see?
 *     (careers.service builds its responses from an allow-list, never a row.)
 *   * Can it be used to enumerate something? (Lookup is by minted token only,
 *     and every refusal is the same 404.)
 *   * Can it be used to fill the disk or the database? (Both writes are rate
 *     limited below and every field is length-bounded in the validator.)
 *
 * The tenant is still resolved — by HOST, upstream in the route table — so
 * `req.tenantDb` is bound to the right workspace. What is missing is only the
 * user.
 *
 * `feature: null`: the careers page must keep answering even for a tenant whose
 * `hr.recruitment` feature is off, because links already in circulation and
 * indexed by search engines outlive a feature flag. An unpublished vacancy
 * 404s, which is the correct way to turn this off.
 */
"use strict";

const express = require("express");
const { makeLimiter } = require("../../../shared/http/rate-limit");
const { asyncHandler } = require("../../../utils/errors");
const service = require("./careers.service");
const validator = require("./careers.validator");

/**
 * Two limits, because the two endpoints are abused differently.
 *
 * Reading is cheap and legitimately repeated — a candidate refreshes, a crawler
 * indexes — so it gets a high ceiling that only catches scraping.
 *
 * Applying writes a row and can write an 8 MB object, so it gets a low one.
 * Five per hour per IP is above any plausible real use (nobody applies to six
 * roles in an hour from one address) and far below what is needed to make a
 * flood worthwhile. Keyed on IP, which is the only identifier that exists here
 * — imperfect, and the honest ceiling rather than a claimed one.
 */
const readLimiter = makeLimiter({ name: "careers-read", max: 120, windowMs: 15 * 60 * 1000 });
const applyLimiter = makeLimiter({ name: "careers-apply", max: 5, windowMs: 60 * 60 * 1000 });
// An address and a name, no file. Cheaper than an application and more
// plausibly repeated — a household behind one NAT address, somebody signing up
// from a phone and then a laptop — so the ceiling is higher than applying and
// far below anything worth a flood.
const alertLimiter = makeLimiter({ name: "careers-alert", max: 20, windowMs: 60 * 60 * 1000 });

const router = express.Router();

// PINNED, because the comment below says "live-only" and `req.tenantDb` does
// not deliver that: it resolves the environment from the `X-Praxis-Env` header,
// and on a route with no session the sender of that header is the visitor. A
// stranger could ask the shop window for the sandbox schema's vacancies.
// `req.tenantDbIn` is the mechanism this module's own token routes use.
router.get("/", readLimiter, asyncHandler(async (req, res) =>
  res.json({ data: await req.tenantDbIn("live", (c) => service.list(c)) })));

// These two take `req`, not a client, because they choose their own
// environment: the token says which schema the role lives in (see
// careers.service.findByToken). The index above does not — the shop window is
// live-only.
router.get("/:token", readLimiter, asyncHandler(async (req, res) =>
  res.json({ data: await service.get(req, req.params.token) })));

router.post("/:token/apply", applyLimiter, validator.apply, asyncHandler(async (req, res) =>
  res.status(201).json({
    data: await service.applyToToken(req, { token: req.params.token, data: req.body, slug: req.tenant.slug }),
  })));

/* ── The page when nothing is open (13792) ──────────────────────────────────
 *
 * Every route below is declared AFTER `/:token`, and none of them collides with
 * it: `/:token` is a GET on one segment and `/:token/apply` a POST on two, so
 * `POST /settings` and `POST /alerts` share a shape with neither. It is worth
 * stating rather than trusting, because the day somebody adds `GET /alerts` it
 * WOULD be shadowed by `GET /:token` above and would 404 for a reason nothing
 * in this file explains.
 */

/** What the page may offer. Two booleans and a tag — see publicSettings. */
router.get("/settings/public", readLimiter, asyncHandler(async (req, res) =>
  res.json({ data: await service.publicSettings(req) })));

/**
 * A CV with no role attached. 201 and a reference, like applying to a role —
 * the candidate did the same amount of work and is owed the same receipt.
 */
router.post("/open-application", applyLimiter, validator.openApplication, asyncHandler(async (req, res) =>
  res.status(201).json({
    data: await service.applyOpen(req, { data: req.body, slug: req.tenant.slug }),
  })));

/** Tell me when something opens. */
router.post("/alerts", alertLimiter, validator.alert, asyncHandler(async (req, res) =>
  res.status(201).json({ data: await service.subscribeAlert(req, { data: req.body }) })));

/**
 * Stop telling me.
 *
 * A POST and not a GET, though it arrives from a link in an email: a mail
 * client that prefetches links would unsubscribe somebody who never clicked.
 * The link opens a page on the site, which posts this — and the page is
 * reachable with the token in the URL, which is why the token is 32 CSPRNG
 * bytes and not the address.
 */
router.post("/alerts/unsubscribe/:token", alertLimiter, validator.unsubscribe, asyncHandler(async (req, res) =>
  res.json({ data: await service.unsubscribeAlert(req, req.params.token) })));

// `idParam: "text"` — :token is a base64url string, not a uuid or a number, so
// the loader's id guard would reject every real request.
module.exports = { basePath: "/careers", feature: null, idParam: "text", router };
