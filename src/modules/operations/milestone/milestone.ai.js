"use strict";
/**
 * AI manifest for the milestone engine.
 *
 * The reads are the interesting half: "which files are forecast to breach", and
 * "who is costing us time" are questions the assistant can now answer from the
 * chain itself, because the engine records variance and attribution rather than
 * just a status.
 *
 * `reopen` is deliberately NOT exposed as a write. Un-completing a milestone
 * rewrites the anchor every downstream date is measured from and voids the
 * variance already recorded against it; that needs a human who can state a
 * reason, not an assistant acting on an inferred one.
 */
const service = require("./milestone.service");
const validator = require("./milestone.validator");
module.exports = {
  entity: "milestone", module_key: "MOD-31", screens: [],
  reads: [
    { key: "list_milestone_templates", service: service.listTemplates, permission: { module: "MOD-31", action: "view" }, describe: "List milestone templates." },
    { key: "dossier_milestones", service: service.listByDossier, permission: { module: "MOD-31", action: "view" }, describe: "List a dossier's milestone instances, with baseline / planned / forecast dates, health and delay attribution." },
    { key: "service_type_assumptions", service: (c, p) => service.listAssumptions(c, (p && p.service_type_id) || p), permission: { module: "MOD-31", action: "view" }, describe: "The published scheduling assumptions for a service type (counterparty hours, free time, force-majeure exclusions)." },
  ],
  writes: [
    { key: "publish_milestone_template", service: service.publishTemplate, schema: validator.schemas.publishTemplate, permission: { module: "MOD-31", action: "create" }, confirm: true, describe: "Publish a new active milestone template version for a service type (3–15 stages)." },
    { key: "instantiate_milestones", service: service.instantiate, schema: validator.schemas.instantiate, permission: { module: "MOD-31", action: "create" }, confirm: true, describe: "Instantiate the active template's stages onto a dossier." },
    { key: "advance_milestone", service: service.advance, schema: validator.schemas.advance, permission: { module: "MOD-31", action: "edit" }, confirm: true, describe: "Advance a milestone stage (IN_PROGRESS/DONE/BLOCKED) with evidence; completing one re-forecasts the rest of the chain." },
  ],
};
