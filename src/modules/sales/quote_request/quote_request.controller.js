"use strict";
const service = require("./quote_request.service");
const { asyncHandler, AppError } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };

module.exports = {
  list: asyncHandler(async (req, res) => {
    const out = await req.tenantDb((c) => service.list(c, req.query));
    // Return list + total + KPI tiles in a single response — the legacy
    // makes two trips; we don't.
    res.json(out);
  }),

  get: asyncHandler(async (req, res) => {
    const r = await req.tenantDb((c) => service.get(c, req.params.id));
    if (!r) throw new AppError("NOT_FOUND", "Quote request not found", 404);
    res.json({ data: r });
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

  listAttachments: asyncHandler(async (req, res) => {
    const r = await req.tenantDb((c) => service.listAttachments(c, req.params.id));
    res.json({ data: r });
  }),

  addAttachment: asyncHandler(async (req, res) => {
    const { vault_id, kind } = req.body;
    if (!vault_id) throw new AppError("VALIDATION_ERROR", "vault_id is required", 422);
    const r = await req.tenantDb((c) => service.addAttachment(c, { id: req.params.id, vault_id, kind, actor: actor(req) }));
    res.status(201).json({ data: r });
  }),

  removeAttachment: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.removeAttachment(c, { id: req.params.id, attachment_id: req.params.attachmentId, actor: actor(req) })) }),
  ),

  /**
   * CSV export. Streams the same `list` query (without pagination) into a
   * CSV. Status / channel / month / year filters apply — the legacy's
   * export used the same WHERE; we keep that so the user's "current view"
   * can be saved as-is.
   */
  exportCsv: asyncHandler(async (req, res) => {
    const { rows } = await req.tenantDb((c) => service.list(c, { ...req.query, page: 1, pageSize: 100000 }));
    const header = [
      "public_ref", "status", "intake_channel", "service_category", "service_type",
      "incoterm", "origin_location", "destination_location", "estimated_weight",
      "project_cargo_flag", "warehouse_duration", "requester_name", "requester_company",
      "requester_email", "requester_phone", "cargo_description", "created_at",
    ];
    const escape = (v) => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    };
    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push(header.map((h) => escape(r[h])).join(","));
    }
    const filename = `quote_requests_${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(lines.join("\n"));
  }),
};
