/**
 * Rate providers (MOD-10) — named shipping lines, airlines, and rate-setting
 * authorities (port/customs) an expense rate can be scoped to. Seeded-but-
 * editable, same shape as dictionary_ref: a manager extends the list from the
 * admin panel or inline from the Expense Rates grid, never a release.
 */
"use strict";
const repo = require("./rate_provider.repo");
const events = require("./rate_provider.events");
const { audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

const ref = (id) => "rate_provider:" + id;

async function create(client, { data, actor = {} }) {
  await client.query("BEGIN");
  try {
    const row = await repo.insert(client, { ...data, code: String(data.code).toUpperCase() });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.rate_provider_id), after: row });
    await client.query("COMMIT");
    return row;
  } catch (e) {
    await client.query("ROLLBACK");
    if (e.code === "23505") throw new AppError("EXISTS", `A ${data.kind} provider with code "${data.code}" already exists`, 409);
    throw e;
  }
}

async function update(client, { id, patch, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Rate provider not found", 404);
  if (before.is_system && patch.code) throw new AppError("SYSTEM_TYPE", "A seeded provider's code cannot be changed — deactivate it and add a new one instead.", 422);
  const row = await repo.update(client, id, patch);
  await audit(client, { actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE, entityRef: ref(id), before, after: row });
  return row;
}

const get = (client, id) => repo.get(client, id);
const list = (client, q) => repo.list(client, q);

module.exports = { create, update, get, list };
