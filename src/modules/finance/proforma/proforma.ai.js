"use strict";
const service = require("./proforma.service");
const validator = require("./proforma.validator");
module.exports = {
  entity: "advance",
  module_key: "MOD-50",
  screens: [],
  reads: [{ key: "get_advance", service: service.get, describe: "Get a customer advance by id." }],
  writes: [{
    key: "record_proforma_payment", service: service.recordPayment, schema: validator.schemas.pay,
    permission: { module: "MOD-50", action: "create" }, confirm: true,
    describe: "Record a customer advance paid on a proforma (Dr treasury / Cr 4191). KB §8.1.",
  }],
};
