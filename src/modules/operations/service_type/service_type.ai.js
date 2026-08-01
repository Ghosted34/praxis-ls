"use strict";
/**
 * AI manifest. Read-only on purpose: the service taxonomy is configuration that
 * everything else classifies against (milestone templates, dictionary items, the
 * Control Tower's transport mode), so it is not something the assistant should
 * be proposing changes to on a user's behalf.
 */
module.exports = {
  module: "MOD-29",
  reads: [
    {
      action_key: "service_type.list",
      title: "List service types",
      description: "The tenant's service taxonomy (sea import, air import, hinterland transit…) with milestone-template coverage.",
      handler: "list",
    },
  ],
  writes: [],
};
