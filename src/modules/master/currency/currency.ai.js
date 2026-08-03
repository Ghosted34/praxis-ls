"use strict";
const service = require("./currency.service");
const validator = require("./currency.validator");
module.exports = {
  entity: "currency", module_key: "MOD-08", screens: [],
  reads: [
    { key: "list_currencies", service: service.listCurrencies, describe: "List active currencies." },
    { key: "fx_rate", service: service.rateFor, describe: "Resolve the FX rate for a pair on/before a date." },
    { key: "fx_convert", service: service.convertAmount, describe: "Convert an amount between currencies at the stamped rate." },
  ],
  writes: [{ key: "set_fx_rate", service: (c, p) => service.setRate(c, { base: p.base, quote: p.quote, rate: p.rate, asOfDate: p.as_of_date, source: p.source, isOverride: p.is_override }), schema: validator.schemas.setRate, permission: { module: "MOD-08", action: "edit" }, confirm: true, describe: "Record a manual FX rate/override." }],
};
