"use strict";
/**
 * AI manifest for the service taxonomy.
 *
 * READ-ONLY on purpose. Service types are configuration that everything else
 * classifies against — milestone templates hang off them,
 * `dictionary_item.service_type_key` references them, and they drive the Control
 * Tower's transport mode. `key` is immutable after creation precisely because a
 * rename orphans those references, so this is not a surface the assistant should
 * be proposing changes to on a user's behalf. Reads let it answer "which
 * services do we sell, which are missing a milestone template, and what is
 * classified under a given one".
 *
 * The screen is `master/service-types` — the taxonomy lives in the Master Data
 * hub in the UI; the backend module stays under `operations` because it rides
 * MOD-29 with the dossier (see service_type.events.js for why).
 */
const service = require("./service_type.service");
const dossier360 = require("./service_type_360.service");

module.exports = {
  entity: "service_type",
  module_key: "MOD-29",
  screens: ["master/service-types"],
  reads: [
    {
      key: "list_service_types",
      service: service.list, permission: { module: "MOD-29", action: "view" },
      describe: "List the service taxonomy, with milestone-template coverage per service type.",
    },
    {
      key: "get_service_type",
      service: service.get, permission: { module: "MOD-29", action: "view" },
      describe: "Get a service type by id.",
    },
    {
      // Payload accepts `service_type_id` (the AI's usual field name) or the
      // raw id string, matching how the entity-360 read is called
      // (corporate_entity.ai.js:26). Money keys arrive masked because the AI
      // read does not carry a request context to resolve MOD-09 grants against
      // — a caller who needs the money should open the screen.
      key: "get_service_type_360",
      service: (c, p) => dossier360.dossier(c, (p && p.service_type_id) || p, { canSeeFinancials: false }), permission: { module: "MOD-29", action: "view" },
      describe: "Full dossier for one service type: milestone templates and their stages, applicable financial dictionary items, recent dossiers and margin simulations, and the money rollup (billed / planned / actual — masked without finance visibility).",
    },
  ],
  writes: [],
};
