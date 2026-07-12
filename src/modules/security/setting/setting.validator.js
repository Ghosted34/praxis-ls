"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const schemas = { put: z.object({ value: z.any() }) };
const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data; return next();
};
module.exports = { put: mw("put"), schemas };
