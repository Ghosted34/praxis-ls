"use strict";
const { countries } = require("@praxis/shared");
const { asyncHandler, AppError } = require("../../../utils/errors");

/** Attach the jurisdiction's registration requirements to a country row. */
const withReqs = (c) => ({ ...c, registration_requirements: countries.requirementsFor(c.code) });

module.exports = {
  // Full ISO list, priority-ordered (CEMAC/OHADA + major lanes first), each with
  // its calling code, currency and registration requirements — everything the
  // Smart Country Picker and the registration forms need in one call.
  list: asyncHandler(async (_req, res) => res.json({ data: countries.CATALOGUE.map(withReqs) })),
  get: asyncHandler(async (req, res) => {
    const c = countries.byCode(req.params.code);
    if (!c) throw new AppError("NOT_FOUND", "Unknown country code", 404);
    res.json({ data: withReqs({ ...c, sort_order: countries.sortOrder(c.code) }) });
  }),
};
