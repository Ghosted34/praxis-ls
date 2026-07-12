"use strict";
const service = require("./opportunity.service");
const validator = require("./opportunity.validator");
module.exports = {
  entity: "opportunity", module_key: "MOD-24", screens: [],
  reads: [
    { key: "list_opportunities", service: (c, p) => service.list(c, p), describe: "List sales opportunities (filter stage/status/owner)." },
    { key: "pipeline_board", service: (c) => service.board(c), describe: "Kanban board: open opportunities + value/weighted value per stage." },
    { key: "get_opportunity", service: (c, p) => service.get(c, p.id || p), describe: "Get an opportunity by id." },
  ],
  writes: [
    { key: "create_opportunity", service: (c, p) => service.create(c, { data: p }), schema: validator.schemas.create, permission: { module: "MOD-24", action: "create" }, confirm: true, describe: "Create a pipeline opportunity." },
    { key: "move_opportunity", service: (c, p) => service.moveStage(c, p), schema: validator.schemas.move, permission: { module: "MOD-24", action: "edit" }, confirm: true, describe: "Move an opportunity to a pipeline stage." },
    { key: "win_opportunity", service: (c, p) => service.win(c, p), schema: validator.schemas.win, permission: { module: "MOD-24", action: "edit" }, confirm: true, describe: "Mark won (optionally open the delivery dossier)." },
  ],
};
