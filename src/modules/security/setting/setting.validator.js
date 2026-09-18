"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const put = z.object({ value: z.any() });
// AI-facing: section/key are in the URL for HTTP, in the payload for the copilot.
const aiPut = put.extend({ section: z.string().min(1).max(64), key: z.string().min(1).max(64) });
const schemas = { put, aiPut };
const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data; return next();
};
module.exports = { put: mw("put"), schemas };
