/** AI action manifest (AI_READINESS Rule 1) for inventory. */
"use strict";

const service = require("./inventory.service");
const validator = require("./inventory.validator");

module.exports = {
  entity: "inventory",
  module_key: "MOD-35",
  screens: ["inventory"],

  reads: [
    { key: "list_inventory", service: service.list, describe: "List inventory items (stock on hand)." },
    { key: "get_inventory", service: service.get, describe: "Get one inventory item by id." },
    { key: "list_movements", service: service.listMovements, describe: "List the stock-movement journal for an item." },
  ],

  writes: [
    {
      key: "create_inventory",
      service: service.create,
      schema: validator.schemas.create,
      permission: { module: "MOD-35", action: "create" },
      confirm: true,
      describe: "Create an inventory item (client goods or own stock).",
    },
    {
      key: "update_inventory",
      service: service.update,
      schema: validator.schemas.update,
      permission: { module: "MOD-35", action: "edit" },
      confirm: true,
      describe: "Update an inventory item.",
    },
    {
      key: "set_inventory_state",
      service: service.setState,
      schema: validator.schemas.state,
      permission: { module: "MOD-35", action: "edit" },
      confirm: true,
      describe: "Change stock state (AVAILABLE / QA_HOLD / ALLOCATED / DISPATCHED / DAMAGED).",
    },
    {
      key: "move_inventory",
      service: service.move,
      schema: validator.schemas.move,
      permission: { module: "MOD-35", action: "edit" },
      confirm: true,
      describe: "Journal a stock movement (signed qty) and optionally relocate the item.",
    },
  ],
};
