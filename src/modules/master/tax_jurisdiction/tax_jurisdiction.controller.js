"use strict";
const service = require("./tax_jurisdiction.service");
const { asyncHandler, AppError } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };
module.exports = {
  list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.list(c, req.query)) })),
  get: asyncHandler(async (req, res) => { const r = await req.tenantDb((c) => service.get(c, req.params.id)); if (!r) throw new AppError("NOT_FOUND", "Jurisdiction not found", 404); res.json({ data: r }); }),
  create: asyncHandler(async (req, res) => {
    const b = req.body;
    res.status(201).json({ data: await req.tenantDb((c) => service.createJurisdiction(c, { countryCode: b.country_code, name: b.name, currency: b.currency, actor: actor(req) })) });
  }),
  update: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.updateJurisdiction(c, { id: req.params.id, patch: req.body, actor: actor(req) })) })),
  setActive: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.setActive(c, { id: req.params.id, active: req.body.active === true, actor: actor(req) })) })),
  listCodes: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.listCodes(c, req.params.id)) })),
  addCode: asyncHandler(async (req, res) => {
    const b = req.body;
    res.status(201).json({ data: await req.tenantDb((c) => service.addCode(c, {
      jurisdictionId: req.params.id, code: b.code, kind: b.kind, ratePercent: b.rate_percent, baseRule: b.base_rule, appliesTo: b.applies_to,
      recoverable: b.recoverable, postsDebitAccount: b.posts_debit_account, postsCreditAccount: b.posts_credit_account, brackets: b.brackets,
      effectiveFrom: b.effective_from, effectiveTo: b.effective_to, legalReference: b.legal_reference, actor: actor(req),
    })) });
  }),
  supersede: asyncHandler(async (req, res) => {
    const b = req.body;
    res.status(201).json({ data: await req.tenantDb((c) => service.supersedeCode(c, {
      jurisdictionId: req.params.id, code: b.code, effectiveFrom: b.effective_from,
      newRow: {
        kind: b.kind, ratePercent: b.rate_percent, baseRule: b.base_rule, appliesTo: b.applies_to,
        recoverable: b.recoverable, postsDebitAccount: b.posts_debit_account, postsCreditAccount: b.posts_credit_account,
        brackets: b.brackets, effectiveTo: b.effective_to, legalReference: b.legal_reference,
      },
      actor: actor(req),
    })) });
  }),
  effective: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.effectiveCode(c, { jurisdictionId: req.params.id, code: req.query.code, date: req.query.date })) })),
};
