/** Marketing campaigns (MOD-22) — campaign lifecycle + newsletter list. SQL in repo. */
"use strict";
const repo = require("./marketing_campaign.repo");
const events = require("./marketing_campaign.events");
const { assertTransition } = require("./marketing_campaign.rules");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const ref = (id) => "campaign:" + id;
async function create(client, { data, actor = {} }) {
  const row = await repo.insert(client, { name: data.name, channel: data.channel || null, status: "DRAFT", starts_on: data.starts_on || null, ends_on: data.ends_on || null, assets_json: JSON.stringify(data.assets || {}) });
  await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.campaign_id), actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.campaign_id), after: row });
  return row;
}
async function transition(client, { id, to, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Campaign not found", 404);
  assertTransition(before.status, to);
  const row = await repo.update(client, id, { status: to });
  await emitEvent(client, { eventTypeKey: events.transition(to), moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.transition(to), moduleKey: events.MODULE, entityRef: ref(id), after: row });
  return row;
}
async function subscribe(client, { email, name, source, actor = {} }) {
  const row = await repo.subscribe(client, { email, name, source });
  await emitEvent(client, { eventTypeKey: events.SUBSCRIBED, moduleKey: events.MODULE, entityRef: "newsletter:" + email, actorUserId: actor.user_id || null });
  return row;
}
async function unsubscribe(client, { email, actor = {} }) {
  const row = await repo.unsubscribe(client, email);
  if (!row) throw new AppError("NOT_FOUND", "Subscriber not found", 404);
  await emitEvent(client, { eventTypeKey: events.UNSUBSCRIBED, moduleKey: events.MODULE, entityRef: "newsletter:" + email, actorUserId: actor.user_id || null });
  return row;
}
const get = (client, id) => repo.get(client, id);
const list = (client, q) => repo.list(client, q);
const subscribers = (client, q) => repo.listSubscribers(client, q);
module.exports = { create, transition, subscribe, unsubscribe, get, list, subscribers };
