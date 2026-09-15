"use strict";
const service = require("./dossier_reconciliation.service");
const { asyncHandler } = require("../../../utils/errors");

const actor = (req) => req.user || { user_id: null };
const ip = (req) => req.ip || null;

module.exports = {
  sheet: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.sheetFor(c, { dossierId: req.params.dossierId })) })),

  get: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.get(c, req.params.id)) })),

  patchLine: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.patchLine(c, {
      dossierId: req.params.dossierId,
      costingLineId: req.params.costingLineId,
      // The service distinguishes an ABSENT key from an explicit null, so the
      // body is passed through rather than destructured into defaults.
      fields: req.body,
      actor: actor(req), ip: ip(req),
    })) })),

  applyReason: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.applyReason(c, {
      dossierId: req.params.dossierId,
      reason: req.body.reason,
      costingLineIds: req.body.costing_line_ids,
      actor: actor(req), ip: ip(req),
    })) })),

  attachDocument: asyncHandler(async (req, res) =>
    res.status(201).json({ data: await req.tenantDb((c) => service.attachDocument(c, {
      dossierId: req.params.dossierId,
      costingLineId: req.params.costingLineId,
      docId: req.body.doc_id,
      note: req.body.note,
      actor: actor(req), ip: ip(req),
    })) })),

  detachDocument: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.detachDocument(c, {
      dossierId: req.params.dossierId,
      costingLineId: req.params.costingLineId,
      docId: req.params.docId,
      actor: actor(req), ip: ip(req),
    })) })),

  submit: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.submit(c, {
      dossierId: req.params.dossierId, note: req.body.note, actor: actor(req), ip: ip(req),
    })) })),

  reject: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.reject(c, {
      dossierId: req.params.dossierId, reason: req.body.reason, actor: actor(req), ip: ip(req),
    })) })),

  settle: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.settle(c, {
      dossierId: req.params.dossierId, returned: req.body.returned, actor: actor(req), ip: ip(req),
    })) })),

  // "Cash to account for". `/owed` is the CALLER'S own — ungated, like
  // hr_query's /mine: a person may always see what they personally owe.
  owedMine: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.receiptsOwed(c, { userId: (req.user || {}).user_id || null })) })),

  owedAll: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.receiptsOwed(c, { userId: null })) })),
};
