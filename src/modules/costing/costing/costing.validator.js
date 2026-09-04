"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
// `container_type_ref_id` (0663) records which box the charge was priced for.
// Nullish, not optional-only: the form clears it when the item stops varying by
// equipment, and an unlisted field is stripped here before the service sees it.
//
// `upstream_vat_amount` (12766) is the supplier's own VAT inside a
// pass-through gross — the 19,250 in a 119,250 Maersk demurrage invoice. It is
// DISCLOSED on the document, never added to any total, and the service drops it
// on a line that is not a disbursement rather than storing a number that could
// later be mistaken for tax we charged.
const line = z.object({
  dictionary_item_id: z.string().uuid().optional(),
  label: z.string().optional(),
  qty: z.number().positive().optional(),
  unit_cost: z.number().nonnegative().optional(),
  is_disbursement: z.boolean().optional(),
  tax_code_id: z.string().uuid().optional(),
  container_type_ref_id: z.string().uuid().nullish(),
  upstream_vat_amount: z.number().nonnegative().nullish(),
  // 12768: the rate a débours was priced at (default TVA_STD 19.25). When set,
  // the server derives the amount from it; the client sends both.
  upstream_vat_rate_percent: z.number().min(0).max(100).nullish(),
});
// §2.2: margin_percent is gone from both schemas — costing has no margin
// (an old client still sending it is silently stripped, not errored).
// §3.3: remarks (legacy save.php:29) + validator_id (save.php:6 — the person
// the sheet is submitted TO; the service stamps validator_assigned_at).
const create = z.object({ dossier_id: z.string().uuid(), currency: z.string().length(3).optional(), exchange_rate_to_xaf: z.number().positive().optional(), remarks: z.string().max(4000).optional().nullable(), validator_id: z.string().uuid().optional().nullable(), lines: z.array(line).optional() });
const update = z.object({ currency: z.string().length(3).optional(), exchange_rate_to_xaf: z.number().positive().optional(), remarks: z.string().max(4000).optional().nullable(), validator_id: z.string().uuid().optional().nullable(), lines: z.array(line).optional() });
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

/**
 * The registry filter (12766). Mirrors legacy's list.php:20-90 — a text search
 * across the reference / file / client, a status, and a date window — with the
 * period expressed as explicit bounds rather than legacy's named periods, so
 * "last quarter" is the caller's arithmetic and not a switch statement in SQL
 * that has to be extended every time somebody wants a new range.
 */
const listQuery = z.object({
  dossier_id: z.string().uuid().optional(),
  status: z.enum([
    "DRAFT", "SUBMITTED_FOR_VALIDATION", "SUBMITTED_FOR_APPROVAL",
    "APPROVED_LOCKED", "UNLOCK_REQUESTED", "REJECTED",
  ]).optional(),
  currency: z.string().length(3).optional(),
  q: z.string().min(1).max(120).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
}).passthrough();

/**
 * Suggest (12766). `tier` is nested — ADVANCED yields BASIC + ADVANCED — and
 * defaults to FULL so the picker can show every band and let a person untick,
 * which is what the tiers are FOR. Defaulting to BASIC would hide the long tail
 * behind a control most people never find.
 */
const suggestQuery = z.object({
  dossier_id: z.string().uuid(),
  tier: z.enum(["BASIC", "ADVANCED", "FULL"]).optional(),
  on_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/**
 * The budget ledger's one option (12771).
 *
 * `for_cash_request` leaves that request out of every total, which is the
 * difference between "how much was available to me" and "how much is left
 * now". A worksheet asks the first; the registry asks the second.
 */
const budgetQuery = z.object({
  for_cash_request: z.string().uuid().optional(),
});

// AI-facing: costing_id in the payload → list_costings picker.
const aiUpdate = update.extend({ costing_id: z.string().uuid() });
const aiSetStatus = setStatus.extend({ costing_id: z.string().uuid() });
const aiUnlock = unlock.extend({ costing_id: z.string().uuid() });
const schemas = { create, update, setStatus, unlock, listQuery, suggestQuery, budgetQuery, aiUpdate, aiSetStatus, aiUnlock };
const mw = (k) => (req, _res, next) => { const p = schemas[k].safeParse(req.body); if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors)); req.body = p.data; return next(); };
/** Query-string variant: parses `req.query`, which Express makes read-only on
 *  some versions, so the parsed result is stashed rather than reassigned. */
const qw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.query);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid query", 422, p.error.flatten().fieldErrors));
  req.validQuery = p.data;
  return next();
};
module.exports = {
  create: mw("create"), update: mw("update"), setStatus: mw("setStatus"), unlock: mw("unlock"),
  listQuery: qw("listQuery"), suggestQuery: qw("suggestQuery"), budgetQuery: qw("budgetQuery"),
  schemas,
};
