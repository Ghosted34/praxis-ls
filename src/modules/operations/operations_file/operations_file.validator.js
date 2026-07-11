"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const create = z.object({
  entity_id: z.string().uuid(),
  client_id: z.string().uuid().optional(),
  service_type_id: z.string().uuid().optional(),
  incoterm: z.string().optional(), bl_mawb: z.string().optional(),
  pol: z.string().optional(), pod: z.string().optional(),
  customs_regime: z.string().optional(),
  owner_ops_id: z.string().uuid().optional(), owner_sales_id: z.string().uuid().optional(),
});
const update = create.partial();
const transition = z.object({ to: z.enum(["IN_PROGRESS", "COMPLETED", "CANCELLED"]) });
const schemas = { create, update, transition };
const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data; return next();
};
module.exports = { create: mw("create"), update: mw("update"), transition: mw("transition"), schemas };
