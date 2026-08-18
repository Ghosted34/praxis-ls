"use strict";
const service = require("./opportunity.service");
const validator = require("./opportunity.validator");
module.exports = {
  entity: "opportunity", module_key: "MOD-24", screens: [],
  reads: [
    { key: "list_opportunities", service: (c, p) => service.list(c, p), permission: { module: "MOD-24", action: "view" }, describe: "List sales opportunities (filter stage/status/owner/source/date/search)." },
    { key: "pipeline_board", service: (c, p) => service.board(c, p), permission: { module: "MOD-24", action: "view" }, describe: "Kanban board: open opportunities + value/weighted value per stage." },
    { key: "pipeline_metrics", service: (c, p) => service.metrics(c, p), permission: { module: "MOD-24", action: "view" }, describe: "Pipeline KPIs: open pipeline value, weighted forecast, won value, and BOTH win rates — win_rate_settled (won / won+lost, the headline) and win_rate_all_deals (won / every deal, the legacy denominator). Null means no deals in the denominator, which is not the same as 0%." },
    { key: "get_opportunity", service: (c, p) => service.get(c, p.id || p), permission: { module: "MOD-24", action: "view" }, describe: "Get an opportunity by id." },
  ],
  writes: [
    { key: "create_opportunity", service: (c, p) => service.create(c, { data: p }), schema: validator.schemas.create, permission: { module: "MOD-24", action: "create" }, confirm: true, describe: "Create a pipeline opportunity. Lands in the first open stage and inherits that stage's probability unless one is given." },
    { key: "move_opportunity", service: (c, p) => service.moveStage(c, { id: p.opportunity_id, pipelineStageId: p.pipeline_stage_id }), schema: validator.schemas.aiMove, permission: { module: "MOD-24", action: "edit" }, confirm: true, describe: "Move an opportunity (by id) to a pipeline stage. A settled opportunity refuses to move." },
    { key: "win_opportunity", service: (c, p) => service.win(c, { id: p.opportunity_id, createDossier: p.create_dossier, entityId: p.entity_id, serviceTypeId: p.service_type_id }), schema: validator.schemas.aiWin, permission: { module: "MOD-24", action: "edit" }, confirm: true, describe: "Mark an opportunity (by id) won (optionally open the delivery dossier)." },
  ],
};
