"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const create = z.object({
  entity_id: z.string().uuid(),
  client_id: z.string().uuid().optional(),
  service_type_id: z.string().uuid().optional(),
  // The human label for the job, as opposed to `ref` (the allocated number).
  // Added with migration 0508: both places that open a dossier from a won
  // opportunity have always passed `opportunity.name` here, against a column
  // that did not exist. Optional — a dossier created directly may have none.
  title: z.string().trim().min(1).max(200).optional(),
  incoterm: z.string().optional(), bl_mawb: z.string().optional(),
  // pol/pod stay free text (display snapshot + the path old dossiers use);
  // *_place_id is the real reference into geo_place when the user picked one.
  pol: z.string().optional(), pod: z.string().optional(),
  pol_place_id: z.string().uuid().nullable().optional(),
  pod_place_id: z.string().uuid().nullable().optional(),
  customs_regime: z.string().optional(),
  owner_ops_id: z.string().uuid().optional(), owner_sales_id: z.string().uuid().optional(),
  // The carrier this job moves on (MOD-10 rate_provider) — scopes every
  // costing line's expense-rate lookup. Nullable so it can be cleared, same
  // convention as pol_place_id/pod_place_id above.
  rate_provider_id: z.string().uuid().nullable().optional(),
  /**
   * The service type's own shipment/service details, keyed by field key
   * (migration 0660). Intentionally NOT typed further here: the shape is
   * whatever the service type's active field set defines, and that is data a
   * tenant edits — a zod schema could only ever be a stale copy of it.
   *
   * The real validation is `shipment_details.service.applyValues`, which knows
   * the definitions: it refuses a key the service type does not define, coerces
   * each value to its declared type, enforces options / min / max / pattern,
   * and demands the fields marked required. So this is not a hole — it is the
   * one place where the schema genuinely lives in the database rather than in
   * the code, and the check happens one layer in.
   */
  details: z.record(z.string(), z.any()).optional(),
});
const update = create.partial();
// DRAFT is not here: a draft leaves by being PROMOTED (its own route, which
// allocates the ref and enforces the service type's required fields) or
// cancelled. Letting it reach OPEN through the generic transition would skip
// both and leave a file holding a DRAFT- placeholder ref.
const transition = z.object({ to: z.enum(["IN_PROGRESS", "COMPLETED", "CANCELLED"]) });
// Promotion takes the same body as create — the wizard sends what it gathered
// across all three steps, and `entity_id` may have been set at draft time.
const promote = create.partial();
// AI-facing variants: the record id travels in the payload (there is no URL param
// on the assistant path), so the executor knows WHICH dossier to act on. The REST
// routes keep using `update`/`transition` (id comes from req.params).
// `dossier_id` (not a bare `id`) so the copilot's field resolver maps it to the
// list_dossiers picker, and the payload is self-documenting.
const aiUpdate = update.extend({ dossier_id: z.string().uuid() });
const aiTransition = transition.extend({ dossier_id: z.string().uuid() });
const schemas = { create, update, transition, promote, aiUpdate, aiTransition };
const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data; return next();
};
module.exports = { create: mw("create"), update: mw("update"), transition: mw("transition"), promote: mw("promote"), schemas };
