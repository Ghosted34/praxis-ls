"use strict";
const { makeController } = require("../../../shared/crud/resource");
const { asyncHandler, AppError } = require("../../../utils/errors");
const service = require("./inventory.service");

const actor = (req) => req.user || { user_id: null };
const base = makeController(service, "Inventory item");

module.exports = {
  ...base,
  setState: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.setState(c, { id: req.params.id, state: req.body.state, actor: actor(req) }));
    if (!row) throw new AppError("NOT_FOUND", "Inventory item not found", 404);
    res.json({ data: row });
  }),
  move: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) =>
      service.move(c, {
        id: req.params.id,
        movement_kind: req.body.movement_kind,
        qty: req.body.qty,
        from_location: req.body.from_location,
        to_location: req.body.to_location,
        actor: actor(req),
      }),
    );
    if (!row) throw new AppError("NOT_FOUND", "Inventory item not found", 404);
    res.json({ data: row });
  }),
  movements: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => service.listMovements(c, req.params.id)) });
  }),
};
