"use strict";
const service = require("./report.service");
const templateSvc = require("../../documents/template/template.service");
const reportExport = require("./report-export");
const { resolveContext, exportFilename } = require("../../../services/spreadsheet");
const { asyncHandler } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };
module.exports = {
  catalogue: asyncHandler(async (_req, res) => res.json({ data: service.catalogue() })),
  run: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.run(c, { reportKey: req.params.key, params: req.query })) })),
  // Run + render a branded PDF (kit + tenant config) and vault it. RBAC-masked by
  // the producer before it reaches the template.
  runPdf: asyncHandler(async (req, res) => {
    const out = await req.tenantDb(async (c) => {
      const result = await service.run(c, { reportKey: req.params.key, params: req.body.params || req.query });
      return templateSvc.renderPdfFromData(c, { docType: req.params.key, data: result.data, entityId: req.body.entity_id || null, actor: actor(req) });
    });
    res.status(201).json({ data: out });
  }),
  // Run + stream the report as csv or xlsx (?format=csv|xlsx). The branded
  // spreadsheet toolkit renders it; PDF keeps its own vaulting endpoint above.
  runExport: asyncHandler(async (req, res) => {
    const format = String(req.query.format || "csv").toLowerCase();
    const file = await req.tenantDb(async (c) => {
      const result = await service.run(c, { reportKey: req.params.key, params: req.query });
      // Brand/language/currency resolved on the SAME pinned connection as the
      // data, so a sandbox request exports sandbox-branded output.
      const context = await resolveContext(c, {
        title: reportExport.sheetName(req.params.key),
        filters: req.query,
        actor: actor(req),
      });
      return reportExport.toExport(req.params.key, result.data, format, context);
    });
    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${exportFilename({ base: req.params.key, env: req.env, extension: file.extension })}"`);
    res.send(file.buffer);
  }),
  listSaved: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.listSaved(c, req.query, actor(req))) })),
  save: asyncHandler(async (req, res) => {
    const b = req.body;
    res.status(201).json({ data: await req.tenantDb((c) => service.saveReport(c, { name: b.name, reportKey: b.report_key, params: b.params, isShared: b.is_shared, actor: actor(req) })) });
  }),
  runSaved: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.runSaved(c, { id: req.params.id, overrides: req.query, actor: actor(req) })) })),
  deleteSaved: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.deleteSaved(c, { id: req.params.id, actor: actor(req) })) })),
  tiles: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.listTiles(c, actor(req))) })),
  setTile: asyncHandler(async (req, res) => {
    const b = req.body;
    res.json({ data: await req.tenantDb((c) => service.setTile(c, { tileKey: b.tile_key, position: b.position, isVisible: b.is_visible, config: b.config, actor: actor(req) })) });
  }),

  // Scheduled reports (1.3)
  listScheduled: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.listSchedules(c, req.query)) })),
  createSchedule: asyncHandler(async (req, res) => res.status(201).json({ data: await req.tenantDb((c) => service.createSchedule(c, { input: req.body, actor: actor(req) })) })),
  updateSchedule: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.updateSchedule(c, { id: req.params.id, patch: req.body, actor: actor(req) })) })),
  deleteSchedule: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.deleteSchedule(c, { id: req.params.id, actor: actor(req) })) })),
  runDue: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.runDue(c, { tenantMeta: req.tenant, env: req.env, actor: actor(req) })) })),
};
