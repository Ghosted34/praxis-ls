"use strict";
const service = require("./corporate_entity.service");
const calendar = require("./corporate_entity.calendar");
const dossierService = require("../entity-360.service");
const { asyncHandler, AppError } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };

module.exports = {
  list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.list(c, req.query)) })),

  get: asyncHandler(async (req, res) => {
    const r = await req.tenantDb((c) => service.get(c, req.params.id));
    if (!r) throw new AppError("NOT_FOUND", "Entity not found", 404);
    res.json({ data: r });
  }),

  /**
   * The dossier the entity page renders. Governance visibility is resolved on
   * the REQUEST (not inside the tenant transaction) because it reads the
   * identity database — see entity-360.service.canSeeGovernance.
   */
  dossier: asyncHandler(async (req, res) => {
    // Both visibility questions are resolved on the REQUEST, not inside the
    // tenant transaction, because they read the identity database. Governance
    // gates the cap table; financials gates account numbers (gate 14) — an
    // entity's own bank details are finance data even though the route that
    // carries them is MOD-01.
    const governance = await dossierService.canSeeGovernance(req);
    const financials = await dossierService.canSeeFinancials(req);
    const data = await req.tenantDb((c) => dossierService.dossier(c, req.params.id, { governance, financials }));
    res.json({ data });
  }),

  workingCalendar: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => calendar.get(c, req.params.id)) })),
  saveWorkingCalendar: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => calendar.save(c, req.params.id, { ...req.body, actor: req.user || {} })) })),
  resetWorkingCalendar: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => calendar.reset(c, req.params.id, { actor: req.user || {} })) })),
  letterhead: asyncHandler(async (req, res) => {
    // Gate 14 again: this route is MOD-01 `view`, and the payment block it
    // renders carries the account number.
    const financials = await dossierService.canSeeFinancials(req);
    const data = await req.tenantDb((c) => service.letterhead(c, req.params.id, req.query.lang || null, { financials }));
    res.json({ data });
  }),

  saveLetterhead: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.saveLetterhead(c, { id: req.params.id, patch: req.body, actor: actor(req) })) })),

  renewals: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.renewals(c, req.params.id, req.query.as_of || null)) })),

  capTable: asyncHandler(async (req, res) => {
    const data = await req.tenantDb((c) => service.capTable(c, req.params.id, req.query.as_of || null));
    res.json({ data });
  }),

  create: asyncHandler(async (req, res) => {
    const b = req.body;
    const data = await req.tenantDb((c) => service.create(c, {
      code: b.code, legalName: b.legal_name, tradingName: b.trading_name,
      niu: b.niu, rccm: b.rccm, countryCode: b.country_code, address: b.address,
      bankBlock: b.bank_block, docPrefix: b.doc_prefix, defaultLanguage: b.default_language,
      fiscalYearStartMonth: b.fiscal_year_start_month, legalForm: b.legal_form,
      incorporationDate: b.incorporation_date, accountingFramework: b.accounting_framework,
      registrationStatus: b.registration_status, parentEntityId: b.parent_entity_id,
      relationshipType: b.relationship_type, description: b.description,
      actor: actor(req),
    }));
    res.status(201).json({ data });
  }),

  update: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.update(c, { id: req.params.id, patch: req.body, actor: actor(req) })) })),

  setStatus: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.setStatus(c, { id: req.params.id, status: req.body.status, reason: req.body.reason || null, actor: actor(req) })) })),

  setStructure: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.setStructure(c, { id: req.params.id, patch: req.body, actor: actor(req) })) })),

  setActive: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.setActive(c, { id: req.params.id, active: req.body.active === true, actor: actor(req) })) })),

  uploadLogo: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.uploadLogo(c, { id: req.params.id, dataUrl: req.body.data_url, variant: req.body.variant || "light", slug: req.tenant.slug, actor: actor(req) })) })),
};
