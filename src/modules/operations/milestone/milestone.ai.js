"use strict";
const service = require("./milestone.service");
const validator = require("./milestone.validator");
module.exports = {
  entity: "milestone", module_key: "MOD-31", screens: [],
  reads: [
    { key: "list_milestone_templates", service: service.listTemplates, describe: "List milestone templates." },
    { key: "dossier_milestones", service: service.listByDossier, describe: "List a dossier's milestone instances." },
  ],
  writes: [
    { key: "publish_milestone_template", service: service.publishTemplate, schema: validator.schemas.publishTemplate, permission: { module: "MOD-31", action: "create" }, confirm: true, describe: "Publish a new active milestone template version for a service type." },
    { key: "instantiate_milestones", service: service.instantiate, schema: validator.schemas.instantiate, permission: { module: "MOD-31", action: "create" }, confirm: true, describe: "Instantiate the active template's stages onto a dossier." },
    { key: "advance_milestone", service: service.advance, schema: validator.schemas.advance, permission: { module: "MOD-31", action: "edit" }, confirm: true, describe: "Advance a milestone stage (IN_PROGRESS/DONE/BLOCKED) with evidence." },
  ],
};
