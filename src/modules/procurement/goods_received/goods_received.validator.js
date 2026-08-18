"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const line = z.object({
  dictionary_item_id: z.string().uuid().optional().nullable(),
  label: z.string().optional(),
  ordered: z.number().nonnegative().optional(),
  received: z.number().nonnegative().optional(),
  condition: z.string().optional(),
});
const schemas = {
  // 10720: a GRN may now carry the received lines (ordered / received /
  // condition), a note, and the entity that lets it allocate its own document
  // number (MOD-33 "GRN").
  create: z.object({
    po_id: z.string().uuid(),
    received_by: z.string().uuid().optional().nullable(),
    supplier_invoice_ref: z.string().optional(),
    entity_id: z.string().uuid().optional().nullable(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    note: z.string().optional(),
    lines: z.array(line).optional(),
  }),
  sendToWarehouse: z.object({}).strict(),
  aiSendToWarehouse: z.object({ grn_id: z.string().uuid() }),
};
const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data; return next();
};
module.exports = { create: mw("create"), sendToWarehouse: mw("sendToWarehouse"), schemas };
