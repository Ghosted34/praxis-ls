"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const item = z.object({ dictionary_item_id: z.string().uuid().optional().nullable(), label: z.string().optional(), qty: z.number().positive(), unit_price: z.number().nonnegative() });
const schemas = {
  create: z.object({ pr_id: z.string().uuid().optional().nullable(), supplier_id: z.string().uuid().optional().nullable(), dossier_id: z.string().uuid().optional().nullable(), expense_category: z.enum(["OPERATIONS", "OVERHEAD"]).optional(), items: z.array(item).optional() }),
  update: z.object({ supplier_id: z.string().uuid().optional().nullable(), dossier_id: z.string().uuid().optional().nullable(), expense_category: z.enum(["OPERATIONS", "OVERHEAD"]).optional(), items: z.array(item).optional() }),
  transition: z.object({ to: z.enum(["ISSUED_LOCKED", "APPROVED_LOCKED", "RECEIVED", "CLOSED", "CANCELLED"]), entity_id: z.string().uuid().optional().nullable(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
  // AI-facing: purchase_order_id in the payload → list_purchase_orders picker.
  aiUpdate: z.object({ purchase_order_id: z.string().uuid(), supplier_id: z.string().uuid().optional().nullable(), dossier_id: z.string().uuid().optional().nullable(), expense_category: z.enum(["OPERATIONS", "OVERHEAD"]).optional(), items: z.array(item).optional() }),
  aiTransition: z.object({ purchase_order_id: z.string().uuid(), to: z.enum(["ISSUED_LOCKED", "APPROVED_LOCKED", "RECEIVED", "CLOSED", "CANCELLED"]), entity_id: z.string().uuid().optional().nullable(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
};
const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data; return next();
};
module.exports = { create: mw("create"), update: mw("update"), transition: mw("transition"), schemas };
