"use strict";
const service = require("./financial_dictionary.service");
const validator = require("./financial_dictionary.validator");
module.exports = {
  entity: "dictionary_item", module_key: "MOD-05", screens: [],
  reads: [
    { key: "list_dictionary_items", service: service.listItems, permission: { module: "MOD-05", action: "view" }, describe: "List financial dictionary items (services, débours, overheads)." },
    { key: "get_dictionary_item", service: service.get, permission: { module: "MOD-05", action: "view" }, describe: "Get a dictionary item with its posting rules. `default_price` is its STANDARD expense rate in force today (no carrier, no container type) — the item's only price." },
    { key: "dictionary_rate_history", service: (c, p) => service.rateEvolution(c, p.dictionary_item_id, { as_of: p.as_of }), permission: { module: "MOD-05", action: "view" }, describe: "The effective-dated rate history of a dictionary item, one series per carrier / container type, with the rate in force and its trend. Params: dictionary_item_id, as_of (YYYY-MM-DD, optional)." },
  ],
  writes: [
    // A price on create is opened as the item's standard expense rate, so it is
    // a MOD-10 write too — the HTTP route checks that; here the price is left
    // off and set through set_dictionary_rate, which carries the MOD-10 gate.
    { key: "create_dictionary_item", service: (c, p, actor) => service.create(c, { data: { ...p, default_price: undefined }, actor }), schema: validator.schemas.create, permission: { module: "MOD-05", action: "create" }, confirm: true, describe: "Create a dictionary item with ≥1 posting rule (KB §4). The code is minted from the direction (R/E/D/A + lowest free number). Set its price afterwards with set_dictionary_rate." },
    { key: "update_dictionary_item", service: (c, p, actor) => (({ dictionary_item_id, ...patch }) => service.update(c, { id: dictionary_item_id, patch, actor }))(p), schema: validator.schemas.aiUpdate, permission: { module: "MOD-05", action: "edit" }, confirm: true, describe: "Edit a dictionary item and (optionally) replace its posting rules. Changing `direction` moves the code to the new letter's lowest free number. Cannot change the price — use set_dictionary_rate." },
    { key: "set_dictionary_rate", service: (c, p, actor) => (({ dictionary_item_id, ...data }) => service.supersedeRate(c, { id: dictionary_item_id, data, actor }))(p), schema: validator.schemas.aiRateSupersede, permission: { module: "MOD-10", action: "edit" }, confirm: true, describe: "Set a dictionary item's rate from a date: its standard rate (no rate_provider_id / container_type_ref_id) or one carrier / container-type series. The open rate is expired the day before; history is never edited. Currency defaults to the tenant's base currency." },
    { key: "apply_dictionary_rate_to_carriers", service: (c, p, actor) => (({ dictionary_item_id, ...data }) => service.applyRateToProviders(c, { id: dictionary_item_id, data, actor }))(p), schema: validator.schemas.aiRateApplyAll, permission: { module: "MOD-10", action: "edit" }, confirm: true, describe: "Apply ONE rate from a date to several carriers of a dictionary item at once (rate_provider_ids), optionally for one container type. All or nothing: if any carrier already has a rate starting on or after that date, nothing is saved." },
  ],
};
