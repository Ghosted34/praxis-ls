/**
 * Operations file / dossier (MOD-29, KB §6.7) — the analytical cost object. Every
 * downstream money line tags dossier_id. Numbered ref via numbering.service;
 * lifecycle OPEN→IN_PROGRESS→COMPLETED/CANCELLED. SQL in the repo.
 */
"use strict";
const repo = require("./operations_file.repo");
const events = require("./operations_file.events");
const { canTransition, isTerminal } = require("./operations_file.rules");
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
    if (!ref) throw new AppError("REF_REQUIRED", "entity_id is required to allocate a dossier ref", 422);
    const row = await repo.insert(client, { ...data, ref, status: "OPEN" });
    await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: "dossier:" + row.dossier_id, actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: "dossier:" + row.dossier_id, after: row });
    await client.query("COMMIT");
    return row;
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

async function update(client, { id, patch, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Dossier not found", 404);
  if (isTerminal(before.status)) throw new AppError("LOCKED", "A " + before.status + " dossier cannot be edited", 422);
  const { status, ...fields } = patch;
  const row = await repo.update(client, id, fields);
  await audit(client, { actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE, entityRef: "dossier:" + id, before, after: row });
  return row;
}

async function transition(client, { id, to, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Dossier not found", 404);
  if (!canTransition(before.status, to)) throw new AppError("BAD_TRANSITION", "Cannot move dossier from " + before.status + " to " + to, 422);
  const row = await repo.update(client, id, { status: to });
  await emitEvent(client, { eventTypeKey: events.UPDATED, moduleKey: events.MODULE, entityRef: "dossier:" + id, actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: "dossier.status." + to, moduleKey: events.MODULE, entityRef: "dossier:" + id, before, after: row });
  return row;
}

const get = (client, id) => repo.get(client, id);
const list = (client, q) => repo.list(client, q);
module.exports = { create, update, transition, get, list };
