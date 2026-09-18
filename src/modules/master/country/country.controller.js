// ai:none — universal reference data from @praxis/shared (no service, no repo, no tenant rows), and its routes carry NO requirePermission BY DESIGN: gating the ISO country list behind one master module would lock the other side's users out of their own picker. `services/ai/action-authz` fails CLOSED on a null required_permission, so a manifest here would advertise actions the runtime refuses, and picking a grant instead would enforce a DIFFERENT rule on the AI path from the HTTP one — which that file calls worse than enforcing none. The copilot gets this vocabulary through the modules that use it.
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
