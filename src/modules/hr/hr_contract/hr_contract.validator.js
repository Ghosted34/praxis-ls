"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const create = z.object({
  employee_id: z.string().uuid().optional(),
  kind: z.enum(["OFFER_LETTER", "EMPLOYMENT", "CONFIRMATION", "TERMINATION"]),
  effective_on: z.string().optional(),
  end_on: z.string().optional(),
  status: z.enum(["DRAFT", "ISSUED", "SIGNED", "ENDED"]).optional(),
  pdf_vault_id: z.string().uuid().optional(),
});
const status = z.object({ status: z.enum(["DRAFT", "ISSUED", "SIGNED", "ENDED"]) });
const schemas = { create, update: create.partial(), status };

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = { create: mw("create"), update: mw("update"), status: mw("status"), schemas };
