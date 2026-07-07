/**
 * Whitelisted action executors — the ONLY functions the agent may run on confirm.
 * Each calls a module SERVICE with the caller's client + identity (module RBAC/
 * audit applies). Explicit map = the safety boundary.
 */
"use strict";

const clientMaster = require("../../modules/master/client_master/client_master.service");
const opsFile = require("../../modules/operations/operations_file/operations_file.service");

const registry = {
  ping: async ({ payload }) => ({ entity_ref: `ping:${(payload && payload.note) || "ok"}` }),
  create_client: async ({ client, user, payload }) => {
    const r = await clientMaster.create(client, { data: payload, actor: user });
    return { entity_ref: `client:${r.client_id}` };
  },
  create_operations_file: async ({ client, user, payload }) => {
    const r = await opsFile.create(client, { data: payload, actor: user });
    return { entity_ref: `dossier:${r.ref}` };
  },
};
module.exports = { registry };
