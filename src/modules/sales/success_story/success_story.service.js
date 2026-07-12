/** Project portfolio / success stories (MOD-26). Draft → sign-off → publish.
 *  AI-generated flag supported. Publishing requires a prior sign-off. SQL in repo. */
"use strict";
const repo = require("./success_story.repo");
const events = require("./success_story.events");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const ref = (id) => "success_story:" + id;
async function create(client, { data, actor = {} }) {
  const row = await repo.insert(client, { title: data.title, dossier_id: data.dossier_id || null, summary: data.summary || null, body: data.body || null, ai_generated: data.ai_generated === true, is_published: false });
  await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.success_story_id), after: row });
  return row;
}
async function update(client, { id, patch = {}, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Success story not found", 404);
  if (before.is_published) throw new AppError("LOCKED", "Unpublish before editing a published story", 422);
  const fields = {};
  for (const k of ["title", "summary", "body", "dossier_id"]) if (patch[k] !== undefined) fields[k] = patch[k];
  const row = await repo.update(client, id, fields);
  await audit(client, { actorUserId: actor.user_id || null, action: "success_story.updated", moduleKey: events.MODULE, entityRef: ref(id), before, after: row });
  return row;
}
async function signOff(client, { id, actor = {} }) {
  const s = await repo.get(client, id);
  if (!s) throw new AppError("NOT_FOUND", "Success story not found", 404);
  const row = await repo.update(client, id, { signed_off_by: actor.user_id || null });
  await emitEvent(client, { eventTypeKey: events.SIGNED_OFF, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.SIGNED_OFF, moduleKey: events.MODULE, entityRef: ref(id), after: row });
  return row;
}
async function publish(client, { id, actor = {} }) {
  const s = await repo.get(client, id);
  if (!s) throw new AppError("NOT_FOUND", "Success story not found", 404);
  if (!s.signed_off_by) throw new AppError("NOT_SIGNED_OFF", "A success story must be signed off before publishing", 422);
  const row = await repo.update(client, id, { is_published: true, published_at: new Date().toISOString() });
  await emitEvent(client, { eventTypeKey: events.PUBLISHED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.PUBLISHED, moduleKey: events.MODULE, entityRef: ref(id), after: row });
  return row;
}
async function unpublish(client, { id, actor = {} }) {
  const row = await repo.update(client, id, { is_published: false });
  if (!row) throw new AppError("NOT_FOUND", "Success story not found", 404);
  await emitEvent(client, { eventTypeKey: events.UNPUBLISHED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
  return row;
}
const get = (client, id) => repo.get(client, id);
const list = (client, q) => repo.list(client, q);
module.exports = { create, update, signOff, publish, unpublish, get, list };
