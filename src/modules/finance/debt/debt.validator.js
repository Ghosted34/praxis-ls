"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const d = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const schemas = {
  create: z.object({ entity_id: z.string().uuid(), dossier_id: z.string().uuid().optional().nullable(), lender_kind: z.enum(["BANK", "THIRD_PARTY", "DIRECTOR"]), lender_name: z.string().optional().nullable(), principal: z.number().positive(), currency: z.string().length(3).optional(), interest_rate: z.number().nonnegative().optional().nullable(), coa_code: z.string().optional(), started_on: d.optional().nullable(), due_on: d.optional().nullable() }),
  drawdown: z.object({ entity_id: z.string().uuid().optional(), entry_date: d, source_doc_ref: z.string().optional(), treasury_coa: z.string().optional() }),
  repay: z.object({ entity_id: z.string().uuid().optional(), entry_date: d, principal_part: z.number().nonnegative().optional(), interest_part: z.number().nonnegative().optional(), treasury_coa: z.string().optional(), interest_coa: z.string().optional(), source_doc_ref: z.string().optional() }),
  update: z.object({ lender_name: z.string().optional().nullable(), interest_rate: z.number().nonnegative().optional().nullable(), due_on: d.optional().nullable(), started_on: d.optional().nullable(), dossier_id: z.string().uuid().optional().nullable() }),
};
const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data; return next();
};
module.exports = { create: mw("create"), drawdown: mw("drawdown"), repay: mw("repay"), update: mw("update"), schemas };
