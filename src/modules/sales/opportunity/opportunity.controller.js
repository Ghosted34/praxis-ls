"use strict";
const service = require("./opportunity.service");
const { asyncHandler, AppError } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };

/**
 * CSV cell. Quotes only when it has to, so numbers stay unquoted and Excel
 * types the money columns as numbers rather than text — a quoted "5000000.00"
 * lands left-aligned and will not SUM, which is the whole point of the export.
 */
function csvCell(v) {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString() : String(v);
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

module.exports = {
  list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.list(c, req.query)) })),
  board: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.board(c, req.query)) })),
  metrics: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.metrics(c, req.query)) })),
  stages: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.stages(c)) })),
  get: asyncHandler(async (req, res) => { const r = await req.tenantDb((c) => service.get(c, req.params.id)); if (!r) throw new AppError("NOT_FOUND", "Opportunity not found", 404); res.json({ data: r }); }),
  create: asyncHandler(async (req, res) => res.status(201).json({ data: await req.tenantDb((c) => service.create(c, { data: req.body, actor: actor(req) })) })),
  update: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.update(c, { id: req.params.id, patch: req.body, actor: actor(req) })) })),
  move: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.moveStage(c, { id: req.params.id, pipelineStageId: req.body.pipeline_stage_id, actor: actor(req) })) })),
  win: asyncHandler(async (req, res) => { const b = req.body; res.json({ data: await req.tenantDb((c) => service.win(c, { id: req.params.id, createDossier: b.create_dossier === true, entityId: b.entity_id, serviceTypeId: b.service_type_id, actor: actor(req) })) }); }),
  lose: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.lose(c, { id: req.params.id, actor: actor(req) })) })),

  /**
   * CSV export of the pipeline under the caller's current filters — the legacy
   * has this (sales-pipelining.php ~803) and this system did not.
   *
   * Two Excel-specific choices, both deliberate: a UTF-8 BOM, because Excel on
   * Windows reads a BOM-less UTF-8 file as the local codepage and a French
   * client name comes out mangled; and CRLF, which Excel and Numbers both
   * expect. The money columns carry no symbol, no separator and no quotes.
   */
  exportCsv: asyncHandler(async (req, res) => {
    const rows = await req.tenantDb((c) => service.listForExport(c, req.query));
    const header = [
      "name", "status", "stage_code", "stage_name", "estimated_value", "currency",
      "probability", "weighted_value", "source", "source_ref", "scope_summary",
      "owner_name", "client_name", "lead_company", "created_at", "updated_at", "settled_at",
    ];
    const lines = [header.join(",")];
    for (const r of rows) lines.push(header.map((h) => csvCell(r[h])).join(","));
    const filename = `sales_pipeline_${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send("﻿" + lines.join("\r\n"));
  }),
};
