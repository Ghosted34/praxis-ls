"use strict";
const service = require("./success_story.service");
const validator = require("./success_story.validator");
module.exports = {
  entity: "success_story", module_key: "MOD-26", screens: [],
  reads: [
    { key: "list_success_stories", service: (c, p) => service.list(c, p), permission: { module: "MOD-26", action: "view" }, describe: "List portfolio success stories (published_only filter)." },
    { key: "get_success_story", service: (c, p) => service.get(c, p.id || p), permission: { module: "MOD-26", action: "view" }, describe: "Get a success story by id." },
  ],
  writes: [
    { key: "generate_success_story", service: (c,p) => service.generate(c,{dossierIds:p.dossier_ids,roughNotes:p.rough_notes}), schema: validator.schemas.generate, permission: { module: "MOD-26", action: "create" }, confirm: true, describe: "Draft structured case-study copy from completed operations files." },
    { key: "create_success_story", service: (c, p) => service.create(c, { data: p }), schema: validator.schemas.create, permission: { module: "MOD-26", action: "create" }, confirm: true, describe: "Draft a success story (AI-assisted)." },
    { key: "publish_success_story", service: (c, p) => service.publish(c, p), schema: validator.schemas.update, permission: { module: "MOD-26", action: "approve" }, confirm: true, describe: "Publish a signed-off success story." },
  ],
};
