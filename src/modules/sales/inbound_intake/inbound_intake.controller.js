"use strict";
const service = require("./inbound_intake.service");
const rules = require("./inbound_intake.rules");
const { asyncHandler } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };

/** The export's columns, in the order an operator expects to read them. */
const EXPORT_COLUMNS = [
  "created_at", "status", "enquiry_type", "name", "company_name",
  "email", "phone", "subject", "message", "internal_notes",
  "responded_at", "lead_id", "partnership_request_id", "source",
];

/**
 * RFC 4180 escaping, plus the leading-formula guard.
 *
 * A cell beginning = + - or @ is executed as a formula by Excel and Sheets when
 * the file is opened, and EVERY text field in this register is written by a
 * stranger through a public contact form — this is the most attacker-exposed
 * export in the product. Prefixing a tab neutralises it and still displays as
 * typed. Without it, "=HYPERLINK(...)" typed into the website's message box
 * runs on the machine of whoever exports the desk.
 */
function csvCell(v) {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "\t" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

module.exports = {
  /* ─── enquiries ─────────────────────────────────────────────────────────── */

  /** { rows, total, kpi, limit, offset } — the list and its summary in one trip. */
  listEnquiries: asyncHandler(async (req, res) => {
    res.json(await req.tenantDb((c) => service.listEnquiries(c, req.query)));
  }),

  getEnquiry: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.getEnquiry(c, req.params.id)) }),
  ),

  createEnquiry: asyncHandler(async (req, res) =>
    res.status(201).json({ data: await req.tenantDb((c) => service.submitEnquiry(c, { data: req.body, actor: actor(req) })) }),
  ),

  updateEnquiry: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.updateEnquiry(c, { id: req.params.id, patch: req.body, actor: actor(req) })) }),
  ),

  /**
   * Opening the message marks it read — the legacy drawer does this on open,
   * and it is what makes "New (unread)" mean unread rather than un-triaged.
   * Idempotent, so the screen can fire it without checking first.
   */
  markRead: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.markRead(c, { id: req.params.id, actor: actor(req) })) }),
  ),

  transition: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.transition(c, { id: req.params.id, to: req.body.to, actor: actor(req) })) }),
  ),

  /**
   * Send the reply. Returns the enquiry AND the settled attempt, so the drawer
   * can show what went out rather than just a green tick.
   */
  respond: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.respond(c, { id: req.params.id, body: req.body.body, subject: req.body.subject || null, actor: actor(req) })) }),
  ),

  triage: asyncHandler(async (req, res) => {
    const b = req.body;
    res.json({ data: await req.tenantDb((c) => service.triageEnquiry(c, {
      id: req.params.id,
      toLead: b.to_lead === true,
      toPartnership: b.to_partnership === true,
      close: b.close === true,
      actor: actor(req),
    })) });
  }),

  /** The tile vocabulary, so the register does not keep its own copy of the
   *  status list and drift from the one the API partitions on. */
  tiles: asyncHandler(async (_req, res) =>
    res.json({ data: {
      keys: rules.KPI_TILES,
      labels: rules.TILE_LABELS,
      statuses: rules.STATUSES,
      enquiry_types: rules.ENQUIRY_TYPES,
      type_labels: rules.TYPE_LABELS,
    } }),
  ),

  /**
   * CSV export of the current view.
   *
   * Unpaginated via service.listEnquiriesForExport — NOT the list with a large
   * page size, which `page()` clamps to 200 while reading only `limit`/`offset`.
   * When the cap does bite, the response says so in a header rather than handing
   * over a prefix that looks complete.
   */
  exportCsv: asyncHandler(async (req, res) => {
    const { rows, truncated } = await req.tenantDb((c) => service.listEnquiriesForExport(c, req.query));
    const lines = [EXPORT_COLUMNS.join(",")];
    for (const r of rows) lines.push(EXPORT_COLUMNS.map((h) => csvCell(r[h])).join(","));
    const filename = `contact_enquiries_${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("X-Export-Row-Count", String(rows.length));
    if (truncated) res.setHeader("X-Export-Truncated", `true; capped at ${service.EXPORT_CAP} rows — narrow the filter`);
    // CRLF per RFC 4180, and a UTF-8 BOM so Excel on Windows reads accented
    // French names as UTF-8 instead of Latin-1.
    res.send("﻿" + lines.join("\r\n"));
  }),

  /* ─── partnership requests (F10 territory — unchanged) ──────────────────── */

};
