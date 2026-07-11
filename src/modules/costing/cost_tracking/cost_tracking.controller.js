"use strict";
const service = require("./cost_tracking.service");
const { asyncHandler } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };
module.exports = {
  record: asyncHandler(async (req, res) => {
    const b = req.body;
    const r = await req.tenantDb((c) => service.recordCost(c, {
      dossierId: b.dossier_id, entityId: b.entity_id, dictionaryItemId: b.dictionary_item_id, amount: b.amount,
      category: b.category, isDebours: b.is_debours === true, expenseCoa: b.expense_coa, treasuryCoa: b.treasury_coa,
      entryDate: b.entry_date, sourceDocRef: b.source_doc_ref, actor: actor(req), ip: req.ip,
    }));
    res.status(201).json({ data: r });
  }),
  list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.listByDossier(c, req.params.dossierId, req.query)) })),
  reconcile: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.reconcileDossier(c, { dossierId: req.params.dossierId })) })),
};
