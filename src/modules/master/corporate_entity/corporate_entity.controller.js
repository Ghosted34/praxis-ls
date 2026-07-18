"use strict";
const service = require("./corporate_entity.service");
const { asyncHandler, AppError } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };
module.exports = {
  list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.list(c, req.query)) })),
  get: asyncHandler(async (req, res) => { const r = await req.tenantDb((c) => service.get(c, req.params.id)); if (!r) throw new AppError("NOT_FOUND", "Entity not found", 404); res.json({ data: r }); }),
  create: asyncHandler(async (req, res) => {
    const b = req.body;
    const data = await req.tenantDb((c) => service.create(c, { code: b.code, legalName: b.legal_name, niu: b.niu, rccm: b.rccm, countryCode: b.country_code, address: b.address, bankBlock: b.bank_block, docPrefix: b.doc_prefix, defaultLanguage: b.default_language, fiscalYearStartMonth: b.fiscal_year_start_month, actor: actor(req) }));
    res.status(201).json({ data });
  }),
  update: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.update(c, { id: req.params.id, patch: req.body, actor: actor(req) })) })),
  setActive: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.setActive(c, { id: req.params.id, active: req.body.active === true, actor: actor(req) })) })),
  uploadLogo: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.uploadLogo(c, { id: req.params.id, dataUrl: req.body.data_url, variant: req.body.variant || "light", slug: req.tenant.slug, actor: actor(req) })) })),
};
