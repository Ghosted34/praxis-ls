/**
 * AI action manifest (AI_ARCHITECTURE §2) for rate providers (MOD-10).
 *
 * A rate provider is the carrier or authority an expense rate is scoped to, so
 * it is the lookup behind "what does MAERSK charge for this" — and the thing
 * somebody has to add before the first rate can be filed against it. The
 * expense-rate module has had a manifest all along; the provider it points at
 * did not, which left half the question answerable.
 */
"use strict";

const service = require("./rate_provider.service");
const validator = require("./rate_provider.validator");

const MOD = "MOD-10";

module.exports = {
  entity: "rate_provider",
  module_key: MOD,
  screens: [],

  reads: [
    { key: "list_rate_providers", service: service.list, permission: { module: MOD, action: "view" }, describe: "List rate providers — the carriers and authorities expense rates are scoped to (filter by kind, country or active)." },
    { key: "get_rate_provider", service: service.get, permission: { module: MOD, action: "view" }, describe: "Get one rate provider by id." },
  ],

  writes: [
    {
      key: "create_rate_provider",
      service: (c, p, actor) => service.create(c, { data: p, actor }),
      schema: validator.schemas.create,
      permission: { module: MOD, action: "create" },
      confirm: true,
      describe: "Register a rate provider (kind, code, name, carrier code, country) so expense rates can be filed against it.",
    },
    {
      key: "update_rate_provider",
      service: (c, p, actor) => (({ rate_provider_id, ...patch }) => service.update(c, { id: rate_provider_id, patch, actor }))(p),
      schema: validator.schemas.aiUpdate,
      permission: { module: MOD, action: "edit" },
      confirm: true,
      describe: "Update a rate provider by id (name, carrier code, country, order, or retire it with is_active).",
    },
  ],
};
