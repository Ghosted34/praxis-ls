"use strict";
const service = require("./cost_tracking.service");
const { asyncHandler } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };
module.exports = {
  record: asyncHandler(async (req, res) => {
    const b = req.body;
    const r = await req.tenantDb((c) => service.recordCost(c, {
      dossierId: b.dossier_id, entityId: b.entity_id, dictionaryItemId: b.dictionary_item_id, amount: b.amount,
      category: b.category, isDisbursement: b.is_disbursement === true, expenseCoa: b.expense_coa, treasuryCoa: b.treasury_coa,
      entryDate: b.entry_date, sourceDocRef: b.source_doc_ref, actor: actor(req), ip: req.ip,
    }));
    res.status(201).json({ data: r });
  }),
  list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.listByDossier(c, req.params.dossierId, req.query)) })),
  // §3.4 — the whole sheet in one transaction.
  bulk: asyncHandler(async (req, res) => {
    const b = req.body;
    const r = await req.tenantDb((c) => service.recordCosts(c, {
      dossierId: b.dossier_id, entityId: b.entity_id, entryDate: b.entry_date, sourceDocRef: b.source_doc_ref,
      lines: b.lines, actor: actor(req), ip: req.ip,
    }));
    res.status(201).json({ data: r });
  }),
  // §3.4 — the master-ledger matrix (columns derived from the dictionary).
  matrix: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.matrix(c, req.query)) })),
  advances: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.advances(c, req.params.dossierId)) })),
  allocate: asyncHandler(async (req, res) =>
    res.status(201).json({ data: await req.tenantDb((c) => service.allocateAdvance(c, { advanceId: req.params.advanceId, dictionaryItemId: req.body.dictionary_item_id, amount: req.body.amount, note: req.body.note, actor: actor(req) })) })),
  removeAllocation: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.removeAllocation(c, { allocationId: req.params.allocationId, actor: actor(req) })) })),
  // Portfolio-wide reads (Landing C decision). Both routes are registered
  // BEFORE /dossier/:dossierId so "portfolio" is never captured as a param.
  portfolio: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.portfolio(c, req.query)) })),
  kpis: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.portfolioKpis(c, req.query)) })),
  reconcile: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.reconcileDossier(c, { dossierId: req.params.dossierId })) })),
};
