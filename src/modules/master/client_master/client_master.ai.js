"use strict";
const service = require("./client_master.service");
const validator = require("./client_master.validator");
const accountManager = require("./account_manager.service");
module.exports = {
  entity: "client_master",
  module_key: "MOD-03",
  screens: [],
  reads: [
    { key: "list_clients", service: service.list, permission: { module: "MOD-03", action: "view" }, describe: "List clients." },
    { key: "get_client", service: service.get, permission: { module: "MOD-03", action: "view" }, describe: "Get a client by id." },
    { key: "client_credit_check", service: service.creditCheck, permission: { module: "MOD-03", action: "view" }, describe: "KYC + credit availability for a client." },
    { key: "find_account_manager_candidates", service: (c, p) => accountManager.candidates(c, { q: (p && p.q) || "", limit: p && p.limit }), permission: { module: "MOD-03", action: "edit" }, describe: "People who can be named a client's account manager — staff with an active login — searched by name or job title (q). Returns each one's account_user_id, the user_id set_client_account_manager takes." },
    { key: "get_client_account_manager", service: (c, id) => accountManager.get(c, { clientId: id && typeof id === "object" ? id.client_id : id }), permission: { module: "MOD-03", action: "view" }, describe: "Who looks after a client (their account manager): name, job title, and whether they can still be reached. The client's portal messages reach this person first." },
  ],
  writes: [
    { key: "create_client", service: service.create, schema: validator.schemas.create, permission: { module: "MOD-03", action: "create" }, confirm: true, describe: "Register a new client (KYC, credit limit, payment terms)." },
    { key: "update_client", service: (c, p, actor) => (({ client_id, ...patch }) => service.update(c, { id: client_id, patch, actor }))(p), schema: validator.schemas.aiUpdate, permission: { module: "MOD-03", action: "edit" }, confirm: true, describe: "Update a client by id." },
    { key: "set_client_account_manager", service: (c, p, actor) => accountManager.set(c, { clientId: p.client_id, userId: p.user_id, actor }), schema: validator.schemas.aiAccountManager, permission: { module: "MOD-03", action: "edit" }, confirm: true, describe: "Name the account manager who looks after a client (user_id = their login, which must be active), or clear it with null. They are told, and the client's portal messages reach them first." },
  ],
};
