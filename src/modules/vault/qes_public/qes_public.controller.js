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
    const out = await live(req, (c) => service.handleWebhook(c, {
      provider: req.provider,
      rawBody: req.body,
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
