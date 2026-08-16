"use strict";
const service = require("./delivery_note.service");
const { asyncHandler, AppError } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };
module.exports = {
  list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.list(c, req.query)) })),
  get: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.get(c, req.params.id));
    if (!row) throw new AppError("NOT_FOUND", "Delivery note not found", 404);
    res.json({ data: row });
  }),
  create: asyncHandler(async (req, res) => {
    const b = req.body;
    const data = await req.tenantDb((c) => service.create(c, {
      entityId: b.entity_id, dossierId: b.dossier_id, consignee: b.consignee,
      cityZone: b.city_zone, contactPerson: b.contact_person,
      address: b.address, phone: b.phone, deliveryDate: b.delivery_date,
      lines: b.lines, date: b.date, actor: actor(req),
    }));
    res.status(201).json({ data });
  }),
};
