/**
 * Chart of Accounts (MOD-06, KB §5/§22). Hierarchical statutory chart + tenant
 * sub-accounts. Enforces: class digit matches the code; only leaf accounts are
 * postable (adding a child demotes the parent); never delete an account that is
 * referenced by a journal line, a posting rule, or a child. SQL in the repo.
 */
"use strict";
const repo = require("./chart_of_accounts.repo");
const events = require("./chart_of_accounts.events");
const { assertCodeClass } = require("./chart_of_accounts.rules");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

async function create(client, { data, actor = {} }) {
  assertCodeClass(data.code, data.class);
  await client.query("BEGIN");
  try {
    if (await repo.get(client, data.code)) throw new AppError("EXISTS", "account " + data.code + " already exists", 409);
    if (data.parent_code) {
      const parent = await repo.get(client, data.parent_code);
      if (!parent) throw new AppError("NO_PARENT", "parent account " + data.parent_code + " not found", 422);
      if (parent.is_postable) await repo.update(client, data.parent_code, { is_postable: false }); // parent now has a child
    }
    const row = await repo.insert(client, { ...data, is_system: false });
    await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: "account:" + row.code, actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: "account:" + row.code, after: row });
    await client.query("COMMIT");
    return row;
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

async function update(client, { code, patch, actor = {} }) {
  const before = await repo.get(client, code);
  if (!before) throw new AppError("NOT_FOUND", "account not found", 404);
  // System (statutory) rows: only label/flags editable, not code/class/parent.
  const allowed = before.is_system ? ["label_fr", "label_en", "requires_analytic", "is_active"] : ["label_fr", "label_en", "normal_balance", "is_postable", "requires_analytic", "is_active", "parent_code"];
  const fields = {};
  for (const k of allowed) if (patch[k] !== undefined) fields[k] = patch[k];
  // A postable account must be a leaf.
  if (fields.is_postable === true && (await repo.children(client, code)).length) throw new AppError("NOT_LEAF", "an account with children cannot be postable", 422);
  const row = await repo.update(client, code, fields);
  await audit(client, { actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE, entityRef: "account:" + code, before, after: row });
  return row;
}

async function remove(client, { code, actor = {} }) {
  const before = await repo.get(client, code);
  if (!before) throw new AppError("NOT_FOUND", "account not found", 404);
  if (before.is_system) throw new AppError("SYSTEM_ACCOUNT", "statutory accounts cannot be deleted (deactivate instead)", 422);
  const ref = await repo.referencedBy(client, code);
  if (ref) throw new AppError("REFERENCED", "account " + code + " is referenced by " + ref + " — deactivate instead of delete", 409);
  await client.query("BEGIN");
  try {
    await repo.remove(client, code);
    await audit(client, { actorUserId: actor.user_id || null, action: events.ARCHIVED, moduleKey: events.MODULE, entityRef: "account:" + code, before });
    await client.query("COMMIT");
    return { deleted: true, code };
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

const get = (client, code) => repo.get(client, code);
const list = (client, q) => repo.list(client, q);
module.exports = { create, update, remove, get, list };
