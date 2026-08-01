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
 * services do we sell, and which are missing a milestone template".
 */
const service = require("./service_type.service");

module.exports = {
  entity: "service_type",
  module_key: "MOD-29",
  screens: ["operations/service-types"],
  reads: [
    {
      key: "list_service_types",
      service: service.list,
      describe: "List the service taxonomy, with milestone-template coverage per service type.",
    },
    {
      key: "get_service_type",
      service: service.get,
      describe: "Get a service type by id.",
    },
  ],
  writes: [],
};
