"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const setConfig = z.object({
  entity_id: z.string().uuid().nullish(),
  config: z.record(z.string(), z.any()).optional(),
});
/**
 * The language ONE render comes out in, chosen by the operator at print time.
 *
 * An enum, not a free string: it lands in `cfg.language`, which themes the
 * whole stylesheet, and the two supported document languages are the two the
 * templates carry copy for. Optional — omitted means "use what the tenant
 * configured for this doc type".
 */
const docLanguage = z.enum(["fr", "en"]).nullish();

const preview = z.object({
  entity_id: z.string().uuid().nullish(),
  record_id: z.string().uuid().nullish(),
  config: z.record(z.string(), z.any()).optional(),
  language: docLanguage,
});
const sendDoc = z.object({
  to: z.string().email(),
  subject: z.string().optional(),
  entity_id: z.string().uuid().nullish(),
  language: docLanguage,
});
/* Opening the composer. The record is the URL's `:id`, so the body carries only
   the two things the operator chose: which entity issues it, and the language
   the sheet and its covering email both come out in. */
const composePrefill = z.object({
  entity_id: z.string().uuid().nullish(),
  language: docLanguage,
});
const schemas = { setConfig, preview, sendDoc, composePrefill };

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = {
  setConfig: mw("setConfig"), preview: mw("preview"), sendDoc: mw("sendDoc"),
  composePrefill: mw("composePrefill"), schemas,
};
