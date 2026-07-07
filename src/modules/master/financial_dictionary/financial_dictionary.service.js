"use strict";
const repo = require("./financial_dictionary.repo");
const events = require("./financial_dictionary.events");
const { emitEvent, audit } = require("../../../shared/events/emit");
const listItems = (c, q) => repo.listItems(c, q);
async function get(c, id) { const item = await repo.getItem(c, id); if (!item) return null; item.posting_rules = await repo.listRules(c, id); return item; }
async function create(c, { data, actor }) {
  const rules = data.posting_rules || [];
  if (rules.length === 0) { const e = new Error("a dictionary item requires at least one posting rule (KB §4)"); e.status = 422; throw e; }
  await c.query("BEGIN");
  try {
    const { posting_rules, ...itemData } = data;
    const item = await repo.createItem(c, itemData);
    for (const r of posting_rules) await repo.createRule(c, { ...r, dictionary_item_id: item.dictionary_item_id, is_debours: r.is_debours ?? item.is_debours });
    await c.query("COMMIT");
    await emitEvent(c, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: `dict:${item.code}`, actorUserId: actor.user_id });
    await audit(c, { actorUserId: actor.user_id, action: events.CREATED, moduleKey: events.MODULE, entityRef: `dict:${item.code}`, after: item });
    item.posting_rules = await repo.listRules(c, item.dictionary_item_id);
    return item;
  } catch (err) { await c.query("ROLLBACK"); throw err; }
}
async function update(c, { id, patch, actor }) {
  const before = await repo.getItem(c, id); if (!before) return null;
  const { posting_rules, ...itemPatch } = patch;
  const row = await repo.updateItem(c, id, itemPatch);
  await emitEvent(c, { eventTypeKey: events.UPDATED, moduleKey: events.MODULE, entityRef: `dict:${before.code}`, actorUserId: actor.user_id });
  await audit(c, { actorUserId: actor.user_id, action: events.UPDATED, moduleKey: events.MODULE, entityRef: `dict:${before.code}`, before, after: row });
  return row;
}
module.exports = { listItems, get, create, update };
