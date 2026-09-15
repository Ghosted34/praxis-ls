"use strict";

const service = require("./document_verification.service");
const { asyncHandler } = require("../../../utils/errors");

module.exports = {
  /**
   * Resolve a printed code.
   *
   * ⚠ `req.tenantDbIn(env, …)`, NEVER `req.tenantDb`.
   *
   * `req.tenantDb` resolves the environment from the `X-Praxis-Env` header —
   * which, on a route with no session, means the anonymous visitor chooses it.
   * A stranger sending `X-Praxis-Env: sandbox` would read the tenant's SANDBOX
   * signatures, which is both a disclosure and a way to have a forged document
   * "verify" against test data. The environment a request runs in is a
   * signed-in user's choice, not the internet's — and, for this route, a
   * printed URL's fixed value, not a live header the caller can flip.
   *
   * ── The `?e=sandbox` URL, and why it is safe here ────────────────────────
   * The env is taken from the URL's own `e` query, which was baked in at PDF
   * render time by our own code (services/signatures/verify-link.js). It is not
   * a runtime signal a caller can flip mid-session: a forged URL with
   * `?e=sandbox` is neither a disclosure nor a forgery — it lets a stranger
   * hit our sandbox rate limiter looking for real codes, and the same
   * 60-per-15-minutes limiter that already guarded the live path guards this
   * one too. The `test_environment: true` marker the service adds to the
   * response is what tells the page to say so.
   *
   * proposal_public.routes.js carries the same pin for the same reason, and
   * §5.8 criterion 7 is the test.
   */
  resolve: asyncHandler(async (req, res) => {
    const env = req.validatedQuery.e === "sandbox" ? "sandbox" : "live";
    const data = await req.tenantDbIn(env, (c) => service.resolve(c, {
      code: req.validatedParams.code,
      via: req.validatedQuery.via,
      lang: req.validatedQuery.lang,
      env,
      // §3.13: captured from the connection, never from the body or a header a
      // caller controls. `req.ip` is the address nginx actually saw — server.js
      // sets a trust-proxy HOP COUNT rather than `true`, which is what stops a
      // client rotating its own rate-limit key with a forged X-Forwarded-For.
      ip: req.ip,
      userAgent: req.get("user-agent") || null,
      referrer: req.get("referer") || null,
    }));
    // A verification page must not be cached by a proxy: the verdicts are
    // recomputed per request precisely because a document can be amended or
    // revoked after it was printed, and a cached "valid" outlives both.
    res.set("Cache-Control", "no-store");
    res.json({ data });
  }),
};
