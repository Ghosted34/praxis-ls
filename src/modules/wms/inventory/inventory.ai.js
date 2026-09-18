/** AI action manifest (AI_READINESS Rule 1) for inventory. */
"use strict";

const service = require("./inventory.service");
const validator = require("./inventory.validator");

module.exports = {
  entity: "inventory",
  module_key: "MOD-35",
  screens: ["inventory"],

  reads: [
    { key: "list_inventory", service: service.list, permission: { module: "MOD-35", action: "view" }, describe: "List inventory items (stock on hand)." },
    { key: "get_inventory", service: service.get, permission: { module: "MOD-35", action: "view" }, describe: "Get one inventory item by id." },
    { key: "list_movements", service: service.listMovements, permission: { module: "MOD-35", action: "view" }, describe: "List the stock-movement journal for an item." },
  ],

  writes: [
    {
      key: "create_inventory",
      service: (c, p, actor) => service.create(c, { data: p, actor }),
      schema: validator.schemas.create,
      permission: { module: "MOD-35", action: "create" },
      confirm: true,
      describe: "Create an inventory item (client goods or own stock).",
    },
    {
      key: "update_inventory",
      service: (c, p, actor) => (({ inventory_item_id, ...patch }) => service.update(c, { id: inventory_item_id, patch, actor }))(p),
      schema: validator.schemas.aiUpdate,
      permission: { module: "MOD-35", action: "edit" },
      confirm: true,
      describe: "Update an inventory item.",
    },
    {
      key: "set_inventory_state",
      service: (c, p, actor) => service.setState(c, { id: p.inventory_item_id, state: p.state, actor }),
      schema: validator.schemas.aiState,
      permission: { module: "MOD-35", action: "edit" },
      confirm: true,
      describe: "Change stock state (AVAILABLE / QA_HOLD / ALLOCATED / DISPATCHED / DAMAGED).",
    },
    {
      key: "move_inventory",
      service: (c, p, actor) => service.move(c, { id: p.inventory_item_id, movement_kind: p.movement_kind, qty: p.qty, from_location: p.from_location, to_location: p.to_location, actor }),
      schema: validator.schemas.aiMove,
      permission: { module: "MOD-35", action: "edit" },
      confirm: true,
      describe: "Journal a stock movement (signed qty) and optionally relocate the item.",
    },
  ],
};
