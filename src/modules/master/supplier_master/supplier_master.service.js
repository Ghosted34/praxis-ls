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
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

async function create(client, { data, actor = {} }) {
  await client.query("BEGIN");
  try {
    await masterConfig.enforceRequired(client, "SUPPLIER", data);
    const payload = { registration_status: "DRAFT", ...data };
    let ref = payload.ref || null;
    if (!ref && payload.entity_id) {
      const alloc = await numbering.allocate(client, { moduleKey: events.MODULE, entityId: payload.entity_id, date: new Date().toISOString().slice(0, 10) });
      ref = alloc.number;
    }
    const row = await repo.insert(client, { ...payload, ref });
    await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: "supplier:" + row.supplier_id, actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: "supplier:" + row.supplier_id, after: row });
    await client.query("COMMIT");
    return row;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

async function update(client, { id, patch, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Supplier not found", 404);
  await client.query("BEGIN");
  try {
    const row = await repo.update(client, id, patch);
    if (row.registration_status === "ACTIVE" && !row.coa_aux_account) {
      await lifecycle.onActivate(client, { kind: "supplier", partyId: id });
    }
    await emitEvent(client, { eventTypeKey: events.UPDATED, moduleKey: events.MODULE, entityRef: "supplier:" + id, actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE, entityRef: "supplier:" + id, before, after: row });
    await client.query("COMMIT");
    return repo.get(client, id);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

const get = (client, id) => repo.get(client, id);
const list = (client, q) => repo.list(client, q);
module.exports = { create, update, get, list };
