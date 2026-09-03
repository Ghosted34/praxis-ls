"use strict";
const service = require("./costing.service");
const { asyncHandler, AppError } = require("../../../utils/errors");
const { sendPaged } = require("../../../shared/http/paged");
const actor = (req) => req.user || { user_id: null };
// The shipment-details projection is label-bearing, so the sheet renders in the
// reader's language. Same accessor as transit_order.controller.js:6.
const lang = (req) => (req.query && req.query.lang === "fr" ? "fr" : "en");
/** The validated filter, or the raw query for callers mounted without the
 *  middleware (there are none today; the fallback keeps the read total). */
const q = (req) => req.validQuery || req.query;
module.exports = {
  list: asyncHandler(async (req, res) => sendPaged(res, await req.tenantDb((c) => service.listPaged(c, q(req))))),
  // The KPI strip, over the same filter the page used — so "Approved: 3" means
  // three matching costings, not three on this page.
  kpis: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.kpis(c, q(req))) })),
  // Read-only: returns a PROPOSAL. Nothing is written until the person picks.
  suggest: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.suggestLines(c, q(req))) })),
  get: asyncHandler(async (req, res) => { const r = await req.tenantDb((c) => service.get(c, req.params.id, { lang: lang(req) })); if (!r) throw new AppError("NOT_FOUND", "Costing not found", 404); res.json({ data: r }); }),
  create: asyncHandler(async (req, res) => res.status(201).json({ data: await req.tenantDb((c) => service.createDraft(c, { data: req.body, actor: actor(req) })) })),
  update: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.updateDraft(c, { id: req.params.id, patch: req.body, lines: req.body.lines || null, actor: actor(req) })) })),
  setStatus: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.setStatus(c, { id: req.params.id, to: req.body.to, actor: actor(req) })) })),
  unlock: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.unlockTransition(c, { id: req.params.id, action: req.body.action, reason: req.body.reason, actor: actor(req) })) })),
};
