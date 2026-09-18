"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const create = z.object({
  dossier_id: z.string().uuid().optional(),
  client_id: z.string().uuid().optional(),
  status: z.enum(["CREATED", "PICKING", "PACKED", "DISPATCHED", "CANCELLED"]).optional(),
});
const status = z.object({ status: z.enum(["CREATED", "PICKING", "PACKED", "DISPATCHED", "CANCELLED"]) });
const line = z.object({
  inventory_item_id: z.string().uuid().optional(),
  qty: z.number().positive().optional(),
});
const lineFlags = z.object({
  picked: z.boolean().optional(),
  packed: z.boolean().optional(),
});
const update = create.partial();
// AI-facing: the record id travels IN the payload — the copilot has no route param.
const aiUpdate = update.extend({ outbound_order_id: z.string().uuid() });
const aiStatus = status.extend({ outbound_order_id: z.string().uuid() });
const aiLine = line.extend({ outbound_order_id: z.string().uuid() });
const aiLineFlags = lineFlags.extend({ outbound_order_id: z.string().uuid(), outbound_line_id: z.string().uuid() });
const schemas = { create, update, status, line, lineFlags, aiUpdate, aiStatus, aiLine, aiLineFlags };

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = {
  create: mw("create"),
  update: mw("update"),
  status: mw("status"),
  line: mw("line"),
  lineFlags: mw("lineFlags"),
  schemas,
};
