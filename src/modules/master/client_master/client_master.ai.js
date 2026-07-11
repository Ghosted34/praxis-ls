"use strict";
const service = require("./client_master.service");
const validator = require("./client_master.validator");
module.exports = {
  entity: "client_master",
  module_key: "MOD-03",
  screens: [],
  reads: [
    { key: "list_clients", service: service.list, describe: "List clients." },
    { key: "get_client", service: service.get, describe: "Get a client by id." },
    { key: "client_credit_check", service: service.creditCheck, describe: "KYC + credit availability for a client." },
  ],
  writes: [
    { key: "create_client", service: service.create, schema: validator.schemas.create, permission: { module: "MOD-03", action: "create" }, confirm: true, describe: "Register a new client (KYC, credit limit, payment terms)." },
    { key: "update_client", service: service.update, schema: validator.schemas.update, permission: { module: "MOD-03", action: "edit" }, confirm: true, describe: "Update a client." },
  ],
};
