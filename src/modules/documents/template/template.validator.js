"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const setConfig = z.object({
  entity_id: z.string().uuid().nullish(),
  config: z.record(z.string(), z.any()).optional(),
});
const preview = z.object({
  entity_id: z.string().uuid().nullish(),
  record_id: z.string().uuid().nullish(),
  config: z.record(z.string(), z.any()).optional(),
});
const sendDoc = z.object({
  to: z.string().email(),
  subject: z.string().optional(),
  entity_id: z.string().uuid().nullish(),
});
const schemas = { setConfig, preview, sendDoc };

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = { setConfig: mw("setConfig"), preview: mw("preview"), sendDoc: mw("sendDoc"), schemas };
