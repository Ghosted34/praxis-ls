"use strict";
const service = require("./financial_dictionary.service");
const { asyncHandler, AppError } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };

module.exports = {
  list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.listItems(c, req.query)) })),
  get: asyncHandler(async (req, res) => {
    const r = await req.tenantDb((c) => service.get(c, req.params.id));
    if (!r) throw new AppError("NOT_FOUND", "Dictionary item not found", 404);
    res.json({ data: r });
  }),
  dossier: asyncHandler(async (req, res) => {
    const r = await req.tenantDb((c) => service.dossier(c, req.params.id));
    if (!r) throw new AppError("NOT_FOUND", "Dictionary item not found", 404);
    res.json({ data: r });
  }),
  create: asyncHandler(async (req, res) => res.status(201).json({ data: await req.tenantDb((c) => service.create(c, { data: req.body, actor: actor(req) })) })),
  update: asyncHandler(async (req, res) => {
    const r = await req.tenantDb((c) => service.update(c, { id: req.params.id, patch: req.body, actor: actor(req) }));
    if (!r) throw new AppError("NOT_FOUND", "Dictionary item not found", 404);
    res.json({ data: r });
  }),

  // dictionary_ref registry (the seeded-but-editable dropdown values).
  listRefs: asyncHandler(async (req, res) => {
    const kind = String(req.query.kind || "").toUpperCase();
    if (!kind) throw new AppError("VALIDATION_ERROR", "kind is required", 422);
    const includeInactive = req.query.include_inactive === "true";
    res.json({ data: await req.tenantDb((c) => service.listRefs(c, kind, includeInactive)) });
  }),
  createRef: asyncHandler(async (req, res) => res.status(201).json({ data: await req.tenantDb((c) => service.createRef(c, { data: req.body, actor: actor(req) })) })),
  updateRef: asyncHandler(async (req, res) => {
    const r = await req.tenantDb((c) => service.updateRef(c, { id: req.params.id, patch: req.body, actor: actor(req) }));
    if (!r) throw new AppError("NOT_FOUND", "Reference value not found", 404);
    res.json({ data: r });
  }),
};
