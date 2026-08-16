"use strict";
const service = require("./partnership_request.service");
const rules = require("./partnership_request.rules");
const { asyncHandler, AppError } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };

/** The export's columns, in the order a vetting file is read in. */
const EXPORT_COLUMNS = [
  "company_name", "country_of_origin", "proposal_type", "status",
  "network_memberships", "contact_name", "contact_title", "email", "contact_phone",
  "website", "intake_channel", "internal_notes", "decision_reason",
  "reviewed_at", "supplier_id", "created_at",
];

/**
 * RFC 4180 escaping plus the leading-formula guard.
 *
 * A cell beginning = + - or @ is executed as a formula by Excel and Sheets on
 * open, and every text field here is supplied by an applicant through a public
 * form. A leading tab neutralises it and still displays as typed.
 */
function csvCell(v) {
  if (v === null || v === undefined) return "";
  let s = Array.isArray(v) ? v.join("; ") : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "\t" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

module.exports = {
  /** { rows, total, kpi, limit, offset } — the register and its tiles in one trip. */
  list: asyncHandler(async (req, res) => {
    res.json(await req.tenantDb((c) => service.list(c, req.query)));
  }),

  get: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.get(c, req.params.id));
    if (!row) throw new AppError("NOT_FOUND", "Partnership request not found", 404);
    res.json({ data: row });
  }),

  create: asyncHandler(async (req, res) =>
    res.status(201).json({ data: await req.tenantDb((c) => service.create(c, { data: req.body, actor: actor(req) })) })),

  update: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.update(c, { id: req.params.id, patch: req.body, actor: actor(req) })) })),

  transition: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.transition(c, { id: req.params.id, to: req.body.to, reason: req.body.reason, notes: req.body.notes, actor: actor(req) })) })),

  approve: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.approve(c, { id: req.params.id, create_supplier: req.body.create_supplier, supplier: req.body.supplier || {}, notes: req.body.notes, actor: actor(req) })) })),

  reject: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.reject(c, { id: req.params.id, reason: req.body.reason, notes: req.body.notes, actor: actor(req) })) })),

  /** The tile vocabulary, so the register does not keep its own copy of it. */
  tiles: asyncHandler(async (_req, res) =>
    res.json({ data: { keys: rules.KPI_TILES, labels: rules.TILE_LABELS, statuses: rules.STATUSES, types: rules.TYPES } })),

  uploadProfile: asyncHandler(async (req, res) => {
    const out = await req.tenantDb((c) => service.uploadProfile(c, {
      id: req.params.id, dataUrl: req.body.file, filename: req.body.filename || null,
      slug: req.tenant && req.tenant.slug, actor: actor(req),
    }));
    res.status(201).json({ data: out });
  }),

  /**
   * CSV export of the current view. Unpaginated via listForExport — NOT list()
   * with a large page size, which `page()` clamps to 200 and silently truncates.
   * When the cap does bite, the response says so in a header.
   */
  exportCsv: asyncHandler(async (req, res) => {
    const { rows, truncated } = await req.tenantDb((c) => service.listForExport(c, req.query));
    const lines = [EXPORT_COLUMNS.join(",")];
    for (const r of rows) lines.push(EXPORT_COLUMNS.map((h) => csvCell(r[h])).join(","));
    const filename = `partnership_requests_${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("X-Export-Row-Count", String(rows.length));
    if (truncated) res.setHeader("X-Export-Truncated", `true; capped at ${service.EXPORT_CAP} rows — narrow the filter`);
    // CRLF per RFC 4180, and a UTF-8 BOM so Excel on Windows reads accented
    // company names as UTF-8 rather than Latin-1.
    res.send("﻿" + lines.join("\r\n"));
  }),
};
