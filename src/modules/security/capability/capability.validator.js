"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const { passthrough } = require("../../../shared/http/validate");

// Assignment body: a plain list of capability_ids (blanket authority). An empty
// array is valid — it clears the user's blanket capabilities.
const setForUser = z.object({ capability_ids: z.array(z.string().uuid()) });

const mw = (schema) => (req, _res, next) => {
  const p = schema.safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = { ...passthrough, setForUser: mw(setForUser) };
