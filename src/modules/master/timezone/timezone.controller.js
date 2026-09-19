// ai:none — universal reference data from @praxis/shared (no service, no repo, no tenant rows), and its routes carry NO requirePermission BY DESIGN: gating the IANA timezone list behind one master module would lock the other side's users out of their own picker. `services/ai/action-authz` fails CLOSED on a null required_permission, so a manifest here would advertise actions the runtime refuses, and picking a grant instead would enforce a DIFFERENT rule on the AI path from the HTTP one — which that file calls worse than enforcing none. The copilot gets this vocabulary through the modules that use it.
"use strict";
const { timezones, countries } = require("@praxis/shared");
const { asyncHandler, AppError } = require("../../../utils/errors");

/** Add a human country name without duplicating the country catalogue. */
const present = (zone) => ({
  ...zone,
  country_name: zone.country_code
    ? (countries.byCode(zone.country_code) || {}).name || null
    : null,
});

module.exports = {
  // Universal reference data. The client picker bundles the same list for
  // instant/offline use; this endpoint gives integrations and future clients an
  // authoritative discovery surface rather than inviting free-text values.
  list: asyncHandler(async (_req, res) =>
    res.json({
      data: timezones.CATALOGUE.map(present),
      meta: {
        tzdb_version: timezones.TZDB_VERSION,
        count: timezones.CATALOGUE.length,
      },
    }),
  ),
  get: asyncHandler(async (req, res) => {
    const zone = timezones.byId(decodeURIComponent(req.params[0] || ""));
    if (!zone) throw new AppError("NOT_FOUND", "Unknown timezone", 404);
    res.json({ data: present(zone) });
  }),
};
