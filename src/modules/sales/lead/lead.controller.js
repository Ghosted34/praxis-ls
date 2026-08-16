"use strict";
const service = require("./lead.service");
const sales360 = require("../sales-360.service");
const { canSeeFinancials } = require("../../master/_shared/confidential");
const { asyncHandler, AppError } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };
module.exports = {
  /**
   * The 360° dossier (GET /leads/:id/360).
   *
   * Money — proposal totals, pipeline value — is gated on the SAME
   * finance-visibility check the party masters use, rather than a second rule
   * invented here. See sales-360.service for what that hides and why it hides
   * it as null rather than zero.
   */
  dossier: asyncHandler(async (req, res) => {
    const canSee = await canSeeFinancials(req);
    res.json({
      data: await req.tenantDb((c) =>
        sales360.leadDossier(c, { leadId: req.params.id, canSeeFinancials: canSee }),
      ),
    });
  }),
  list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.list(c, req.query)) })),
  get: asyncHandler(async (req, res) => { const r = await req.tenantDb((c) => service.get(c, req.params.id)); if (!r) throw new AppError("NOT_FOUND", "Lead not found", 404); res.json({ data: r }); }),
  create: asyncHandler(async (req, res) => res.status(201).json({ data: await req.tenantDb((c) => service.create(c, { data: req.body, actor: actor(req) })) })),
  update: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.update(c, { id: req.params.id, patch: req.body, actor: actor(req) })) })),
  transition: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.transition(c, { id: req.params.id, to: req.body.to, actor: actor(req) })) })),
  convert: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.convert(c, { id: req.params.id, clientData: req.body.client || {}, actor: actor(req) })) })),
};
