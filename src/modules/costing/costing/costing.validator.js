"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
// `container_type_ref_id` (0663) records which box the charge was priced for.
// Nullish, not optional-only: the form clears it when the item stops varying by
// equipment, and an unlisted field is stripped here before the service sees it.
const line = z.object({ dictionary_item_id: z.string().uuid().optional(), label: z.string().optional(), qty: z.number().positive().optional(), unit_cost: z.number().nonnegative().optional(), is_disbursement: z.boolean().optional(), tax_code_id: z.string().uuid().optional(), container_type_ref_id: z.string().uuid().nullish() });
const create = z.object({ dossier_id: z.string().uuid(), currency: z.string().length(3).optional(), exchange_rate_to_xaf: z.number().positive().optional(), margin_percent: z.number().optional(), lines: z.array(line).optional() });
const update = z.object({ currency: z.string().length(3).optional(), exchange_rate_to_xaf: z.number().positive().optional(), margin_percent: z.number().optional(), lines: z.array(line).optional() });
const setStatus = z.object({ to: z.enum(["SUBMIT_VALIDATION", "SUBMIT_APPROVAL", "APPROVE", "REJECT"]) });
// The unlock loop (10718). Kept OFF `setStatus` deliberately: `to` on that
// schema names an ordinary transition and is what the RBAC middleware keys on,
// whereas these three are refused by setStatus's LOCKED guard by design. A
// separate action keeps that guard intact instead of drilling through it.
// `reason` is required for the request and ignored for the two decisions — the
// service enforces that, so a reviewer reading one file sees the whole rule.
const unlock = z.object({
  action: z.enum(["REQUEST_UNLOCK", "UNLOCK", "DENY_UNLOCK"]),
  reason: z.string().min(1).max(2000).optional(),
});
// AI-facing: costing_id in the payload → list_costings picker.
const aiUpdate = update.extend({ costing_id: z.string().uuid() });
const aiSetStatus = setStatus.extend({ costing_id: z.string().uuid() });
const aiUnlock = unlock.extend({ costing_id: z.string().uuid() });
const schemas = { create, update, setStatus, unlock, aiUpdate, aiSetStatus, aiUnlock };
const mw = (k) => (req, _res, next) => { const p = schemas[k].safeParse(req.body); if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors)); req.body = p.data; return next(); };
module.exports = { create: mw("create"), update: mw("update"), setStatus: mw("setStatus"), unlock: mw("unlock"), schemas };
