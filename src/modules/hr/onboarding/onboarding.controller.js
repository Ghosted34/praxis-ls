"use strict";
const { asyncHandler, AppError } = require("../../../utils/errors");
const service = require("./onboarding.service");

const db = (req) => req.tenantDb;
const actor = (req) => req.user || { user_id: null };

module.exports = {
  list: asyncHandler(async (req, res) => res.json({ data: await db(req)((c) => service.list(c, req.query)) })),

  get: asyncHandler(async (req, res) => {
    const row = await db(req)((c) => service.get(c, req.params.id));
    if (!row) throw new AppError("NOT_FOUND", "Onboarding checklist not found", 404);
    res.json({ data: row });
  }),

  create: asyncHandler(async (req, res) =>
    res.status(201).json({
      data: await db(req)((c) => service.create(c, {
        employee_id: req.body.employee_id,
        template_id: req.body.template_id,
        starts_on: req.body.starts_on,
        items: req.body.items,
        actor: actor(req),
      })),
    })),

  reschedule: asyncHandler(async (req, res) =>
    res.json({ data: await db(req)((c) => service.reschedule(c, { id: req.params.id, startsOn: req.body.starts_on, actor: actor(req) })) })),

  addItem: asyncHandler(async (req, res) =>
    res.status(201).json({
      data: await db(req)((c) => service.addItem(c, { checklistId: req.params.id, data: req.body, actor: actor(req) })),
    })),

  updateItem: asyncHandler(async (req, res) => {
    const row = await db(req)((c) => service.updateItem(c, { itemId: req.params.itemId, patch: req.body, actor: actor(req) }));
    if (!row) throw new AppError("NOT_FOUND", "Item not found", 404);
    res.json({ data: row });
  }),

  complete: asyncHandler(async (req, res) => {
    const row = await db(req)((c) => service.complete(c, { id: req.params.id, actor: actor(req) }));
    if (!row) throw new AppError("NOT_FOUND", "Onboarding checklist not found", 404);
    res.json({ data: row });
  }),

  outstanding: asyncHandler(async (req, res) =>
    res.json({ data: await db(req)((c) => service.outstanding(c, req.query)) })),

  /* ── Templates ──────────────────────────────────────────────────────── */
  listTemplates: asyncHandler(async (req, res) =>
    res.json({ data: await db(req)((c) => service.listTemplates(c, req.query)) })),

  getTemplate: asyncHandler(async (req, res) => {
    const row = await db(req)((c) => service.getTemplate(c, req.params.templateId));
    if (!row) throw new AppError("NOT_FOUND", "Template not found", 404);
    res.json({ data: row });
  }),

  createTemplate: asyncHandler(async (req, res) =>
    res.status(201).json({ data: await db(req)((c) => service.createTemplate(c, { data: req.body, actor: actor(req) })) })),

  updateTemplate: asyncHandler(async (req, res) =>
    res.json({ data: await db(req)((c) => service.updateTemplate(c, { id: req.params.templateId, patch: req.body, actor: actor(req) })) })),

  addTemplateItem: asyncHandler(async (req, res) =>
    res.status(201).json({ data: await db(req)((c) => service.addTemplateItem(c, { templateId: req.params.templateId, data: req.body, actor: actor(req) })) })),

  updateTemplateItem: asyncHandler(async (req, res) => {
    const row = await db(req)((c) => service.updateTemplateItem(c, { itemId: req.params.itemId, patch: req.body, actor: actor(req) }));
    if (!row) throw new AppError("NOT_FOUND", "Template item not found", 404);
    res.json({ data: row });
  }),

  removeTemplateItem: asyncHandler(async (req, res) => {
    const row = await db(req)((c) => service.removeTemplateItem(c, { itemId: req.params.itemId, actor: actor(req) }));
    if (!row) throw new AppError("NOT_FOUND", "Template item not found", 404);
    res.json({ data: row });
  }),
};
