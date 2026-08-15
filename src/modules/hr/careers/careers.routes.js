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

const router = express.Router();

router.get("/", readLimiter, asyncHandler(async (req, res) =>
  res.json({ data: await req.tenantDb((c) => service.list(c)) })));

router.get("/:token", readLimiter, asyncHandler(async (req, res) =>
  res.json({ data: await req.tenantDb((c) => service.get(c, req.params.token)) })));

router.post("/:token/apply", applyLimiter, validator.apply, asyncHandler(async (req, res) =>
  res.status(201).json({
    data: await req.tenantDb((c) => service.apply(c, { token: req.params.token, data: req.body, slug: req.tenant.slug })),
  })));

// `idParam: "text"` — :token is a base64url string, not a uuid or a number, so
// the loader's id guard would reject every real request.
module.exports = { basePath: "/careers", feature: null, idParam: "text", router };
