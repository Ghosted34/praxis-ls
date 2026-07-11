"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const create = z.object({
  employee_id: z.string().uuid(),
  license_class: z.string().min(1), // e.g. special low-bed carrier class
  license_number: z.string().optional(),
  issued_on: z.string().optional(),
  expires_on: z.string().optional(), // expiry alerts via event engine
  certification: z.string().optional(),
  document_vault_id: z.string().uuid().optional(),
});
const schemas = { create, update: create.partial() };

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = { create: mw("create"), update: mw("update"), schemas };
