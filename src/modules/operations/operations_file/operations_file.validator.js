"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const create = z.object({
  entity_id: z.string().uuid(),
  client_id: z.string().uuid().optional(),
  service_type_id: z.string().uuid().optional(),
  incoterm: z.string().optional(), bl_mawb: z.string().optional(),
  // pol/pod stay free text (display snapshot + the path old dossiers use);
  // *_place_id is the real reference into geo_place when the user picked one.
  pol: z.string().optional(), pod: z.string().optional(),
  pol_place_id: z.string().uuid().nullable().optional(),
  pod_place_id: z.string().uuid().nullable().optional(),
  customs_regime: z.string().optional(),
  owner_ops_id: z.string().uuid().optional(), owner_sales_id: z.string().uuid().optional(),
});
const update = create.partial();
const transition = z.object({ to: z.enum(["IN_PROGRESS", "COMPLETED", "CANCELLED"]) });
// AI-facing variants: the record id travels in the payload (there is no URL param
// on the assistant path), so the executor knows WHICH dossier to act on. The REST
// routes keep using `update`/`transition` (id comes from req.params).
const aiUpdate = update.extend({ id: z.string().uuid() });
const aiTransition = transition.extend({ id: z.string().uuid() });
const schemas = { create, update, transition, aiUpdate, aiTransition };
const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data; return next();
};
module.exports = { create: mw("create"), update: mw("update"), transition: mw("transition"), schemas };
