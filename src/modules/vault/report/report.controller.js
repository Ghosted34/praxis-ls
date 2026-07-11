"use strict";
const service = require("./report.service");
const { asyncHandler } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };
module.exports = {
  catalogue: asyncHandler(async (_req, res) => res.json({ data: service.catalogue() })),
  run: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.run(c, { reportKey: req.params.key, params: req.query })) })),
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
};
