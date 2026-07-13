"use strict";
const { z } = require("zod");
const { passthrough } = require("../../../shared/http/validate");
const { AppError } = require("../../../utils/errors");

const schemas = {
  create: z.object({
    data_url: z.string().min(1),
    doc_type: z.string().max(64).optional().nullable(),
    entity_ref: z.string().max(200).optional().nullable(),
    file_context: z.enum(["OPS", "OVH"]).optional().nullable(),
    folder_ref: z.string().max(200).optional().nullable(),
    dossier_id: z.string().uuid().optional().nullable(),
  }),
};
const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body ?? {});
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data; return next();
};
module.exports = { ...passthrough, create: mw("create"), schemas };
