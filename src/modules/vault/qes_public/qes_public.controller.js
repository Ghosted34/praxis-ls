"use strict";

const service = require("./qes_public.service");
const { asyncHandler } = require("../../../utils/errors");

/**
 * ⚠ EVERY HANDLER READS THROUGH `req.tenantDbIn("live", …)`, NEVER
 * `req.tenantDb` — for the reason the public signing page and the
 * verification portal record: the environment is a signed-in user's choice,
 * not the internet's, and the callback URL registered with the provider is a
 * LIVE URL, so the data it settles is the live data.
 */
const live = (req, fn) => req.tenantDbIn("live", fn);

module.exports = {
  webhook: asyncHandler(async (req, res) => {
    // The RAW body, in the order the stack provides it:
    //   1. req.rawBody — stashed by server.js's global JSON parser verify
    //      callback (the bytes exactly as delivered, for application/json);
    //   2. req.body as a string — the route-level express.text, for a
    //      non-JSON content type the global parser skipped;
    //   3. nothing — a parsed object with no raw form, which the signature
    //      check refuses rather than guessing at re-serialisation.
    // Re-serialising req.body is deliberately NOT an option: JSON.stringify
    // does not reproduce the delivered bytes (key order, number formatting,
    // Unicode escaping), and the signature covers what was sent.
    const rawBody =
      req.rawBody ||
      (typeof req.body === "string" && req.body.length > 0 ? req.body : null);

    const out = await live(req, (c) => service.handleWebhook(c, {
      provider: req.provider,
      rawBody,
      headers: req.headers,
      slug: (req.tenant && req.tenant.slug) || null,
      tenantName: (req.tenant && req.tenant.name) || "",
    }));

    // 200 for everything the signature authenticated — including "not ours"
    // and "already settled". The provider retries until it gets 2xx, and an
    // event that is genuinely ours-but-already-settled is exactly the one
    // that must not be retried: criterion 5 is true because the handler is
    // idempotent AND because the provider is told the work is done.
    res.json({ ok: true, ignored: Boolean(out && out.ignored) });
  }),
};
