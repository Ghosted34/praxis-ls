"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const d = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable();
const item = z.object({
  dictionary_item_id: z.string().uuid().optional().nullable(),
  label: z.string().optional(),
  qty: z.number().positive(),
  unit_price: z.number().nonnegative(),
  // Per-line VAT, resolved through the dictionary item's tax code when absent
  // (10720). Explicit only for a line whose rate differs from the item's.
  tax_code_id: z.string().uuid().optional().nullable(),
});
// The header a PO may carry — the legacy Finance & Treasury payment block,
// withholding and advance (analysis doc §6.1). bank_block mirrors
// supplier_master.bank_block: { bank?, account_number?, account_name?,
// momo_network?, momo_number? }.
const header = {
  currency: z.string().length(3).optional(),
  delivery_on: d,
  delivery_location: z.string().optional(),
  payment_means: z.enum(["BANK", "CASH", "MOBILE_MONEY", "CHEQUE"]).optional(),
  pay_days: z.number().int().nonnegative().optional(),
  bank_block: z.object({
    bank: z.string().optional().nullable(),
    account_number: z.string().optional().nullable(),
    account_name: z.string().optional().nullable(),
    momo_network: z.string().optional().nullable(),
    momo_number: z.string().optional().nullable(),
  }).optional(),
  air_rate: z.number().nonnegative().optional(),
  adv_paid: z.number().nonnegative().optional(),
  terms: z.string().optional(),
  remarks: z.string().optional(),
};
const schemas = {
  create: z.object({ pr_id: z.string().uuid().optional().nullable(), supplier_id: z.string().uuid().optional().nullable(), dossier_id: z.string().uuid().optional().nullable(), expense_category: z.enum(["OPERATIONS", "OVERHEAD"]).optional(), items: z.array(item).optional(), ...header }),
  update: z.object({ supplier_id: z.string().uuid().optional().nullable(), dossier_id: z.string().uuid().optional().nullable(), expense_category: z.enum(["OPERATIONS", "OVERHEAD"]).optional(), items: z.array(item).optional(), ...header }),
  transition: z.object({ to: z.enum(["ISSUED_LOCKED", "APPROVED_LOCKED", "RECEIVED", "CLOSED", "CANCELLED"]), entity_id: z.string().uuid().optional().nullable(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
  // 10721: pay a PO directly (legacy po_mark_paid). `amount` OPTIONAL and
  // defaults server-side to the whole outstanding balance, like SI pay.
  pay: z.object({ amount: z.number().positive().optional(), paid_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), treasury_account_id: z.string().uuid().optional().nullable(), note: z.string().max(500).optional() }),
  // The unlock loop (10721) — gated on `action`, mirroring costing 10718.
  unlock: z.object({ action: z.enum(["REQUEST_UNLOCK", "UNLOCK", "DENY_UNLOCK"]), reason: z.string().optional().nullable() }),
  // AI-facing: purchase_order_id in the payload → list_purchase_orders picker.
  aiUpdate: z.object({ purchase_order_id: z.string().uuid(), supplier_id: z.string().uuid().optional().nullable(), dossier_id: z.string().uuid().optional().nullable(), expense_category: z.enum(["OPERATIONS", "OVERHEAD"]).optional(), items: z.array(item).optional(), ...header }),
  aiTransition: z.object({ purchase_order_id: z.string().uuid(), to: z.enum(["ISSUED_LOCKED", "APPROVED_LOCKED", "RECEIVED", "CLOSED", "CANCELLED"]), entity_id: z.string().uuid().optional().nullable(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
  aiPay: z.object({ purchase_order_id: z.string().uuid(), amount: z.number().positive().optional(), paid_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), treasury_account_id: z.string().uuid().optional().nullable(), note: z.string().max(500).optional() }),
  aiUnlock: z.object({ purchase_order_id: z.string().uuid(), action: z.enum(["REQUEST_UNLOCK", "UNLOCK", "DENY_UNLOCK"]), reason: z.string().optional().nullable() }),
};
const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data; return next();
};
module.exports = { create: mw("create"), update: mw("update"), transition: mw("transition"), pay: mw("pay"), unlock: mw("unlock"), schemas };
