"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const line = z.object({ dictionary_item_id: z.string().uuid().optional().nullable(), label: z.string().optional(), qty: z.number().positive().optional(), unit_price: z.number().nonnegative().optional() });
const narrative = z.object({ section: z.string().min(1), body: z.string().optional(), sort_order: z.number().int().optional() });
const schemas = {
  create: z.object({ title: z.string().min(1), lead_id: z.string().uuid().optional().nullable(), client_id: z.string().uuid().optional().nullable(), opportunity_id: z.string().uuid().optional().nullable(), ai_generated: z.boolean().optional(), lines: z.array(line).optional(), narratives: z.array(narrative).optional() }),
  update: z.object({ title: z.string().optional(), client_id: z.string().uuid().optional().nullable(), opportunity_id: z.string().uuid().optional().nullable(), lines: z.array(line).optional(), narratives: z.array(narrative).optional() }),
  transition: z.object({ to: z.enum(["IN_REVIEW", "SENT", "DRAFT", "REJECTED"]), entity_id: z.string().uuid().optional().nullable() }),
  accept: z.object({ create_quotation: z.boolean().optional(), entity_id: z.string().uuid().optional().nullable() }),
};
const mw = (k) => (req, _res, next) => { const p = schemas[k].safeParse(req.body); if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors)); req.body = p.data; return next(); };
module.exports = { create: mw("create"), update: mw("update"), transition: mw("transition"), accept: mw("accept"), schemas };
