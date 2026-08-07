/** Supplier / partner master (MOD-04) — incl. mobile money + non-resident (SIT
 *  withholding, KB §17). Numbered ref; SQL in repo.
 *
 *  Like the client master, create enforces the tenant field-requirement policy
 *  (§5.2) and update allocates the auxiliary COA account on activation (§3). */
"use strict";
const repo = require("./supplier_master.repo");
const events = require("./supplier_master.events");
const numbering = require("../../../services/documents/numbering.service");
const masterConfig = require("../master_config/master_config.service");
const lifecycle = require("../party-lifecycle.service");
const partyWrite = require("../_shared/party-write.service");
const changeRequest = require("../_shared/change-request.service");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

async function create(client, { data, actor = {} }) {
  const { registrations, primary_contact, primary_address, ...masterData } = data;
  await client.query("BEGIN");
  try {
    partyWrite.validateRegistrations({ registrations, country: masterData.country_code, kind: "supplier", category: null });
    Object.assign(masterData, partyWrite.niuRccmMirror(registrations), { name_norm: partyWrite.normalizeName(masterData) });
    await masterConfig.enforceRequired(client, "SUPPLIER", masterData);
    const payload = { registration_status: "DRAFT", ...masterData };
    let ref = payload.ref || null;
    if (!ref && payload.entity_id) {
      const alloc = await numbering.allocate(client, { moduleKey: events.MODULE, entityId: payload.entity_id, date: new Date().toISOString().slice(0, 10) });
      ref = alloc.number;
    }
    const row = await repo.insert(client, { ...payload, ref });
    await partyWrite.writeChildren(client, { kind: "supplier", partyId: row.supplier_id, registrations, primary_contact, primary_address });
    await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: "supplier:" + row.supplier_id, actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: "supplier:" + row.supplier_id, after: row });
    await client.query("COMMIT");
    return row;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

async function update(client, { id, patch, actor = {}, env }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Supplier not found", 404);
  const masterPatch = { ...patch };
  const { registrations } = masterPatch;
  delete masterPatch.registrations; delete masterPatch.primary_contact; delete masterPatch.primary_address;
  // Sensitive-field maker-checker (§8) — see the client master for the rationale.
  const gate = changeRequest.isGoverned(env) ? changeRequest.pickSensitiveMaster(masterPatch) : { sensitive: {}, changeType: null };
  if (registrations) {
    partyWrite.validateRegistrations({ registrations, country: masterPatch.country_code ?? before.country_code, kind: "supplier", category: null });
    Object.assign(masterPatch, partyWrite.niuRccmMirror(registrations));
  }
  if (masterPatch.name !== undefined || masterPatch.legal_name !== undefined) {
    masterPatch.name_norm = partyWrite.normalizeName({ name: masterPatch.name ?? before.name, legal_name: masterPatch.legal_name ?? before.legal_name });
  }
  await client.query("BEGIN");
  try {
    let pending = null;
    if (gate.changeType) {
      pending = await changeRequest.open(client, { kind: "supplier", partyId: id, changeType: gate.changeType, payload: gate.sensitive, actor });
    }
    const row = Object.keys(masterPatch).length ? await repo.update(client, id, masterPatch) : before;
    if (row.registration_status === "ACTIVE" && !row.coa_aux_account) {
      await lifecycle.onActivate(client, { kind: "supplier", partyId: id });
    }
    await emitEvent(client, { eventTypeKey: events.UPDATED, moduleKey: events.MODULE, entityRef: "supplier:" + id, actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE, entityRef: "supplier:" + id, before, after: row });
    await client.query("COMMIT");
    const result = await repo.get(client, id);
    if (pending) result.pending_change = { change_request_id: pending.change_request_id, change_type: pending.change_type };
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

const get = (client, id) => repo.get(client, id);
const list = (client, q) => repo.list(client, q);
module.exports = { create, update, get, list };
