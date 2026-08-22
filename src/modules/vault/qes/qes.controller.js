"use strict";

const service = require("./qes.service");
const { asyncHandler } = require("../../../utils/errors");

const lang = (req) => (req.validatedQuery && req.validatedQuery.lang) || "fr";

module.exports = {
  /**
   * The dispatch confirmation's pre-flight (§7.4 step 1).
   *
   * It reports — flag state, configuration, the doc-type ceiling — and the
   * UI renders the one informational line that survives Round 2. It does not
   * block: there is no fee to confirm and no 424 to throw, and a dispatch
   * with the provider unconfigured settles its answer at the handoff, where
   * the counterparty can act on it.
   */
  quote: asyncHandler(async (req, res) => {
    const data = await req.tenantDb((c) => service.quote(c, {
      docType: (req.validatedQuery && req.validatedQuery.doc_type) || null,
      language: lang(req),
    }));
    res.json({ data });
  }),

  /**
   * The Settings panel's read-only usage view (§3.11 panel 4, §7.5):
   * provider state and this tenant's monthly envelope count, and nothing
   * more — the unit figure is the platform's number, not the tenant's.
   */
  usage: asyncHandler(async (req, res) => {
    const data = await req.tenantDb((c) => service.usage(c, { language: lang(req) }));
    res.json({ data });
  }),
};
