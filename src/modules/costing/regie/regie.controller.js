"use strict";
const service = require("./regie.service");
const { asyncHandler, AppError } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };

module.exports = {
  list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.list(c, req.query)) })),

  watchlist: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.watchlist(c, req.query)) })),

  // Self-scoped: the holder id comes from the authenticated session, NOT from
  // req.query, so this endpoint cannot be aimed at another holder's float.
  mine: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.mine(c, req.user && req.user.user_id, req.query)) })),

  get: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.get(c, req.params.id));
    if (!row) throw new AppError("NOT_FOUND", "Régie advance not found", 404);
    res.json({ data: row });
  }),

  issue: asyncHandler(async (req, res) => {
    const b = req.body;
    const r = await req.tenantDb((c) => service.issue(c, {
      holderUserId: b.holder_user_id, amount: b.amount, entityId: b.entity_id,
      entryDate: b.entry_date, sourceDocRef: b.source_doc_ref, policyWindowDays: b.policy_window_days,
      currency: b.currency, exchangeRateToXaf: b.exchange_rate_to_xaf,
      actor: actor(req), ip: req.ip,
    }));
    res.status(201).json({ data: r });
  }),

  retire: asyncHandler(async (req, res) => {
    const b = req.body;
    const r = await req.tenantDb((c) => service.retire(c, {
      advanceId: req.params.id, kind: b.kind, dossierId: b.dossier_id, amount: b.amount,
      proofVaultId: b.proof_vault_id, memo: b.memo, entityId: b.entity_id,
      entryDate: b.entry_date, sourceDocRef: b.source_doc_ref,
      actor: actor(req), ip: req.ip,
    }));
    res.status(201).json({ data: r });
  }),

  query: asyncHandler(async (req, res) => {
    const r = await req.tenantDb((c) => service.query(c, {
      advanceId: req.params.id, reason: req.body.reason, actor: actor(req), ip: req.ip,
    }));
    res.json({ data: r });
  }),

  writeOff: asyncHandler(async (req, res) => {
    const b = req.body;
    const r = await req.tenantDb((c) => service.writeOff(c, {
      advanceId: req.params.id, amount: b.amount, memo: b.memo, entityId: b.entity_id,
      entryDate: b.entry_date, sourceDocRef: b.source_doc_ref,
      actor: actor(req), ip: req.ip,
    }));
    res.json({ data: r });
  }),

  unage: asyncHandler(async (req, res) => {
    const b = req.body;
    const r = await req.tenantDb((c) => service.unage(c, {
      advanceId: req.params.id, reason: b.reason, entryDate: b.entry_date,
      actor: actor(req), ip: req.ip,
    }));
    res.json({ data: r });
  }),

  ageDue: asyncHandler(async (req, res) => {
    const b = req.body;
    const r = await req.tenantDb((c) => service.ageDue(c, {
      entityId: b.entity_id, entryDate: b.entry_date, sourceDocRef: b.source_doc_ref,
      actor: actor(req), ip: req.ip,
    }));
    res.json({ data: r });
  }),
};
