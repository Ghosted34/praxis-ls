"use strict";
const service = require("./delivery_note.service");
const { asyncHandler, AppError } = require("../../../utils/errors");

const actor = (req) => req.user || { user_id: null };

/** Only the keys the caller actually sent — an absent key must not blank a column. */
const patchOf = (b) => {
  const out = {};
  const keys = [
    "dossier_id", "entity_id", "consignee", "city_zone", "contact_person",
    "address", "phone", "delivery_date", "reservations",
  ];
  for (const k of keys) if (b[k] !== undefined) out[k] = b[k];
  return out;
};

module.exports = {
  list: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.list(c, req.query)) })),

  /** KPI tiles, counted in the database rather than over one loaded page. */
  summary: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.summary(c, req.query)) })),

  /** The file's containers, for the picker that replaced the paste box. */
  availableContainers: asyncHandler(async (req, res) =>
    res.json({
      data: await req.tenantDb((c) => service.availableContainers(c, {
        dossierId: req.query.dossier_id,
        excludeNoteId: req.query.exclude_note_id || null,
      })),
    })),

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
      lines: b.lines, containers: b.containers, actor: actor(req),
    }));
    res.status(201).json({ data });
  }),

  update: asyncHandler(async (req, res) => {
    const b = req.body;
    const data = await req.tenantDb((c) => service.update(c, {
      id: req.params.id, patch: patchOf(b),
      lines: b.lines === undefined ? null : b.lines,
      containers: b.containers === undefined ? null : b.containers,
      actor: actor(req),
    }));
    res.json({ data });
  }),

  issue: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.issue(c, { id: req.params.id, actor: actor(req) })) })),

  deliver: asyncHandler(async (req, res) => {
    const b = req.body;
    const data = await req.tenantDb((c) => service.confirmDelivery(c, {
      id: req.params.id, receivedByName: b.received_by_name, receivedAt: b.received_at,
      reservations: b.reservations, signatureVaultId: b.signature_vault_id, actor: actor(req),
    }));
    res.json({ data });
  }),

  cancel: asyncHandler(async (req, res) =>
    res.json({
      data: await req.tenantDb((c) => service.cancel(c, {
        id: req.params.id, reason: req.body.reason, actor: actor(req),
      })),
    })),

  transition: asyncHandler(async (req, res) =>
    res.json({
      data: await req.tenantDb((c) => service.transition(c, {
        id: req.params.id, to: req.body.to, reason: req.body.reason,
        receivedByName: req.body.received_by_name, actor: actor(req),
      })),
    })),
};
