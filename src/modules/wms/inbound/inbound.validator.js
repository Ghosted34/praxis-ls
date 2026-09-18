"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const create = z.object({
  dossier_id: z.string().uuid().optional(),
  qa_status: z.enum(["HOLD", "PASSED", "REJECTED"]).optional(),
  putaway_location: z.string().uuid().optional(),
  lines: z.array(z.object({ inventory_item_id: z.string().uuid().optional().nullable(), item: z.string().optional(), ordered: z.number().nonnegative().optional(), received: z.number().nonnegative().optional(), condition: z.string().optional() })).optional(),
});
const qa = z.object({
  qa_status: z.enum(["PASSED", "REJECTED"]),
  putaway_location: z.string().uuid().optional(),
});
const update = create.partial();
// AI-facing: the record id travels IN the payload — the copilot has no route param.
const aiUpdate = update.extend({ grn_inbound_id: z.string().uuid() });
const aiQa = qa.extend({ grn_inbound_id: z.string().uuid() });
const schemas = { create, update, qa, aiUpdate, aiQa };

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = { create: mw("create"), update: mw("update"), qa: mw("qa"), schemas };
