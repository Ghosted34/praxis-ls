/** Supplier / partner master (MOD-04) — incl. mobile money + non-resident (SIT
 *  withholding, KB §17). Numbered ref; SQL in repo. */
"use strict";
const repo = require("./supplier_master.repo");
const events = require("./supplier_master.events");
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
    await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: "supplier:" + row.supplier_id, actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: "supplier:" + row.supplier_id, after: row });
    await client.query("COMMIT");
    return row;
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}
async function update(client, { id, patch, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Supplier not found", 404);
  const row = await repo.update(client, id, patch);
  await audit(client, { actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE, entityRef: "supplier:" + id, before, after: row });
  return row;
}
const get = (client, id) => repo.get(client, id);
const list = (client, q) => repo.list(client, q);
module.exports = { create, update, get, list };
