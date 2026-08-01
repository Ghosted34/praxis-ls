"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

/**
 * Manual creation of a place. `source` is forced to MANUAL by the service — a
 * hand-entered coordinate must never be recorded as if a provider returned it,
 * because `resolveMany` treats MANUAL rows as corrections that a later geocode
 * must not overwrite.
 */
const create = z.object({
  name: z.string().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  country: z.string().length(2).optional(),
  kind: z.enum(["SEAPORT", "AIRPORT", "CITY", "INLAND", "OTHER"]).optional(),
});

const schemas = { create };
const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = { create: mw("create"), schemas };
