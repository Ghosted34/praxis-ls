"use strict";
const service = require("./marketing_campaign.service");
const rules = require("./marketing_campaign.rules");
const { asyncHandler, AppError } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };

/** The export's columns, in the order an operator expects to read them. */
const EXPORT_COLUMNS = [
  "name", "platform", "status", "owner_name", "target_service",
  "budget_currency", "budget_amount", "starts_on", "ends_on",
  "target_leads", "target_opportunities", "target_won",
  "actual_leads", "actual_opportunities", "actual_won",
  "cost_per_lead", "actuals_updated_at",
  "submitted_at", "approved_at", "rejected_at", "rejection_reason",
  "remarks", "created_at",
];

/**
 * RFC 4180 escaping, plus the leading-formula guard.
 *
 * A cell beginning = + - or @ is executed as a formula by Excel and Sheets on
 * open. A campaign name and its remarks are free text typed by a user, so
 * "=HYPERLINK(...)" in a campaign name runs on the machine of whoever exports
 * the register. Prefixing a tab neutralises it and still displays as typed.
 * Same guard, same reasoning, as quote_request.controller.
 */
function csvCell(v) {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "\t" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

module.exports = {
  /** { rows, total, kpi, limit, offset } — the register and its four tiles in one trip. */
  list: asyncHandler(async (req, res) => res.json(await req.tenantDb((c) => service.list(c, req.query)))),
  get: asyncHandler(async (req, res) => { const r = await req.tenantDb((c) => service.get(c, req.params.id)); if (!r) throw new AppError("NOT_FOUND", "Campaign not found", 404); res.json({ data: r }); }),
  create: asyncHandler(async (req, res) => res.status(201).json({ data: await req.tenantDb((c) => service.create(c, { data: req.body, actor: actor(req) })) })),
  update: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.update(c, { id: req.params.id, patch: req.body, actor: actor(req) })) })),
  transition: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.transition(c, { id: req.params.id, to: req.body.to, actor: actor(req) })) })),
  approve: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.approve(c, { id: req.params.id, actor: actor(req) })) })),
  reject: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.reject(c, { id: req.params.id, reason: req.body.reason, actor: actor(req) })) })),

  /**
   * The tile vocabulary and the platform list, so the screen does not keep its
   * own copy of either and drift from what the API aggregates and validates.
   */
  tiles: asyncHandler(async (_req, res) =>
    res.json({ data: { keys: rules.KPI_TILES, labels: rules.TILE_LABELS, statuses: rules.STATUSES, platforms: rules.PLATFORMS } }),
  ),

  /**
   * CSV export of the current view — unpaginated via service.listForExport, not
   * list() with a large page size (`page()` clamps to 200, so that would
   * silently export the first page and look complete). When the cap bites the
   * response says so in a header rather than handing over a prefix.
   */
  exportCsv: asyncHandler(async (req, res) => {
    const { rows, truncated } = await req.tenantDb((c) => service.listForExport(c, req.query));
    const lines = [EXPORT_COLUMNS.join(",")];
    for (const r of rows) {
      const withDerived = { ...r, cost_per_lead: rules.costPerLead(r) };
      lines.push(EXPORT_COLUMNS.map((h) => csvCell(withDerived[h])).join(","));
    }
    const filename = `campaigns_${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("X-Export-Row-Count", String(rows.length));
    if (truncated) res.setHeader("X-Export-Truncated", `true; capped at ${service.EXPORT_CAP} rows — narrow the filter`);
    // CRLF per RFC 4180, and a UTF-8 BOM so Excel on Windows reads accented
    // campaign names as UTF-8 rather than Latin-1.
    res.send("﻿" + lines.join("\r\n"));
  }),

  send: asyncHandler(async (req, res) => res.status(202).json({ data: await req.tenantDb((c) => service.sendCampaign(c, { id: req.params.id, templateId: req.body.template_id, tenantMeta: req.tenant, env: req.env || "live", actor: actor(req) })) })),
  subscribers: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.subscribers(c, req.query)) })),
  subscribe: asyncHandler(async (req, res) => { const b = req.body; res.status(201).json({ data: await req.tenantDb((c) => service.subscribe(c, { email: b.email, name: b.name, source: b.source, actor: actor(req) })) }); }),
  unsubscribe: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.unsubscribe(c, { email: req.body.email, actor: actor(req) })) })),
  // Sending identities
  listSenders: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.listSenders(c)) })),
  createSender: asyncHandler(async (req, res) => res.status(201).json({ data: await req.tenantDb((c) => service.createSender(c, { data: req.body, actor: actor(req) })) })),
  verifySender: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.verifySender(c, { id: req.params.id, actor: actor(req) })) })),
  deleteSender: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.deleteSender(c, { id: req.params.id, actor: actor(req) })) })),
  // Email templates
  listTemplates: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.listTemplates(c)) })),
  getTemplate: asyncHandler(async (req, res) => { const r = await req.tenantDb((c) => service.getTemplate(c, req.params.id)); if (!r) throw new AppError("NOT_FOUND", "Template not found", 404); res.json({ data: r }); }),
  createTemplate: asyncHandler(async (req, res) => res.status(201).json({ data: await req.tenantDb((c) => service.createTemplate(c, { data: req.body, actor: actor(req) })) })),
  updateTemplate: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.updateTemplate(c, { id: req.params.id, data: req.body, actor: actor(req) })) })),
  deleteTemplate: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.deleteTemplate(c, { id: req.params.id, actor: actor(req) })) })),
};
