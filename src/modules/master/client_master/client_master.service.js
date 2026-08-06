/**
 * Client master (MOD-03) — clients with KYC, credit limit, payment terms and the
 * withholding-agent flag (KB §6.6/§17). Numbered ref via numbering.service. SQL
 * in the repo. Exposes a credit-status helper the invoicing flow consults.
 *
 * On top of the static Zod validation, the create path enforces the tenant's
 * per-field required-ness (party_field_config, §5.2), and the update path
 * allocates the auxiliary COA account when the client is activated (§3).
 */
"use strict";
const repo = require("./client_master.repo");
const events = require("./client_master.events");
const { kycComplete, creditStatus } = require("./client_master.rules");
const numbering = require("../../../services/documents/numbering.service");
const masterConfig = require("../master_config/master_config.service");
const lifecycle = require("../party-lifecycle.service");
const partyWrite = require("../_shared/party-write.service");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

async function create(client, { data, actor = {} }) {
  // Country-first form blocks (§2) are written as their own rows, not master
  // columns — pull them out of the flat payload before the master insert.
  const { registrations, primary_contact, primary_address, ...masterData } = data;
  await client.query("BEGIN");
  try {
    // Registrations are the source of truth; mirror OHADA NIU/RCCM onto the
    // master (invoices read those columns) and stamp the normalized name.
    partyWrite.validateRegistrations({ registrations, country: masterData.country_code, kind: "client", category: null });
    Object.assign(masterData, partyWrite.niuRccmMirror(registrations), { name_norm: partyWrite.normalizeName(masterData) });
    // Tenant field-requirement policy on top of the static schema (§5.2).
    await masterConfig.enforceRequired(client, "CLIENT", masterData);
    // A new client starts as a DRAFT unless told otherwise.
    const payload = { registration_status: "DRAFT", ...masterData };
    let ref = payload.ref || null;
    if (!ref && payload.entity_id) {
      const alloc = await numbering.allocate(client, { moduleKey: events.MODULE, entityId: payload.entity_id, date: new Date().toISOString().slice(0, 10) });
      ref = alloc.number;
    }
    const row = await repo.insert(client, { ...payload, ref });
    // Registrations, primary contact and primary address — same transaction.
    await partyWrite.writeChildren(client, { kind: "client", partyId: row.client_id, registrations, primary_contact, primary_address });
    await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: "client:" + row.client_id, actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: "client:" + row.client_id, after: row });
    await client.query("COMMIT");
    return row;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

async function update(client, { id, patch, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Client not found", 404);
  // The nested blocks are managed via the 360 endpoints on edit — strip them
  // from the flat patch. Registrations sent from the edit form still re-mirror
  // OHADA NIU/RCCM onto the master, and any name change refreshes name_norm.
  const masterPatch = { ...patch };
  const { registrations } = masterPatch;
  delete masterPatch.registrations; delete masterPatch.primary_contact; delete masterPatch.primary_address;
  if (registrations) {
    partyWrite.validateRegistrations({ registrations, country: masterPatch.country_code ?? before.country_code, kind: "client", category: null });
    Object.assign(masterPatch, partyWrite.niuRccmMirror(registrations));
  }
  if (masterPatch.name !== undefined || masterPatch.legal_name !== undefined) {
    masterPatch.name_norm = partyWrite.normalizeName({ name: masterPatch.name ?? before.name, legal_name: masterPatch.legal_name ?? before.legal_name });
  }
  await client.query("BEGIN");
  try {
    const row = await repo.update(client, id, masterPatch);
    // Activation (§3): allocate the aux account + refresh compliance the first
    // time a client becomes ACTIVE. Keyed on "active without an aux account" so a
    // retry after a mid-activation failure still completes it.
    if (row.registration_status === "ACTIVE" && !row.coa_aux_account) {
      await lifecycle.onActivate(client, { kind: "client", partyId: id });
    }
    await emitEvent(client, { eventTypeKey: events.UPDATED, moduleKey: events.MODULE, entityRef: "client:" + id, actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE, entityRef: "client:" + id, before, after: row });
    await client.query("COMMIT");
    return repo.get(client, id);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

const get = (client, id) => repo.get(client, id);
const list = (client, q) => repo.list(client, q);

/** Credit status for a client + a proposed additional exposure. */
async function creditCheck(client, { clientId, additionalAmount = 0 }) {
  const c = await repo.get(client, clientId);
  if (!c) throw new AppError("NOT_FOUND", "Client not found", 404);
  // DATA 1.9: derive the real exposure. cached_receivables is written by
  // nothing and is permanently zero, so this used to report unlimited credit
  // for every client no matter what they owed.
  const { outstanding, overdue } = await repo.outstandingFor(client, clientId);
  return {
    client_id: clientId,
    kyc_complete: kycComplete(c),
    overdue,
    ...creditStatus(c, additionalAmount, outstanding),
  };
}

module.exports = { create, update, get, list, creditCheck };
