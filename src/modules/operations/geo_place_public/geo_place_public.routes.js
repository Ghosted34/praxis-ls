"use strict";

/**
 * `GET /api/tenant/public/places` — the quote wizard's place picker.
 *
 * ── NOT PINNED TO LIVE, BECAUSE IT READS NO TENANT DATA ───────────────────
 *
 * Every other public module in this codebase carries the `req.tenantDbIn("live",
 * …)` note, because `req.tenantDb` takes the environment from a header an
 * anonymous caller controls. This route never opens a database connection at
 * all: the answer comes from Geoapify and is public geography. There is no
 * schema for a visitor to select, which is a stronger version of the same
 * guarantee rather than an exception to it.
 *
 * ── THE RATE LIMIT IS THE WHOLE SECURITY MODEL ────────────────────────────
 *
 * A key we pay for sits behind this. 60 per 15 minutes per connection is
 * generous for a person typing two place names into a wizard — autocomplete
 * fires on a debounce, not per keystroke — and small enough that the free
 * tier's 3,000/day survives somebody pointing a script at it. The provider's
 * own quota is the backstop: when it is gone, `search` answers UNAVAILABLE and
 * the wizard falls back to plain text, so an exhausted quota costs a nicety and
 * never a submission.
 *
 * `feature: null`: the quote form works for a tenant whose `website` package is
 * off, because `public_intake` does, and a picker that 403s beside a form that
 * posts would be the odd one out.
 */

const express = require("express");
const { makeLimiter } = require("../../../shared/http/rate-limit");
const { asyncHandler } = require("../../../utils/errors");
const service = require("./geo_place_public.service");
const validator = require("./geo_place_public.validator");

const router = express.Router();
const limit = makeLimiter({
  name: "places-public",
  max: 60,
  windowMs: 15 * 60 * 1000,
});

router.get(
  "/",
  limit,
  validator.search,
  asyncHandler(async (req, res) => {
    const { q, country, limit: max } = req.validatedQuery;
    res.json({ data: await service.search(q, { country: country || null, limit: max }) });
  }),
);

module.exports = { basePath: "/public/places", feature: null, router };
