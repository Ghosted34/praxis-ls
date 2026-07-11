/**
 * Client master (MOD-03) — clients with KYC, credit limit, payment terms and the
 * withholding-agent flag (KB §6.6/§17). Numbered ref via numbering.service. SQL
 * in the repo. Exposes a credit-status helper the invoicing flow consults.
 */
"use strict";
const repo = require("./client_master.repo");
const events = require("./client_master.events");
const { kycComplete, creditStatus } = require("./client_master.rules");
const numbering = require("../../../services/documents/numbering.service");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

async function create(client, { data, actor = {} }) {
  await client.query("BEGIN");
  try {
    let ref = data.ref || null;
    if (!ref && data.entity_id) {
      const alloc = await numbering.allocate(client, { moduleKey: events.MODULE, entityId: data.entity_id, date: new Date().toISOString().slice(0, 10) });
      ref = alloc.number;
    }
    const row = await repo.insert(client, { ...data, ref });
    await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: "client:" + row.client_id, actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: "client:" + row.client_id, after: row });
    await client.query("COMMIT");
    return row;
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

async function update(client, { id, patch, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Client not found", 404);
  const row = await repo.update(client, id, patch);
  await emitEvent(client, { eventTypeKey: events.UPDATED, moduleKey: events.MODULE, entityRef: "client:" + id, actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE, entityRef: "client:" + id, before, after: row });
  return row;
}

const get = (client, id) => repo.get(client, id);
const list = (client, q) => repo.list(client, q);

/** Credit status for a client + a proposed additional exposure. */
async function creditCheck(client, { clientId, additionalAmount = 0 }) {
  const c = await repo.get(client, clientId);
  if (!c) throw new AppError("NOT_FOUND", "Client not found", 404);
  return { client_id: clientId, kyc_complete: kycComplete(c), ...creditStatus(c, additionalAmount) };
}

module.exports = { create, update, get, list, creditCheck };
