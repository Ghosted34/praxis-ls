"use strict";
const service = require("./quote_request.service");
const rules = require("./quote_request.rules");
const sales360 = require("../sales-360.service");
const { canSeeFinancials } = require("../../master/_shared/confidential");
const { asyncHandler, AppError } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };

/** The export's columns, in the order an operator expects to read them. */
const EXPORT_COLUMNS = [
  "public_ref", "status", "intake_channel", "service_category", "service_type",
  "incoterm", "origin_location", "destination_location", "estimated_weight",
  "project_cargo_flag", "warehouse_location", "warehouse_duration",
  "requester_name", "requester_company", "requester_email", "requester_phone",
  "cargo_description", "created_at",
];

/**
 * RFC 4180 escaping, plus the leading-formula guard.
 *
 * A cell beginning = + - or @ is executed as a formula by Excel and Sheets when
 * the file is opened, and every text field here is attacker-supplied through
 * the public intake (F13). Prefixing a tab neutralises it and still displays as
 * typed. Without this, "=HYPERLINK(...)" typed into a website enquiry form runs
 * on the machine of whoever exports the register.
 */
function csvCell(v) {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "\t" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

module.exports = {
  /** { rows, total, kpi, limit, offset } — the list and its summary in one trip. */
  list: asyncHandler(async (req, res) => {
    res.json(await req.tenantDb((c) => service.list(c, req.query)));
  }),

  /**
   * The 360° dossier (GET /quote-requests/:id/360).
   *
   * `get` above already folds in attachments; this goes further — the lead the
   * request came from, the opportunity it became, the proposals reached through
   * that lead, and the audit history. Money follows the party masters' rule:
   * `canSeeFinancials` decides, and it is null rather than zero when refused.
   */
  dossier: asyncHandler(async (req, res) => {
    const canSee = await canSeeFinancials(req);
    res.json({
      data: await req.tenantDb((c) =>
        sales360.intakeDossier(c, { quoteRequestId: req.params.id, canSeeFinancials: canSee }),
      ),
    });
  }),

  get: asyncHandler(async (req, res) => {
    const out = await req.tenantDb(async (c) => {
      const row = await service.get(c, req.params.id);
      if (!row) return null;
      return { ...row, attachments: await service.listAttachments(c, req.params.id) };
    });
    if (!out) throw new AppError("NOT_FOUND", "Quote request not found", 404);
    res.json({ data: out });
  }),

  create: asyncHandler(async (req, res) =>
    res.status(201).json({ data: await req.tenantDb((c) => service.create(c, { data: req.body, actor: actor(req) })) }),
  ),

  update: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.update(c, { id: req.params.id, patch: req.body, actor: actor(req) })) }),
  ),

  transition: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.transition(c, { id: req.params.id, to: req.body.to, actor: actor(req) })) }),
  ),

  convertToOpportunity: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.convertToOpportunity(c, { id: req.params.id, opportunity: req.body.opportunity, actor: actor(req) })) }),
  ),

  /** The tile vocabulary, so the register does not hard-code its own copy. */
  tiles: asyncHandler(async (_req, res) =>
    res.json({ data: { keys: rules.KPI_TILES, labels: rules.TILE_LABELS, statuses: rules.STATUSES } }),
  ),

  listAttachments: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.listAttachments(c, req.params.id)) }),
  ),

  /**
   * Upload. The file arrives as a base64 data URL, is sniffed, stored and
   * linked inside one transaction, and the stored object is deleted if that
   * transaction rolls back — see service.uploadAttachment. The old shape took a
   * `vault_id` the caller had somehow obtained elsewhere, which is both an
   * orphan factory and a way to attach another module's document.
   */
  addAttachment: asyncHandler(async (req, res) => {
    const { file, filename, kind } = req.body;
    const r = await req.tenantDb((c) => service.uploadAttachment(c, {
      id: req.params.id, dataUrl: file, filename: filename || null, kind: kind || "ADDITIONAL",
      slug: req.tenant && req.tenant.slug, actor: actor(req),
    }));
    res.status(201).json({ data: r });
  }),

  removeAttachment: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.removeAttachment(c, { id: req.params.id, attachment_id: req.params.attachmentId, actor: actor(req) })) }),
  ),

  /**
   * CSV export of the current view.
   *
   * Unpaginated by way of service.listForExport — NOT list() with a large
   * page size. `page()` clamps every list to 200 rows and reads only
   * `limit`/`offset`, so the previous `pageSize: 100000` was ignored and the
   * export silently contained the first 50 rows. When the cap does bite, the
   * response says so in a header rather than handing over a prefix that looks
   * complete.
   */
  exportCsv: asyncHandler(async (req, res) => {
    const { rows, truncated } = await req.tenantDb((c) => service.listForExport(c, req.query));
    const lines = [EXPORT_COLUMNS.join(",")];
    for (const r of rows) lines.push(EXPORT_COLUMNS.map((h) => csvCell(r[h])).join(","));
    const filename = `quote_requests_${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("X-Export-Row-Count", String(rows.length));
    if (truncated) res.setHeader("X-Export-Truncated", `true; capped at ${service.EXPORT_CAP} rows — narrow the filter`);
    // CRLF per RFC 4180, and a UTF-8 BOM so Excel on Windows reads the accented
    // French place names as UTF-8 instead of Latin-1.
    res.send("﻿" + lines.join("\r\n"));
  }),
};
