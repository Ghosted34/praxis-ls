/**
 * Settings hub (MOD-70) — the tenant self-config surface (numbering schemes,
 * business rules, email/fx/comms, appearance, workflow). Read by section/key;
 * every write version-bumps and is audited (config changes are security-sensitive).
 * This is the admin face of shared/config/settings, which the rest of the app
 * reads at runtime. All SQL is in the repo; validation in the rules.
 */
"use strict";

const repo = require("./setting.repo");
const events = require("./setting.events");
const { assertValue } = require("./setting.rules");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

/** All settings grouped by section. */
async function all(client) {
  const rows = await repo.listAll(client);
  return rows.reduce((acc, r) => {
    (acc[r.section] = acc[r.section] || {})[r.key] = { value: r.value, version: r.version, updated_at: r.updated_at };
    return acc;
  }, {});
}
const sections = (client) => repo.listSections(client);
const section = (client, s) => repo.getSection(client, s);
async function get(client, s, key) {
  const row = await repo.getByKey(client, s, key);
  if (!row) throw new AppError("NOT_FOUND", "No setting " + s + "." + key, 404);
  return row;
}

/** Upsert one (section,key) value — version bump + audit + event. */
async function put(client, { section: s, key, value, actor = {} }) {
  assertValue(s, key, value);
  const before = await repo.getByKey(client, s, key);
  const row = await repo.upsert(client, { section: s, key, value, updatedBy: actor.user_id || null });
  await emitEvent(client, { eventTypeKey: events.UPDATED, moduleKey: events.MODULE, entityRef: "setting:" + s + "." + key, actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE, entityRef: "setting:" + s + "." + key, before, after: row });
  return row;
}

async function remove(client, { section: s, key, actor = {} }) {
  const ok = await repo.remove(client, s, key);
  if (!ok) throw new AppError("NOT_FOUND", "No setting " + s + "." + key, 404);
  await audit(client, { actorUserId: actor.user_id || null, action: events.DELETED, moduleKey: events.MODULE, entityRef: "setting:" + s + "." + key });
  return { deleted: true };
}

module.exports = { all, sections, section, get, put, remove };
