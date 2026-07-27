"use strict";
const { asyncHandler, AppError } = require("../../../utils/errors");
const service = require("./onboarding.service");

const db = (req) => req.tenantDb;
const actor = (req) => req.user || { user_id: null };

module.exports = {
  list: asyncHandler(async (req, res) => res.json({ data: await db(req)((c) => service.list(c)) })),

  get: asyncHandler(async (req, res) => {
    const row = await db(req)((c) => service.get(c, req.params.id));
    if (!row) throw new AppError("NOT_FOUND", "Onboarding checklist not found", 404);
    res.json({ data: row });
  }),

  create: asyncHandler(async (req, res) =>
    res.status(201).json({
      data: await db(req)((c) => service.create(c, { employee_id: req.body.employee_id, items: req.body.items, actor: actor(req) })),
    })),

  addItem: asyncHandler(async (req, res) =>
    res.status(201).json({
      data: await db(req)((c) => service.addItem(c, { checklistId: req.params.id, label: req.body.label })),
    })),

  toggleItem: asyncHandler(async (req, res) => {
    const row = await db(req)((c) => service.toggleItem(c, { itemId: req.params.itemId, isDone: req.body.is_done }));
    if (!row) throw new AppError("NOT_FOUND", "Item not found", 404);
    res.json({ data: row });
  }),

  complete: asyncHandler(async (req, res) => {
    const row = await db(req)((c) => service.complete(c, { id: req.params.id, actor: actor(req) }));
    if (!row) throw new AppError("NOT_FOUND", "Onboarding checklist not found", 404);
    res.json({ data: row });
  }),
};
