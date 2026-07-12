"use strict";
const service = require("./app_user.service");
const validator = require("./app_user.validator");
module.exports = {
  entity: "app_user", module_key: "MOD-67", screens: [],
  reads: [
    { key: "list_users", service: (c, p) => service.listUsers(c, p), describe: "List users (safe fields only; never secrets)." },
    { key: "get_user", service: (c, p) => service.getUser(c, p.id || p), describe: "Get a user with role_ids (no secrets)." },
  ],
  writes: [
    { key: "create_user", service: (c, p) => service.createUser(c, { data: p }), schema: validator.schemas.create, permission: { module: "MOD-67", action: "create" }, confirm: true, describe: "Create a user (Argon2id password, role assignment)." },
    { key: "update_user", service: (c, p) => service.updateUser(c, { id: p.id, patch: p }), schema: validator.schemas.update, permission: { module: "MOD-67", action: "edit" }, confirm: true, describe: "Update a user's profile/roles." },
    { key: "set_user_status", service: (c, p) => service.setStatus(c, p), schema: validator.schemas.status, permission: { module: "MOD-67", action: "edit" }, confirm: true, describe: "Activate/suspend/lock a user (guards last CEO)." },
  ],
};
