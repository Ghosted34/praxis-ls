"use strict";
const service = require("./tax_declaration.service");
const { asyncHandler } = require("../../../utils/errors");
const filters = (req) => { const q = req.validatedQuery || {}; return { entityId: q.entity_id, from: q.from, to: q.to }; };
const actor = (req) => req.user || { user_id: null };
module.exports = {
  vatReturn: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.vatReturn(c, filters(req))) })),
  corporateTax: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.corporateTax(c, filters(req))) })),
  withholdingReturn: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.withholdingReturn(c, filters(req))) })),
  dsfDataset: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.dsfDataset(c, filters(req))) })),
  cnpsDeclaration: asyncHandler(async (req, res) => {
    const q = req.validatedQuery || {};
    return res.json({ data: await req.tenantDb((c) => service.cnpsDeclaration(c, { entityId: q.entity_id, periodCode: q.period_code })) });
  }),

  // Filing workflow
  listDeclarations: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.listDeclarations(c, req.query)) })),
  getDeclaration: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.getDeclaration(c, req.params.id)) })),
  fileDeclaration: asyncHandler(async (req, res) => {
    const b = req.body;
    res.status(201).json({ data: await req.tenantDb((c) => service.fileDeclaration(c, { entityId: b.entity_id, kind: b.kind, periodCode: b.period_code, from: b.from, to: b.to, dueOn: b.due_on, actor: actor(req) })) });
  }),
  approveDeclaration: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.approveDeclaration(c, { id: req.params.id, actor: actor(req) })) })),
  submitDeclaration: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.submitDeclaration(c, { id: req.params.id, filedRef: req.body.filed_ref, actor: actor(req) })) })),
};
