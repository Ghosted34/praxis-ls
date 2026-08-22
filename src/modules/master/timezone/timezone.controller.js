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
