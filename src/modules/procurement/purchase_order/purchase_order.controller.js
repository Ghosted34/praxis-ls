"use strict";
const service = require("./purchase_order.service");
const { asyncHandler, AppError } = require("../../../utils/errors");
const { enqueueDocument } = require("../../../services/documents/generate");
const actor = (req) => req.user || { user_id: null };

/** Header fields that flow through the body into the PO row (10720). */
const HEADER_KEYS = ["currency", "delivery_on", "delivery_location", "payment_means", "pay_days", "bank_block", "air_rate", "adv_paid", "terms", "remarks"];
const headerOf = (b) => {
  const out = {};
  for (const k of HEADER_KEYS) if (b[k] !== undefined) out[k] = b[k];
  return out;
};

module.exports = {
  list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.list(c, req.query)) })),
  get: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.get(c, req.params.id));
    if (!row) throw new AppError("NOT_FOUND", "Purchase order not found", 404);
    res.json({ data: row });
  }),
  create: asyncHandler(async (req, res) => {
    const b = req.body;
    const data = await req.tenantDb((c) => service.createDraft(c, { prId: b.pr_id, supplierId: b.supplier_id, dossierId: b.dossier_id, expenseCategory: b.expense_category, items: b.items || [], actor: actor(req), ...headerOf(b) }));
    res.status(201).json({ data });
  }),
  update: asyncHandler(async (req, res) => {
    const b = req.body;
    const data = await req.tenantDb((c) => service.updateDraft(c, { poId: req.params.id, items: b.items || null, patch: { supplier_id: b.supplier_id, dossier_id: b.dossier_id, expense_category: b.expense_category, ...headerOf(b) }, actor: actor(req) }));
    res.json({ data });
  }),
  transition: asyncHandler(async (req, res) => {
    const b = req.body;
    const data = await req.tenantDb((c) => service.transition(c, { poId: req.params.id, to: b.to, entityId: b.entity_id, date: b.date, actor: actor(req) }));
    // Auto-generate the supplier-facing PO PDF the moment it is issued
    // (DOCUMENT_TEMPLATES_PLAN §6 — final_invoice is the exemplar).
    if (data && data.status === "ISSUED_LOCKED") {
      enqueueDocument({ tenantMeta: req.tenant, env: req.env, docType: "PURCHASE_ORDER", recordId: req.params.id });
    }
    res.json({ data });
  }),
  pay: asyncHandler(async (req, res) => {
    const b = req.body;
    const data = await req.tenantDb((c) => service.pay(c, { poId: req.params.id, amount: b.amount === undefined ? null : b.amount, paidOn: b.paid_on, treasuryAccountId: b.treasury_account_id, note: b.note, actor: actor(req) }));
    res.json({ data });
  }),
  unlock: asyncHandler(async (req, res) => {
    const b = req.body;
    const data = await req.tenantDb((c) => service.unlockTransition(c, { poId: req.params.id, action: b.action, reason: b.reason, actor: actor(req) }));
    res.json({ data });
  }),
};
