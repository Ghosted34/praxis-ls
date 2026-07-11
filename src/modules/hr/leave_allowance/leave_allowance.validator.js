"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const create = z.object({
  employee_id: z.string().uuid().optional(),
  kind: z.string().optional(), // leave | salary_advance | mission
  starts_on: z.string().optional(),
  ends_on: z.string().optional(),
  amount: z.number().nonnegative().optional(), // salary advance -> 4211 (posting deferred)
  status: z.enum(["REQUESTED", "APPROVED", "REJECTED"]).optional(),
});
const decision = z.object({ status: z.enum(["APPROVED", "REJECTED"]) });
const schemas = { create, update: create.partial(), decision };

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = { create: mw("create"), update: mw("update"), decision: mw("decision"), schemas };
