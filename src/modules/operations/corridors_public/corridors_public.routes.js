"use strict";

/**
 * `GET /public/corridors` — anonymous, and therefore pinned to LIVE
 * (`req.tenantDbIn("live", …)`) so an internet caller cannot select a tenant
 * environment through `X-Praxis-Env`. Same shape as `portfolio_public` and
 * `service_type_web_public`, and mounted the same way: the loader walks
 * `src/modules/<group>/<module>/<module>.routes.js` and gates this one on
 * `feature: "website"`, so a tenant without the website package answers
 * FEATURE_DISABLED (403) rather than leaking an operational aggregate.
 *
 * One route, no media, no parameters. The rate limit matches the other public
 * JSON reads at 120/15min: this is one query per page view, it holds no bytes
 * open, and the aggregate is cheap enough that the limiter exists to bound
 * abuse rather than to protect the plan.
 */

const express = require("express");
const { makeLimiter } = require("../../../shared/http/rate-limit");
const { asyncHandler } = require("../../../utils/errors");
const service = require("./corridors_public.service");

const router = express.Router();
const limit = makeLimiter({ name: "corridors-public", max: 120, windowMs: 15 * 60 * 1000 });

router.get("/", limit, asyncHandler(async (req, res) => res.json({
  data: await req.tenantDbIn("live", (client) => service.corridors(client)),
})));

module.exports = { basePath: "/public/corridors", feature: "website", idParam: "text", router };
