/**
 * QES webhook validator.
 *
 * One job: refuse a `:provider` that is not a registered adapter BEFORE the
 * body is touched. A 404, not a 422 — a public endpoint should not
 * advertise which providers exist, and an unknown name is a "nothing here"
 * as far as the wire is concerned.
 *
 * The body itself is deliberately NOT schema-validated here: it is
 * signature-verified first (see the routes header), and validating the shape
 * of an untrusted event before the signature question would be the wrong
 * order for exactly the reason §7.4 step 5 exists.
 */
"use strict";

const { AppError } = require("../../../utils/errors");

module.exports = {
  providerParam: (req, _res, next) => {
    const provider = String(req.params.provider || "").toLowerCase();
    if (!provider || !qesADapters().has(provider)) {
      return next(new AppError("NOT_FOUND", "No such provider endpoint.", 404));
    }
    req.provider = provider;
    return next();
  },
};

// Lazy: the adapter registry is a service, and a validator that requires it
// at module load participates in the load order it does not care about.
let adapters = null;
function qesADapters() {
  if (!adapters) {
    adapters = require("../../../services/qes").ADAPTERS;
  }
  return adapters;
}
